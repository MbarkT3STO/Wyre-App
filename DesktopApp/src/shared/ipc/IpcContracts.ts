/**
 * IpcContracts.ts
 * Single source of truth for all IPC channel names and payload types.
 * Both main process (IpcBridge) and renderer (IpcClient) import from here.
 * Zero `any` types allowed.
 */

// ─── Channel Names ────────────────────────────────────────────────────────────

export const IpcChannels = {
  // Device discovery
  DEVICES_LIST_GET: 'devices:list:get',
  DEVICES_UPDATED: 'devices:updated',

  // File transfer — outgoing
  TRANSFER_SEND: 'transfer:send',
  TRANSFER_STARTED: 'transfer:started',
  TRANSFER_PROGRESS: 'transfer:progress',
  TRANSFER_COMPLETE: 'transfer:complete',
  TRANSFER_ERROR: 'transfer:error',
  TRANSFER_CANCEL: 'transfer:cancel',

  // File transfer — send queue (Feature 1)
  TRANSFER_QUEUE_UPDATED: 'transfer:queue:updated',

  // File transfer — incoming
  INCOMING_REQUEST: 'incoming:request',
  INCOMING_RESPONSE: 'incoming:response',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  // Transfer history
  HISTORY_GET: 'history:get',
  HISTORY_CLEAR: 'history:clear',

  // Window controls
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:isMaximized',

  // Shell actions
  SHELL_OPEN_FILE: 'shell:openFile',
  SHELL_SHOW_IN_FOLDER: 'shell:showInFolder',

  // Diagnostics / logging (Feature 3)
  LOGS_GET: 'logs:get',

  // Local network info
  LOCAL_IP_GET: 'local:ip:get',

  // Native directory picker
  DIALOG_OPEN_DIRECTORY: 'dialog:openDirectory',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

// ─── Payload Types ────────────────────────────────────────────────────────────

/** Sent by renderer to request the current device list */
export type DevicesListGetPayload = void;

/** Pushed by main to renderer when device list changes */
export interface DevicesUpdatedPayload {
  devices: import('../models/Device').Device[];
}

/** Renderer → main: initiate a file send */
export interface TransferSendPayload {
  deviceId: string;
  filePath: string;
}

/** Main → renderer: a new transfer has been registered (seed the renderer state) */
export interface TransferStartedPayload {
  transferId: string;
  direction: import('../models/Transfer').TransferDirection;
  peerId: string;
  peerName: string;
  fileName: string;
  fileSize: number;
  status: import('../models/Transfer').TransferStatus;
}

/** Main → renderer: transfer progress update */
export interface TransferProgressPayload {
  transferId: string;
  progress: number;   // 0–100
  speed: number;      // bytes/sec
  eta: number;        // seconds remaining
  bytesTransferred: number;
  totalBytes: number;
}

/** Main → renderer: transfer completed successfully */
export interface TransferCompletePayload {
  transferId: string;
  savedPath: string;
}

/** Main → renderer: transfer failed */
export interface TransferErrorPayload {
  transferId: string;
  error: string;
  code: string;
}

/** Renderer → main: cancel an in-progress transfer */
export interface TransferCancelPayload {
  transferId: string;
}

/** Main → renderer: incoming file request from a peer */
export interface IncomingRequestPayload {
  transferId: string;
  senderName: string;
  senderDeviceId: string;
  fileName: string;
  fileSize: number;
  checksum: string;
}

/** Renderer → main: user's response to an incoming request */
export interface IncomingResponsePayload {
  transferId: string;
  accepted: boolean;
}

/** Main → renderer: pending send queue updated (Feature 1) */
export interface TransferQueueUpdatedPayload {
  queue: Array<{
    fileName: string;
    fileSize: number;
    deviceId: string;
  }>;
}

/** Main → renderer: last N lines of the log file (Feature 3) */
export interface LogsGetResponse {
  lines: string[];
}

/** Main → renderer: current settings */
export type SettingsGetResponse = import('../models/AppSettings').AppSettings;

/** Renderer → main: update settings */
export type SettingsSetPayload = Partial<import('../models/AppSettings').AppSettings>;

/** Main → renderer: transfer history list */
export type HistoryGetResponse = import('../models/Transfer').TransferRecord[];

// ─── Typed IPC Map (for type-safe invoke/handle) ─────────────────────────────

export interface IpcInvokeMap {
  [IpcChannels.DEVICES_LIST_GET]: [DevicesListGetPayload, import('../models/Device').Device[]];
  [IpcChannels.TRANSFER_SEND]: [TransferSendPayload, string]; // returns transferId
  [IpcChannels.TRANSFER_CANCEL]: [TransferCancelPayload, void];
  [IpcChannels.INCOMING_RESPONSE]: [IncomingResponsePayload, void];
  [IpcChannels.SETTINGS_GET]: [void, SettingsGetResponse];
  [IpcChannels.SETTINGS_SET]: [SettingsSetPayload, void];
  [IpcChannels.HISTORY_GET]: [void, HistoryGetResponse];
  [IpcChannels.HISTORY_CLEAR]: [void, void];
  [IpcChannels.WINDOW_MINIMIZE]: [void, void];
  [IpcChannels.WINDOW_MAXIMIZE]: [void, void];
  [IpcChannels.WINDOW_CLOSE]: [void, void];
  [IpcChannels.WINDOW_IS_MAXIMIZED]: [void, boolean];
  [IpcChannels.SHELL_OPEN_FILE]: [{ path: string }, void];
  [IpcChannels.SHELL_SHOW_IN_FOLDER]: [{ path: string }, void];
  [IpcChannels.LOGS_GET]: [void, LogsGetResponse];
  [IpcChannels.LOCAL_IP_GET]: [void, string];
  [IpcChannels.DIALOG_OPEN_DIRECTORY]: [void, string | null];
}
