/**
 * IpcClient.ts
 * Typed wrapper around window.api for use in the renderer.
 * All renderer code should use this instead of window.api directly.
 */

import type { FileDropApi } from '../../preload/index';
import type { Device } from '../../shared/models/Device';
import type { AppSettings } from '../../shared/models/AppSettings';
import type { TransferRecord } from '../../shared/models/Transfer';
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
  TransferQueueUpdatedPayload,
  LogsGetResponse,
} from '../../shared/ipc/IpcContracts';

function getApi(): FileDropApi {
  if (!window.api) throw new Error('window.api is not available — preload script may not be loaded');
  return window.api;
}

export const IpcClient = {
  // Device discovery
  getDevices: (): Promise<Device[]> => getApi().getDevices(),
  onDevicesUpdated: (cb: (payload: DevicesUpdatedPayload) => void): (() => void) =>
    getApi().onDevicesUpdated(cb),

  // File transfer
  sendFile: (payload: TransferSendPayload): Promise<string> => getApi().sendFile(payload),
  cancelTransfer: (payload: TransferCancelPayload): Promise<void> => getApi().cancelTransfer(payload),
  onTransferStarted: (cb: (payload: TransferStartedPayload) => void): (() => void) =>
    getApi().onTransferStarted(cb),
  onTransferProgress: (cb: (payload: TransferProgressPayload) => void): (() => void) =>
    getApi().onTransferProgress(cb),
  onTransferComplete: (cb: (payload: TransferCompletePayload) => void): (() => void) =>
    getApi().onTransferComplete(cb),
  onTransferError: (cb: (payload: TransferErrorPayload) => void): (() => void) =>
    getApi().onTransferError(cb),

  // Send queue (Feature 1)
  onTransferQueueUpdated: (cb: (payload: TransferQueueUpdatedPayload) => void): (() => void) =>
    getApi().onTransferQueueUpdated(cb),

  // Incoming transfers
  respondToIncoming: (payload: IncomingResponsePayload): Promise<void> =>
    getApi().respondToIncoming(payload),
  onIncomingRequest: (cb: (payload: IncomingRequestPayload) => void): (() => void) =>
    getApi().onIncomingRequest(cb),

  // Settings
  getSettings: (): Promise<AppSettings> => getApi().getSettings(),
  setSettings: (payload: SettingsSetPayload): Promise<void> => getApi().setSettings(payload),

  // History
  getHistory: (): Promise<TransferRecord[]> => getApi().getHistory(),
  clearHistory: (): Promise<void> => getApi().clearHistory(),

  // Window controls
  minimizeWindow: (): Promise<void> => getApi().minimizeWindow(),
  maximizeWindow: (): Promise<void> => getApi().maximizeWindow(),
  closeWindow: (): Promise<void> => getApi().closeWindow(),
  isMaximized: (): Promise<boolean> => getApi().isMaximized(),

  // Shell actions
  openFile: (path: string): Promise<void> => getApi().openFile(path),
  showInFolder: (path: string): Promise<void> => getApi().showInFolder(path),

  // Platform
  getPlatform: (): NodeJS.Platform => getApi().platform,

  // Diagnostics (Feature 3)
  getLogs: (): Promise<LogsGetResponse> => getApi().getLogs(),

  // Local network info
  getLocalIp: (): Promise<string> => getApi().getLocalIp(),
} as const;
