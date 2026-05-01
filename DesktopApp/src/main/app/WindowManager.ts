/**
 * WindowManager.ts
 * Creates and manages BrowserWindow instances.
 * Single responsibility: window lifecycle only.
 *
 * Smart sizing: on first launch the window is sized to the ideal dimensions
 * for the current display (70 % of work-area width, 80 % of work-area height,
 * clamped to hard min/max values). On subsequent launches the last size and
 * position are restored from electron-store so the user's preference is kept.
 */

import { BrowserWindow, shell, session, screen } from 'electron';
import { join } from 'path';
import Store from 'electron-store';

// ── Hard limits ────────────────────────────────────────────────────────────
const MIN_WIDTH  = 720;
const MIN_HEIGHT = 500;
const MAX_WIDTH  = 1600;
const MAX_HEIGHT = 1100;

// ── Ideal size as a fraction of the display's work area ───────────────────
const IDEAL_WIDTH_RATIO  = 0.70;
const IDEAL_HEIGHT_RATIO = 0.80;

// ── Fallback when screen API is unavailable ────────────────────────────────
const FALLBACK_WIDTH  = 960;
const FALLBACK_HEIGHT = 660;

interface WindowState {
  width: number;
  height: number;
  x: number | undefined;
  y: number | undefined;
  maximized: boolean;
}

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

  /** Persistent store for window geometry — separate from app settings */
  private readonly windowStore = new Store<WindowState>({
    name: 'window-state',
    defaults: {
      width: FALLBACK_WIDTH,
      height: FALLBACK_HEIGHT,
      x: undefined,
      y: undefined,
      maximized: false,
    },
  });

  createMainWindow(): BrowserWindow {
    const isDev = !!process.env['VITE_DEV_SERVER_URL'];

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

    const { width, height, x, y, maximized } = this.resolveWindowState();

    this.mainWindow = new BrowserWindow({
      width,
      height,
      x,
      y,
      minWidth:  MIN_WIDTH,
      minHeight: MIN_HEIGHT,
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

    // Restore maximized state after creation so the window has correct bounds first
    if (maximized) {
      this.mainWindow.maximize();
    }

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

    // Persist geometry on every move/resize (debounced via the close event too)
    this.mainWindow.on('resize', () => this.saveWindowState());
    this.mainWindow.on('move',   () => this.saveWindowState());
    this.mainWindow.on('close',  () => this.saveWindowState());

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

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Decide the window size and position for this launch.
   *
   * Strategy:
   * 1. If a saved state exists AND the saved bounds are still on a connected
   *    display, restore them exactly (user's last preference).
   * 2. Otherwise compute the ideal size from the primary display's work area
   *    and centre the window on that display.
   */
  private resolveWindowState(): WindowState {
    const saved = this.windowStore.store;
    const hasSavedPosition = saved.x !== undefined && saved.y !== undefined;

    if (hasSavedPosition && this.isOnConnectedDisplay(saved.x!, saved.y!, saved.width, saved.height)) {
      return saved;
    }

    // First launch or display topology changed — compute ideal size
    return this.computeIdealState();
  }

  /**
   * Compute the ideal window size and centred position for the primary display.
   */
  private computeIdealState(): WindowState {
    try {
      const { workArea } = screen.getPrimaryDisplay();

      const width  = clamp(Math.round(workArea.width  * IDEAL_WIDTH_RATIO),  MIN_WIDTH,  MAX_WIDTH);
      const height = clamp(Math.round(workArea.height * IDEAL_HEIGHT_RATIO), MIN_HEIGHT, MAX_HEIGHT);

      // Centre on the work area
      const x = workArea.x + Math.round((workArea.width  - width)  / 2);
      const y = workArea.y + Math.round((workArea.height - height) / 2);

      return { width, height, x, y, maximized: false };
    } catch {
      // screen API unavailable (e.g. headless CI) — use safe fallback
      return { width: FALLBACK_WIDTH, height: FALLBACK_HEIGHT, x: undefined, y: undefined, maximized: false };
    }
  }

  /**
   * Returns true if the given bounds overlap at least one connected display,
   * so we don't restore a window to a disconnected monitor.
   */
  private isOnConnectedDisplay(x: number, y: number, width: number, height: number): boolean {
    try {
      const displays = screen.getAllDisplays();
      return displays.some(d => {
        const wa = d.workArea;
        // Require at least 100×50 px of the window to be visible
        const overlapX = Math.max(0, Math.min(x + width,  wa.x + wa.width)  - Math.max(x, wa.x));
        const overlapY = Math.max(0, Math.min(y + height, wa.y + wa.height) - Math.max(y, wa.y));
        return overlapX >= 100 && overlapY >= 50;
      });
    } catch {
      return false;
    }
  }

  /** Persist the current window geometry (skips when maximized to keep the restore size). */
  private saveWindowState(): void {
    if (!this.mainWindow) return;
    const isMaximized = this.mainWindow.isMaximized();
    this.windowStore.set('maximized', isMaximized);
    if (!isMaximized) {
      const [width, height] = this.mainWindow.getSize();
      const [x, y]          = this.mainWindow.getPosition();
      this.windowStore.set('width',  width);
      this.windowStore.set('height', height);
      this.windowStore.set('x', x);
      this.windowStore.set('y', y);
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
