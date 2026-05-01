/**
 * AppBootstrapper.ts
 * App lifecycle, dependency wiring, tray icon setup.
 * This is the composition root — wires all services together.
 */

import { app, Tray, Menu, nativeImage } from 'electron';
import { join } from 'path';
import { WindowManager } from './WindowManager';
import { SettingsStore } from '../store/SettingsStore';
import { DiscoveryService } from '../discovery/DiscoveryService';
import { TransferServer } from '../transfer/TransferServer';
import { TransferClient } from '../transfer/TransferClient';
import { TransferQueue } from '../transfer/TransferQueue';
import { NotificationManager } from '../notifications/NotificationManager';
import { IpcBridge } from '../ipc/IpcBridge';
import type { Platform } from '../../shared/models/Device';

function getElectronPlatform(): Platform {
  switch (process.platform) {
    case 'win32': return 'windows';
    case 'darwin': return 'macos';
    case 'linux': return 'linux';
    default: return 'unknown';
  }
}

export class AppBootstrapper {
  private windowManager: WindowManager;
  private settingsStore: SettingsStore;
  private discoveryService: DiscoveryService | null = null;
  private transferServer: TransferServer | null = null;
  private transferClient: TransferClient | null = null;
  private transferQueue: TransferQueue | null = null;
  private notificationManager: NotificationManager | null = null;
  private ipcBridge: IpcBridge | null = null;
  private tray: Tray | null = null;

  constructor() {
    this.windowManager = new WindowManager();
    this.settingsStore = new SettingsStore();
  }

  async bootstrap(): Promise<void> {
    await app.whenReady();

    // Remove the default Electron application menu on every platform.
    // Must be called before any window is created so it takes effect immediately.
    Menu.setApplicationMenu(null);

    const settings = this.settingsStore.get();

    // Initialize services
    this.notificationManager = new NotificationManager(settings.showNotifications);

    this.transferServer = new TransferServer();
    this.transferClient = new TransferClient();
    this.transferQueue = new TransferQueue(this.transferClient, this.transferServer);

    // Start transfer server and get assigned port
    const port = await this.transferServer.start(settings.transferPort);
    if (settings.transferPort !== port) {
      this.settingsStore.setTransferPort(port);
    }

    // Initialize discovery with the actual port
    this.discoveryService = new DiscoveryService(
      settings.deviceId,
      settings.deviceName,
      getElectronPlatform(),
      port,
      app.getVersion(),
    );

    // Wire IPC
    this.ipcBridge = new IpcBridge({
      discoveryService: this.discoveryService,
      transferQueue: this.transferQueue,
      transferServer: this.transferServer,
      notificationManager: this.notificationManager,
      settingsStore: this.settingsStore,
      getMainWindow: () => this.windowManager.getMainWindow(),
    });
    this.ipcBridge.register();

    // Create window
    this.windowManager.createMainWindow();

    // Start discovery
    this.discoveryService.start();

    // Handle discovery errors gracefully — never let them crash the app
    this.discoveryService.on('error', (err) => {
      console.warn('[Discovery] Non-fatal error:', err.message);
    });

    // Setup tray
    this.setupTray();

    // Handle settings changes that affect services
    this.watchSettingsChanges();

    // macOS: re-create window when dock icon is clicked
    app.on('activate', () => {
      if (!this.windowManager.getMainWindow()) {
        this.windowManager.createMainWindow();
      } else {
        this.windowManager.focusMainWindow();
      }
    });

    // Graceful shutdown
    app.on('before-quit', () => this.shutdown());
  }

  private setupTray(): void {
    try {
      // In a packaged app, assets live outside the asar archive under Resources/.
      // process.resourcesPath points there correctly on all platforms.
      const resourcesPath = process.resourcesPath ?? join(__dirname, '../../');
      const iconPath = join(resourcesPath, 'assets/icons/tray.png');
      const icon = nativeImage.createFromPath(iconPath);
      this.tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
      this.tray.setToolTip('Wyre');

      const contextMenu = Menu.buildFromTemplate([
        {
          label: 'Open Wyre',
          click: () => this.windowManager.focusMainWindow(),
        },
        { type: 'separator' },
        {
          label: 'Quit',
          click: () => app.quit(),
        },
      ]);

      this.tray.setContextMenu(contextMenu);
      this.tray.on('double-click', () => this.windowManager.focusMainWindow());
    } catch {
      // Tray icon not critical — continue without it
    }
  }

  private watchSettingsChanges(): void {
    // Fix 5: Subscribe to the typed SettingsStore 'changed' event instead of
    // listening on the raw IpcChannels.SETTINGS_SET channel. This removes the
    // direct ipcMain dependency from AppBootstrapper and ensures the handler
    // fires after settingsStore.set() has already persisted the new values.
    this.settingsStore.on('changed', (updated) => {
      // Propagate device name / port changes to the discovery broadcaster
      this.discoveryService?.updateAnnouncement({
        name: updated.deviceName,
        port: updated.transferPort,
      });

      // Propagate notification preference
      this.notificationManager?.setEnabled(updated.showNotifications);
    });
  }

  private shutdown(): void {
    this.discoveryService?.stop();
    this.transferServer?.stop();
    this.tray?.destroy();
  }
}
