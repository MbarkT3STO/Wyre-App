/**
 * WindowManager.ts
 * Creates and manages BrowserWindow instances.
 * Single responsibility: window lifecycle only.
 */

import { BrowserWindow, shell, app } from 'electron';
import { join } from 'path';

const WINDOW_WIDTH = 900;
const WINDOW_HEIGHT = 620;
const WINDOW_MIN_WIDTH = 720;
const WINDOW_MIN_HEIGHT = 500;

export class WindowManager {
  private mainWindow: BrowserWindow | null = null;

  createMainWindow(): BrowserWindow {
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
      icon: join(process.resourcesPath ?? join(__dirname, '../../'), 'assets/icons/icon.png'),
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
