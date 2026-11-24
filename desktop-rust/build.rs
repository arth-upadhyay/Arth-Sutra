fn main() {
    if std::env::var("TARGET").unwrap_or_default().contains("windows") {
        let mut res = winres::WindowsResource::new();
        res.set_icon("../public/icons/icon.ico");
        res.set("ProductName", "ArthSutra");
        res.set("FileDescription", "Arth Sutra GST Billing Software");
        res.set("LegalCopyright", "Copyright (c) 2026 ARTH");
        let _ = res.compile();
    }
}
