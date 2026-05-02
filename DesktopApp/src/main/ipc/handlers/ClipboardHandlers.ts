/**
 * ClipboardHandlers.ts
 * IPC handler for clipboard text sharing.
 * Reuses the TransferClient TCP connection infrastructure to send a
 * lightweight JSON clipboard frame instead of a file.
 */

import { IpcMain } from 'electron';
import { connect } from 'net';
import { IpcChannels } from '../../../shared/ipc/IpcContracts';
import type { ClipboardSendPayload, ClipboardReceivedPayload } from '../../../shared/ipc/IpcContracts';
import type { DiscoveryService } from '../../discovery/DiscoveryService';
import type { SettingsStore } from '../../store/SettingsStore';
import { Logger } from '../../logging/Logger';

const CLIPBOARD_MAX_CHARS = 5000;

function logger(): Logger | null {
  try { return Logger.getInstance(); } catch { return null; }
}

export function registerClipboardHandlers(
  ipcMain: IpcMain,
  discoveryService: DiscoveryService,
  settingsStore: SettingsStore,
): void {
  ipcMain.handle(IpcChannels.CLIPBOARD_SEND, async (_event, payload: unknown): Promise<void> => {
    const { deviceId, text } = validateClipboardPayload(payload);

    const devices = discoveryService.getDevices();
    const peer = devices.find(d => d.id === deviceId);
    if (!peer) throw new Error(`Device ${deviceId} not found or offline`);

    const settings = settingsStore.get();
    const truncated = text.length > CLIPBOARD_MAX_CHARS;
    const safeText = truncated ? text.slice(0, CLIPBOARD_MAX_CHARS) : text;

    return new Promise<void>((resolve, reject) => {
      const socket = connect({ host: peer.ip, port: peer.port }, () => {
        socket.setNoDelay(true);

        // Send a clipboard frame — same newline-terminated JSON header format
        // as file transfers, but with type: 'clipboard' so the server can
        // distinguish it from a file transfer without reading further.
        const frame = JSON.stringify({
          type: 'clipboard',
          senderDeviceId: settings.deviceId,
          senderName: settings.deviceName,
          text: safeText,
          truncated,
        }) + '\n';

        socket.write(frame);
        socket.end();
        resolve();
      });

      socket.setTimeout(5000);
      socket.on('timeout', () => {
        socket.destroy(new Error('Clipboard send timed out'));
      });

      socket.on('error', (err) => {
        logger()?.warn('Clipboard send failed', { deviceId, error: err.message });
        reject(err);
      });
    });
  });
}

/** Push a received clipboard payload to the renderer */
export function pushClipboardReceived(
  getMainWindow: () => BrowserWindow | null,
  payload: ClipboardReceivedPayload,
): void {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(IpcChannels.CLIPBOARD_RECEIVED, payload);
  }
}

export function validateClipboardPayload(payload: unknown): ClipboardSendPayload {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as Record<string, unknown>)['deviceId'] !== 'string' ||
    typeof (payload as Record<string, unknown>)['text'] !== 'string'
  ) {
    throw new Error('Invalid clipboard payload');
  }
  return payload as ClipboardSendPayload;
}
