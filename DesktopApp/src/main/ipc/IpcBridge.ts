/**
 * IpcBridge.ts
 * Registers all ipcMain handlers and wires service events to renderer pushes.
 * This is the only file that knows about both Electron IPC and the service layer.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { IpcChannels } from '../../shared/ipc/IpcContracts';
import type { DiscoveryService } from '../discovery/DiscoveryService';
import type { TransferQueue } from '../transfer/TransferQueue';
import type { TransferServer } from '../transfer/TransferServer';
import type { NotificationManager } from '../notifications/NotificationManager';
import type { SettingsStore } from '../store/SettingsStore';
import { registerDeviceHandlers } from './handlers/DeviceHandlers';
import { registerTransferHandlers } from './handlers/TransferHandlers';
import { registerSettingsHandlers } from './handlers/SettingsHandlers';
import { registerDiagnosticsHandlers } from './handlers/DiagnosticsHandlers';
import { registerClipboardHandlers, pushClipboardReceived } from './handlers/ClipboardHandlers';
import { Logger } from '../logging/Logger';
import type { Transfer } from '../../shared/models/Transfer';
import { TransferStatus } from '../../shared/models/Transfer';

export class IpcBridge {
  private discoveryService: DiscoveryService;
  private transferQueue: TransferQueue;
  private transferServer: TransferServer;
  private notificationManager: NotificationManager;
  private settingsStore: SettingsStore;
  private getMainWindow: () => BrowserWindow | null;

  constructor(options: {
    discoveryService: DiscoveryService;
    transferQueue: TransferQueue;
    transferServer: TransferServer;
    notificationManager: NotificationManager;
    settingsStore: SettingsStore;
    getMainWindow: () => BrowserWindow | null;
  }) {
    this.discoveryService = options.discoveryService;
    this.transferQueue = options.transferQueue;
    this.transferServer = options.transferServer;
    this.notificationManager = options.notificationManager;
    this.settingsStore = options.settingsStore;
    this.getMainWindow = options.getMainWindow;
  }

  register(): void {
    // Register invoke handlers
    registerDeviceHandlers(ipcMain, this.discoveryService);
    registerTransferHandlers(ipcMain, this.transferQueue, this.discoveryService, this.settingsStore);
    registerSettingsHandlers(ipcMain, this.settingsStore, this.getMainWindow);
    registerDiagnosticsHandlers(ipcMain);
    registerClipboardHandlers(ipcMain, this.discoveryService, this.settingsStore);

    // Wire service events → renderer pushes
    this.wireDiscoveryEvents();
    this.wireTransferEvents();
    this.wireIncomingEvents();
    this.wireQueueEvents();
    this.wireClipboardEvents();
  }

  private send(channel: string, payload: unknown): void {
    const win = this.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }

  private logger(): Logger | null {
    try { return Logger.getInstance(); } catch { return null; }
  }

  private wireDiscoveryEvents(): void {
    this.discoveryService.on('devicesChanged', (devices) => {
      this.send(IpcChannels.DEVICES_UPDATED, { devices });
    });
  }

  /** Wire the pending-send queue updates to the renderer (Feature 1) */
  private wireQueueEvents(): void {
    this.transferQueue.on('queueUpdated', (queue) => {
      this.send(IpcChannels.TRANSFER_QUEUE_UPDATED, {
        queue: queue.map(item => ({
          fileName: item.fileName,
          fileSize: item.fileSize,
          deviceId: item.peerId,
        })),
      });
    });
  }

  private wireTransferEvents(): void {
    this.transferQueue.on('transferUpdated', (transfer: Transfer) => {
      switch (transfer.status) {
        case TransferStatus.Connecting:
        case TransferStatus.Pending:
          // Seed the renderer with the initial transfer entry so progress events land
          this.send(IpcChannels.TRANSFER_STARTED, {
            transferId: transfer.id,
            direction: transfer.direction,
            peerId: transfer.peerId,
            peerName: transfer.peerName,
            fileName: transfer.fileName,
            fileSize: transfer.fileSize,
            status: transfer.status,
          });
          break;

        case TransferStatus.Active:
          // Re-seed the renderer entry on the first Active event in case the
          // initial TRANSFER_STARTED was missed (e.g. race during navigation).
          this.send(IpcChannels.TRANSFER_STARTED, {
            transferId: transfer.id,
            direction: transfer.direction,
            peerId: transfer.peerId,
            peerName: transfer.peerName,
            fileName: transfer.fileName,
            fileSize: transfer.fileSize,
            status: transfer.status,
          });
          this.send(IpcChannels.TRANSFER_PROGRESS, {
            transferId: transfer.id,
            progress: transfer.progress,
            speed: transfer.speed,
            eta: transfer.eta,
            bytesTransferred: transfer.bytesTransferred,
            totalBytes: transfer.fileSize,
          });
          break;

        case TransferStatus.Completed:
          this.send(IpcChannels.TRANSFER_COMPLETE, {
            transferId: transfer.id,
            savedPath: transfer.savedPath ?? '',
          });
          if (transfer.direction === 'receive' && transfer.savedPath) {
            this.notificationManager.notifyTransferComplete(transfer.fileName, transfer.savedPath);
          }
          break;

        case TransferStatus.Failed:
          this.send(IpcChannels.TRANSFER_ERROR, {
            transferId: transfer.id,
            error: transfer.errorMessage ?? 'Unknown error',
            code: transfer.errorCode ?? 'UNKNOWN',
          });
          this.logger()?.warn('IPC: transfer error pushed to renderer', {
            transferId: transfer.id,
            error: transfer.errorMessage ?? 'Unknown error',
          });
          if (transfer.direction === 'receive') {
            this.notificationManager.notifyTransferFailed(transfer.fileName, transfer.errorMessage ?? 'Unknown error');
          }
          break;

        case TransferStatus.Cancelled:
        case TransferStatus.Declined:
          this.send(IpcChannels.TRANSFER_ERROR, {
            transferId: transfer.id,
            error: transfer.status === TransferStatus.Declined ? 'Declined by recipient' : 'Cancelled',
            code: transfer.status.toUpperCase(),
          });
          break;

        case TransferStatus.Paused:
          this.send(IpcChannels.TRANSFER_PAUSED, {
            transferId: transfer.id,
            bytesTransferred: transfer.bytesTransferred,
          });
          break;
      }
    });
  }

  private wireClipboardEvents(): void {
    this.transferServer.on('clipboardReceived', (senderName, text, truncated) => {
      pushClipboardReceived(this.getMainWindow, { senderName, text, truncated });
    });
  }

  private wireIncomingEvents(): void {
    this.transferServer.on('incomingRequest', (request) => {
      const settings = this.settingsStore.get();

      // Register in queue
      this.transferQueue.registerIncoming({
        transferId: request.transferId,
        peerId: request.senderDeviceId,
        peerName: request.senderName,
        fileName: request.fileName,
        fileSize: request.fileSize,
        checksum: request.checksum,
      });

      // Auto-accept logic — only if autoAccept is enabled AND the device is
      // explicitly listed in trustedDeviceIds. An empty trusted list means
      // "no devices are trusted yet", not "trust everyone".
      if (settings.autoAccept && settings.trustedDeviceIds.length > 0) {
        const isTrusted = settings.trustedDeviceIds.includes(request.senderDeviceId);
        if (isTrusted) {
          this.transferQueue.acceptIncoming(request.transferId, settings.saveDirectory);
          return;
        }
      }

      // Show incoming dialog in renderer
      this.send(IpcChannels.INCOMING_REQUEST, {
        transferId: request.transferId,
        senderName: request.senderName,
        senderDeviceId: request.senderDeviceId,
        fileName: request.fileName,
        fileSize: request.fileSize,
        checksum: request.checksum,
      });

      this.notificationManager.notifyIncomingRequest(request.senderName, request.fileName);

      // Auto-decline after timeout
      const timeout = settings.autoDeclineTimeout * 1000;
      const timer = setTimeout(() => {
        this.transferQueue.declineIncoming(request.transferId);
      }, timeout);

      // Cancel auto-decline if user responds
      const onUpdate = (transfer: Transfer): void => {
        if (transfer.id === request.transferId &&
            transfer.status !== TransferStatus.Pending) {
          clearTimeout(timer);
          this.transferQueue.removeListener('transferUpdated', onUpdate);
        }
      };
      this.transferQueue.on('transferUpdated', onUpdate);
    });
  }
}
