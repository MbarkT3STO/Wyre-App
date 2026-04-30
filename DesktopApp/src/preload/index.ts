/**
 * Preload script — contextBridge exposes a typed window.api to the renderer.
 * This is the ONLY bridge between the sandboxed renderer and the main process.
 * nodeIntegration is false; contextIsolation is true.
 */

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { IpcChannels } from '../shared/ipc/IpcContracts';
import type {
  TransferSendPayload,
  TransferCancelPayload,
  IncomingResponsePayload,
  SettingsSetPayload,
  DevicesUpdatedPayload,
  TransferStartedPayload,
  TransferProgressPayload,
  TransferCompletePayload,
  TransferErrorPayload,
  IncomingRequestPayload,
} from '../shared/ipc/IpcContracts';
import type { Device } from '../shared/models/Device';
import type { AppSettings } from '../shared/models/AppSettings';
import type { TransferRecord } from '../shared/models/Transfer';

// ─── Typed API exposed to renderer ───────────────────────────────────────────

export interface FileDropApi {
  // Device discovery
  getDevices: () => Promise<Device[]>;
  onDevicesUpdated: (cb: (payload: DevicesUpdatedPayload) => void) => () => void;

  // File transfer
  sendFile: (payload: TransferSendPayload) => Promise<string>;
  cancelTransfer: (payload: TransferCancelPayload) => Promise<void>;
  onTransferStarted: (cb: (payload: TransferStartedPayload) => void) => () => void;
  onTransferProgress: (cb: (payload: TransferProgressPayload) => void) => () => void;
  onTransferComplete: (cb: (payload: TransferCompletePayload) => void) => () => void;
  onTransferError: (cb: (payload: TransferErrorPayload) => void) => () => void;

  // Incoming transfers
  respondToIncoming: (payload: IncomingResponsePayload) => Promise<void>;
  onIncomingRequest: (cb: (payload: IncomingRequestPayload) => void) => () => void;

  // Settings
  getSettings: () => Promise<AppSettings>;
  setSettings: (payload: SettingsSetPayload) => Promise<void>;

  // History
  getHistory: () => Promise<TransferRecord[]>;
  clearHistory: () => Promise<void>;

  // Window controls
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  isMaximized: () => Promise<boolean>;

  // Platform info
  platform: NodeJS.Platform;
}

// ─── Helper: create a listener that returns an unsubscribe function ───────────

function createListener<T>(
  channel: string,
  cb: (payload: T) => void,
): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// ─── API implementation ───────────────────────────────────────────────────────

const api: FileDropApi = {
  // Device discovery
  getDevices: () => ipcRenderer.invoke(IpcChannels.DEVICES_LIST_GET),
  onDevicesUpdated: (cb) => createListener(IpcChannels.DEVICES_UPDATED, cb),

  // File transfer
  sendFile: (payload) => ipcRenderer.invoke(IpcChannels.TRANSFER_SEND, payload),
  cancelTransfer: (payload) => ipcRenderer.invoke(IpcChannels.TRANSFER_CANCEL, payload),
  onTransferStarted: (cb) => createListener(IpcChannels.TRANSFER_STARTED, cb),
  onTransferProgress: (cb) => createListener(IpcChannels.TRANSFER_PROGRESS, cb),
  onTransferComplete: (cb) => createListener(IpcChannels.TRANSFER_COMPLETE, cb),
  onTransferError: (cb) => createListener(IpcChannels.TRANSFER_ERROR, cb),

  // Incoming transfers
  respondToIncoming: (payload) => ipcRenderer.invoke(IpcChannels.INCOMING_RESPONSE, payload),
  onIncomingRequest: (cb) => createListener(IpcChannels.INCOMING_REQUEST, cb),

  // Settings
  getSettings: () => ipcRenderer.invoke(IpcChannels.SETTINGS_GET),
  setSettings: (payload) => ipcRenderer.invoke(IpcChannels.SETTINGS_SET, payload),

  // History
  getHistory: () => ipcRenderer.invoke(IpcChannels.HISTORY_GET),
  clearHistory: () => ipcRenderer.invoke(IpcChannels.HISTORY_CLEAR),

  // Window controls
  minimizeWindow: () => ipcRenderer.invoke(IpcChannels.WINDOW_MINIMIZE),
  maximizeWindow: () => ipcRenderer.invoke(IpcChannels.WINDOW_MAXIMIZE),
  closeWindow: () => ipcRenderer.invoke(IpcChannels.WINDOW_CLOSE),
  isMaximized: () => ipcRenderer.invoke(IpcChannels.WINDOW_IS_MAXIMIZED),

  // Platform info
  platform: process.platform,
};

contextBridge.exposeInMainWorld('api', api);

// ─── Type augmentation for renderer ──────────────────────────────────────────

declare global {
  interface Window {
    api: FileDropApi;
  }
}
