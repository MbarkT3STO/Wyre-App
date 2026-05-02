/**
 * TransferHandlers.ts
 * IPC handlers for file transfer operations.
 * Delegates to TransferQueue — no business logic here.
 */

import { IpcMain } from 'electron';
import { app } from 'electron';
import { join, basename } from 'path';
import { IpcChannels } from '../../../shared/ipc/IpcContracts';
import type { TransferQueue } from '../../transfer/TransferQueue';
import type { DiscoveryService } from '../../discovery/DiscoveryService';
import type { SettingsStore } from '../../store/SettingsStore';
import { FolderZipper } from '../../transfer/FolderZipper';
import { FileChunker } from '../../transfer/FileChunker';
import {
  validateTransferSendPayload,
  validateTransferCancelPayload,
  validateIncomingResponsePayload,
} from '../validators/IpcPayloadValidator';

export function registerTransferHandlers(
  ipcMain: IpcMain,
  transferQueue: TransferQueue,
  discoveryService: DiscoveryService,
  settingsStore: SettingsStore,
): void {
  ipcMain.handle(IpcChannels.TRANSFER_SEND, async (_event, payload: unknown): Promise<string> => {
    const { deviceId, filePath } = validateTransferSendPayload(payload);

    const devices = discoveryService.getDevices();
    const peer = devices.find(d => d.id === deviceId);
    if (!peer) throw new Error(`Device ${deviceId} not found or offline`);

    const settings = settingsStore.get();
    return transferQueue.enqueueSend({
      filePath,
      peerIp: peer.ip,
      peerPort: peer.port,
      peerId: peer.id,
      peerName: peer.name,
      senderDeviceId: settings.deviceId,
      senderName: settings.deviceName,
    });
  });

  ipcMain.handle(IpcChannels.TRANSFER_CANCEL, (_event, payload: unknown): void => {
    const { transferId } = validateTransferCancelPayload(payload);
    transferQueue.cancelTransfer(transferId);
  });

  ipcMain.handle(IpcChannels.INCOMING_RESPONSE, (_event, payload: unknown): void => {
    const { transferId, accepted } = validateIncomingResponsePayload(payload);
    if (accepted) {
      const settings = settingsStore.get();
      transferQueue.acceptIncoming(transferId, settings.saveDirectory);
    } else {
      transferQueue.declineIncoming(transferId);
    }
  });

  ipcMain.handle(IpcChannels.HISTORY_GET, () => {
    return transferQueue.getHistory();
  });

  ipcMain.handle(IpcChannels.HISTORY_CLEAR, () => {
    transferQueue.clearHistory();
  });

  // ── Folder zip-and-send ────────────────────────────────────────────────────
  ipcMain.handle(IpcChannels.FOLDER_ZIP_AND_SEND, async (_event, payload: unknown): Promise<string> => {
    if (
      typeof payload !== 'object' || payload === null ||
      typeof (payload as Record<string, unknown>)['folderPath'] !== 'string' ||
      typeof (payload as Record<string, unknown>)['deviceId'] !== 'string'
    ) {
      throw new Error('Invalid folder zip payload');
    }
    const { folderPath, deviceId } = payload as { folderPath: string; deviceId: string };

    const devices = discoveryService.getDevices();
    const peer = devices.find(d => d.id === deviceId);
    if (!peer) throw new Error(`Device ${deviceId} not found or offline`);

    const settings = settingsStore.get();
    const folderName = basename(folderPath);
    const tempZipPath = join(app.getPath('temp'), `wyre-${Date.now()}-${folderName}.zip`);

    // Zip the folder (progress is internal — no IPC push for zip progress)
    await FolderZipper.zip(folderPath, tempZipPath, (_pct) => { /* progress available if needed */ });

    // Enqueue the zip for sending; clean up temp file after transfer completes
    const transferId = await transferQueue.enqueueSend({
      filePath: tempZipPath,
      peerIp: peer.ip,
      peerPort: peer.port,
      peerId: peer.id,
      peerName: peer.name,
      senderDeviceId: settings.deviceId,
      senderName: settings.deviceName,
    });

    // Schedule temp file cleanup after a generous delay
    // (the transfer may be queued and not start immediately)
    const cleanup = (): void => {
      const onUpdate = (transfer: import('../../../shared/models/Transfer').Transfer): void => {
        if (transfer.id !== transferId) return;
        const done =
          transfer.status === 'completed' ||
          transfer.status === 'failed' ||
          transfer.status === 'cancelled' ||
          transfer.status === 'declined';
        if (done) {
          transferQueue.removeListener('transferUpdated', onUpdate);
          FileChunker.deleteFile(tempZipPath).catch(() => { /* non-fatal */ });
        }
      };
      transferQueue.on('transferUpdated', onUpdate);
    };
    cleanup();

    return transferId;
  });

  // ── Transfer resume ────────────────────────────────────────────────────────
  ipcMain.handle(IpcChannels.TRANSFER_RESUME, async (_event, payload: unknown): Promise<void> => {
    if (
      typeof payload !== 'object' || payload === null ||
      typeof (payload as Record<string, unknown>)['transferId'] !== 'string'
    ) {
      throw new Error('Invalid resume payload');
    }
    const { transferId } = payload as { transferId: string };

    // Look up the paused transfer to get peer info
    const history = transferQueue.getHistory();
    void history; // history doesn't have peer IP — we need the live transfer

    // Resolve peer from discovery service
    const transfer = transferQueue.getPausedTransfer(transferId);
    if (!transfer) throw new Error(`Transfer ${transferId} not found or not paused`);

    const devices = discoveryService.getDevices();
    const peer = devices.find(d => d.id === transfer.peerId);
    if (!peer) throw new Error(`Peer device ${transfer.peerId} is no longer online`);

    const settings = settingsStore.get();
    await transferQueue.resumeTransferWithPeer(
      transferId,
      peer.ip,
      peer.port,
      settings.deviceId,
      settings.deviceName,
    );
  });
}
