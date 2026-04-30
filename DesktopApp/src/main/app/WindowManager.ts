/**
 * WindowManager.ts
 * Creates and manages BrowserWindow instances.
 * Single responsibility: window lifecycle only.
 */

import { BrowserWindow, shell, session } from 'electron';
import { join } from 'path';

const WINDOW_WIDTH = 900;
const WINDOW_HEIGHT = 620;
const WINDOW_MIN_WIDTH = 720;
const WINDOW_MIN_HEIGHT = 500;

/**
 * Content Security Policy for production builds.
 *
 * Applied via session.webRequest.onHeadersReceived so it covers file:// loads
 * (Electron ignores <meta http-equiv="CSP"> for file:// protocol).
 *
 * In dev mode we do NOT inject this header — the Vite dev server's own
 * /@vite/client script sets inline styles for its HMR overlay, and
 * overriding headers on localhost requests would break hot-reload.
 * The strict policy is what matters for the shipped, packaged app.
 */
const PRODUCTION_CSP =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' https://fonts.googleapis.com; " +
  "font-src 'self' data: https://fonts.gstatic.com; " +
  "img-src 'self' data:; " +
  "connect-src 'self'; " +
  "object-src 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self'; " +
  "frame-ancestors 'none';";

export class WindowManager {
  private mainWindow: BrowserWindow | null = null;

  createMainWindow(): BrowserWindow {
    const isDev = !!process.env['VITE_DEV_SERVER_URL'];

    // Only enforce CSP in production. In dev the Vite HMR client injects
    // inline styles we cannot control, so we leave the dev server's own
    // headers untouched and rely on the <meta> tag in index.html instead.
    if (!isDev) {
      session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [PRODUCTION_CSP],
          },
        });
      });
    }

    this.mainWindow = new BrowserWindow({
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      minWidth: WINDOW_MIN_WIDTH,
      minHeight: WINDOW_MIN_HEIGHT,
      frame: false,
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
      trafficLightPosition: { x: 16, y: 16 },
      backgroundColor: '#0a0812',
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });

    // Load the renderer
    if (process.env['VITE_DEV_SERVER_URL']) {
      this.mainWindow.loadURL(process.env['VITE_DEV_SERVER_URL']);
      this.mainWindow.webContents.openDevTools();
    } else {
      this.mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
    }

    // Show window when ready to avoid flash
    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.show();
    });

    // Open external links in the default browser
    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });

    return this.mainWindow;
  }

  getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  focusMainWindow(): void {
    if (this.mainWindow) {
      if (this.mainWindow.isMinimized()) this.mainWindow.restore();
      this.mainWindow.focus();
    }
  }
}
