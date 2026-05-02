/**
 * AppBridge.ts
 * Replaces Electron's IpcClient. All renderer code calls this instead of
 * window.api. Delegates to the native WyrePlugin via Capacitor.
 */

import { WyrePlugin } from './WyrePlugin';
import type {
  DevicesUpdatedEvent,
  TransferStartedEvent,
  TransferProgressEvent,
  TransferCompleteEvent,
  TransferErrorEvent,
  TransferPausedEvent,
  IncomingRequestEvent,
  TransferQueueUpdatedEvent,
  ClipboardReceivedEvent,
} from './WyrePlugin';
import type { Device } from '../shared/models/Device';
import type { AppSettings } from '../shared/models/AppSettings';
import type { TransferRecord } from '../shared/models/Transfer';

export const AppBridge = {
  // ── Settings ──────────────────────────────────────────────────────────────
  getSettings: (): Promise<AppSettings> =>
    WyrePlugin.getSettings(),

  setSettings: (partial: Partial<AppSettings> & { backgroundService?: boolean }): Promise<void> =>
    WyrePlugin.setSettings(partial as Partial<AppSettings>),

  // ── Device discovery ──────────────────────────────────────────────────────
  getDevices: async (): Promise<Device[]> => {
    const { devices } = await WyrePlugin.getDevices();
    return devices;
  },

  onDevicesUpdated: async (cb: (data: DevicesUpdatedEvent) => void): Promise<() => void> => {
    const handle = await WyrePlugin.addListener('devicesUpdated', cb);
    return () => handle.remove();
  },

  // ── File transfer ─────────────────────────────────────────────────────────
  sendFile: async (options: { deviceId: string; filePath: string; fileName: string; fileSize: number }): Promise<string> => {
    const { transferId } = await WyrePlugin.sendFile(options);
    return transferId;
  },

  /** Feature 1: Zip a folder natively and send it. folderUri is the content:// URI from pickFolder. */
  sendFolder: async (options: { deviceId: string; folderUri: string; folderName: string }): Promise<string> => {
    const { transferId } = await WyrePlugin.sendFolder(options);
    return transferId;
  },

  cancelTransfer: (options: { transferId: string }): Promise<void> =>
    WyrePlugin.cancelTransfer(options),

  /** Feature 4: Resume a paused transfer */
  resumeTransfer: (options: { transferId: string }): Promise<void> =>
    WyrePlugin.resumeTransfer(options),

  respondToIncoming: (options: { transferId: string; accepted: boolean; savePath?: string }): Promise<void> =>
    WyrePlugin.respondToIncoming(options),

  onTransferStarted: async (cb: (data: TransferStartedEvent) => void): Promise<() => void> => {
    const handle = await WyrePlugin.addListener('transferStarted', cb);
    return () => handle.remove();
  },

  onTransferProgress: async (cb: (data: TransferProgressEvent) => void): Promise<() => void> => {
    const handle = await WyrePlugin.addListener('transferProgress', cb);
    return () => handle.remove();
  },

  onTransferComplete: async (cb: (data: TransferCompleteEvent) => void): Promise<() => void> => {
    const handle = await WyrePlugin.addListener('transferComplete', cb);
    return () => handle.remove();
  },

  onTransferError: async (cb: (data: TransferErrorEvent) => void): Promise<() => void> => {
    const handle = await WyrePlugin.addListener('transferError', cb);
    return () => handle.remove();
  },

  /** Feature 4: Transfer paused (resumable) */
  onTransferPaused: async (cb: (data: TransferPausedEvent) => void): Promise<() => void> => {
    const handle = await WyrePlugin.addListener('transferPaused', cb);
    return () => handle.remove();
  },

  onIncomingRequest: async (cb: (data: IncomingRequestEvent) => void): Promise<() => void> => {
    const handle = await WyrePlugin.addListener('incomingRequest', cb);
    return () => handle.remove();
  },

  onTransferQueueUpdated: async (cb: (data: TransferQueueUpdatedEvent) => void): Promise<() => void> => {
    const handle = await WyrePlugin.addListener('transferQueueUpdated', cb);
    return () => handle.remove();
  },

  // ── Clipboard (Feature 2) ─────────────────────────────────────────────────
  sendClipboard: async (options: { deviceId: string; text: string }): Promise<void> =>
    WyrePlugin.sendClipboard(options),

  onClipboardReceived: async (cb: (data: ClipboardReceivedEvent) => void): Promise<() => void> => {
    const handle = await WyrePlugin.addListener('clipboardReceived', cb);
    return () => handle.remove();
  },

  // ── History ───────────────────────────────────────────────────────────────
  getHistory: async (): Promise<TransferRecord[]> => {
    const { history } = await WyrePlugin.getHistory();
    return history;
  },

  clearHistory: (): Promise<void> =>
    WyrePlugin.clearHistory(),

  // ── File picker ───────────────────────────────────────────────────────────
  pickFiles: async (): Promise<Array<{ path: string; name: string; size: number }>> => {
    const result = await WyrePlugin.pickFile();
    if (!result || !('files' in result)) return [];
    const files = result.files;
    return Array.isArray(files) ? files : [];
  },

  pickFolder: async (): Promise<{ path: string; uri: string } | null> => {
    const result = await WyrePlugin.pickFolder();
    if (!result?.path && !result?.uri) return null;
    return { path: result.path ?? '', uri: result.uri ?? '' };
  },

  // ── Shell actions ─────────────────────────────────────────────────────────
  openFile: (path: string): Promise<void> =>
    WyrePlugin.openFile({ path }),

  showInFolder: (path: string): Promise<void> =>
    WyrePlugin.showInFolder({ path }),

  // ── Platform ──────────────────────────────────────────────────────────────
  getPlatform: (): string => 'android',
} as const;
