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
import type { TransferSendPayload, TransferCancelPayload, IncomingResponsePayload } from '../../../shared/ipc/IpcContracts';

export function registerTransferHandlers(
  ipcMain: IpcMain,
  transferQueue: TransferQueue,
  discoveryService: DiscoveryService,
  settingsStore: SettingsStore,
): void {
  ipcMain.handle(IpcChannels.TRANSFER_SEND, async (_event, payload: TransferSendPayload): Promise<string> => {
    const devices = discoveryService.getDevices();
    const peer = devices.find(d => d.id === payload.deviceId);
    if (!peer) throw new Error(`Device ${payload.deviceId} not found or offline`);

    const settings = settingsStore.get();
    return transferQueue.enqueueSend({
      filePath: payload.filePath,
      peerIp: peer.ip,
      peerPort: peer.port,
      peerId: peer.id,
      peerName: peer.name,
      senderDeviceId: settings.deviceId,
      senderName: settings.deviceName,
    });
  });

  ipcMain.handle(IpcChannels.TRANSFER_CANCEL, (_event, payload: TransferCancelPayload): void => {
    transferQueue.cancelTransfer(payload.transferId);
  });

  ipcMain.handle(IpcChannels.INCOMING_RESPONSE, (_event, payload: IncomingResponsePayload): void => {
    if (payload.accepted) {
      const settings = settingsStore.get();
      transferQueue.acceptIncoming(payload.transferId, settings.saveDirectory);
    } else {
      transferQueue.declineIncoming(payload.transferId);
    }
  });

  ipcMain.handle(IpcChannels.HISTORY_GET, () => {
    return transferQueue.getHistory();
  });

  ipcMain.handle(IpcChannels.HISTORY_CLEAR, () => {
    transferQueue.clearHistory();
  });
}
