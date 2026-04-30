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
      const iconPath = join(__dirname, '../../assets/icons/tray.png');
      const icon = nativeImage.createFromPath(iconPath);
      this.tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
      this.tray.setToolTip('FileDrop');

      const contextMenu = Menu.buildFromTemplate([
        {
          label: 'Open FileDrop',
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
    // Settings changes are applied on next relevant operation
    // For name/port changes, update discovery service
  }

  private shutdown(): void {
    this.discoveryService?.stop();
    this.transferServer?.stop();
    this.tray?.destroy();
  }
}
