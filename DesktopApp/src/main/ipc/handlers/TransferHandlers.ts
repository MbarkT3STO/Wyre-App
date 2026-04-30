/**
 * TransferHandlers.ts
 * IPC handlers for file transfer operations.
 * Delegates to TransferQueue — no business logic here.
 */

import { IpcMain } from 'electron';
import { IpcChannels } from '../../../shared/ipc/IpcContracts';
import type { TransferQueue } from '../../transfer/TransferQueue';
import type { DiscoveryService } from '../../discovery/DiscoveryService';
import type { SettingsStore } from '../../store/SettingsStore';
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
}
