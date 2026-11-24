#![windows_subsystem = "windows"]

use std::error::Error;
use std::fs;
use std::io::Read;
use std::net::TcpStream;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    window::WindowBuilder,
};
use wry::WebViewBuilder;

const CREATE_NO_WINDOW: u32 = 0x08000000;
const DEFAULT_PORT: u16 = 47371;

/// Resolve userData directory (%APPDATA%\ArthSutra)
fn get_user_data_dir() -> PathBuf {
    if let Ok(app_data) = std::env::var("APPDATA") {
        let p = Path::new(&app_data).join("ArthSutra");
        let _ = fs::create_dir_all(&p);
        p
    } else {
        let p = PathBuf::from("./data");
        let _ = fs::create_dir_all(&p);
        p
    }
}

/// Locate node executable: either bundled beside the app or system node in PATH
fn find_node_executable(exe_dir: &Path) -> PathBuf {
    let local_node = exe_dir.join("node.exe");
    if local_node.exists() {
        return local_node;
    }
    let local_bin_node = exe_dir.join("bin").join("node.exe");
    if local_bin_node.exists() {
        return local_bin_node;
    }
    PathBuf::from("node")
}

/// Locate server.js
fn find_server_js(exe_dir: &Path) -> Option<PathBuf> {
    let candidates = [
        exe_dir.join("server.js"),
        exe_dir.join("app").join("server.js"),
        exe_dir.join("resources").join("server.js"),
        exe_dir.join("..").join("server.js"),
    ];

    for c in &candidates {
        if c.exists() {
            return Some(c.clone());
        }
    }
    None
}

/// Read port from port.txt or fallback
fn get_active_port(user_data_dir: &Path) -> u16 {
    let port_file = user_data_dir.join("port.txt");
    if port_file.exists() {
        if let Ok(content) = fs::read_to_string(&port_file) {
            if let Ok(p) = content.trim().parse::<u16>() {
                if (1024..=65535).contains(&p) {
                    return p;
                }
            }
        }
    }
    DEFAULT_PORT
}

/// Poll until the backend HTTP server responds
fn wait_for_server(port: u16, timeout: Duration) -> bool {
    let start = Instant::now();
    let addr = format!("127.0.0.1:{}", port);

    while start.elapsed() < timeout {
        if let Ok(mut stream) = TcpStream::connect_timeout(&addr.parse().unwrap(), Duration::from_millis(300)) {
            use std::io::Write;
            let req = "GET /api/version HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
            let _ = stream.write_all(req.as_bytes());
            let mut buf = [0u8; 128];
            if let Ok(n) = stream.read(&mut buf) {
                if n > 0 {
                    return true;
                }
            }
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    false
}

/// Open external URLs in the user's default browser
fn open_browser(url: &str) {
    let _ = Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", url])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

fn main() -> Result<(), Box<dyn Error>> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));

    let user_data_dir = get_user_data_dir();

    // Start Node.js backend
    let node_bin = find_node_executable(&exe_dir);
    let server_script = find_server_js(&exe_dir).unwrap_or_else(|| PathBuf::from("server.js"));

    let mut child: Option<Child> = Command::new(&node_bin)
        .arg(&server_script)
        .current_dir(server_script.parent().unwrap_or(&exe_dir))
        .env("ARTH_USER_DATA", &user_data_dir)
        .env("ELECTRON_USER_DATA", &user_data_dir)
        .env("NODE_ENV", "production")
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .ok();

    // Wait for the server to spin up
    let port = get_active_port(&user_data_dir);
    let _ = wait_for_server(port, Duration::from_secs(15));
    let start_url = format!("http://localhost:{}", port);

    let event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title("Arth Sutra")
        .with_inner_size(LogicalSize::new(1280.0, 850.0))
        .with_min_inner_size(LogicalSize::new(1024.0, 700.0))
        .build(&event_loop)?;

    let is_shutting_down = Arc::new(AtomicBool::new(false));

    let _webview = WebViewBuilder::new()
        .with_url(&start_url)
        .with_new_window_req_handler(|url| {
            if url.starts_with("http:") || url.starts_with("https:") {
                if !url.contains("localhost") && !url.contains("127.0.0.1") {
                    open_browser(&url);
                    return false;
                }
            }
            true
        })
        .build(&window)?;

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        if let Event::WindowEvent { event: WindowEvent::CloseRequested, .. } = event {
            if !is_shutting_down.swap(true, Ordering::SeqCst) {
                if let Some(mut proc) = child.take() {
                    let _ = proc.kill();
                    let _ = proc.wait();
                }
            }
            *control_flow = ControlFlow::Exit;
        }
    });
}
