// electron/main.js
// Standalone Desktop Wrapper for Arth-Sutra using Electron

import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CRITICAL: Route SQLite database and data directory to app.getPath('userData')
// before loading any database modules.
const userDataPath = app.getPath('userData');
process.env.ELECTRON_USER_DATA = userDataPath;
if (app.isPackaged) {
  process.env.NODE_ENV = 'production';
}

let mainWindow = null;
const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
const PORT_FILE = path.join(userDataPath, 'port.txt');

/**
 * Polls for Express server readiness
 */
async function waitForServer(port, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await new Promise((resolve) => {
      const req = http.get(`http://localhost:${port}/api/version`, (res) => {
        resolve(res.statusCode < 500);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(800, () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ready) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/**
 * Resolves the bound port from port.txt or default
 */
async function getActivePort(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(PORT_FILE)) {
      try {
        const content = fs.readFileSync(PORT_FILE, 'utf-8').trim();
        const p = parseInt(content, 10);
        if (p >= 1024 && p <= 65535) return p;
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return 47371; // Fallback to default port
}

async function createWindow(targetUrl) {
  const winIconPath = path.join(__dirname, '..', 'dist', 'icons', 'icon.ico');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: 'Arth Sutra',
    icon: fs.existsSync(winIconPath) ? winIconPath : undefined,
    backgroundColor: '#0f172a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    autoHideMenuBar: true,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle external links (open in user's default browser)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(targetUrl);
}

// Single instance lock to prevent duplicate apps
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      console.log('[Electron] Starting Arth-Sutra backend...');
      // Start Express server inside the main process
      await import('../server.js');

      const port = await getActivePort();
      console.log(`[Electron] Detected backend running on port: ${port}`);

      const ready = await waitForServer(port);
      if (!ready) {
        console.warn('[Electron] Backend readiness check timed out, attempting window load anyway...');
      }

      const startUrl = isDev && process.env.ELECTRON_START_URL
        ? process.env.ELECTRON_START_URL
        : `http://localhost:${port}`;

      await createWindow(startUrl);
    } catch (err) {
      console.error('[Electron] Fatal error during app launch:', err);
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
