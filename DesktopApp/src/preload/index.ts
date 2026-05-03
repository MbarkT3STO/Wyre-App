/**
 * Preload script — contextBridge exposes a typed window.api to the renderer.
 * This is the ONLY bridge between the sandboxed renderer and the main process.
 * nodeIntegration is false; contextIsolation is true.
 */

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { IpcChannels } from '../shared/ipc/IpcContracts';
import { ChatIpcChannels } from '../shared/ipc/ChatIpcContracts';
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
  FolderZipAndSendPayload,
  ClipboardSendPayload,
  ClipboardReceivedPayload,
  TransferResumePayload,
  TransferPausedPayload,
} from '../shared/ipc/IpcContracts';
import type {
  ChatSessionOpenPayload,
  ChatSessionClosePayload,
  ChatSendTextPayload,
  ChatSendFilePayload,
  ChatInviteAcceptPayload,
  ChatInviteDeclinePayload,
  ChatMarkReadPayload,
  ChatMessagePayload,
  ChatMessageStatusPayload,
  ChatSessionUpdatedPayload,
  ChatInvitePayload,
  ChatSessionsGetResponse,
  ChatRequestPendingPayload,
  ChatRequestResolvedPayload,
  ChatRequestCancelPayload,
  ChatEditMessagePayload,
  ChatDeleteMessagePayload,
  ChatMessageEditedPayload,
  ChatMessageDeletedPayload,
} from '../shared/ipc/ChatIpcContracts';
import type { Device } from '../shared/models/Device';
import type { AppSettings } from '../shared/models/AppSettings';
import type { TransferRecord } from '../shared/models/Transfer';
import type { ChatMessage, ChatSession } from '../shared/models/ChatMessage';

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

  // Send queue (Feature 1)
  onTransferQueueUpdated: (cb: (payload: TransferQueueUpdatedPayload) => void) => () => void;

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

  // Shell actions
  openFile: (path: string) => Promise<void>;
  showInFolder: (path: string) => Promise<void>;

  // Platform info
  platform: NodeJS.Platform;

  // Diagnostics (Feature 3)
  getLogs: () => Promise<LogsGetResponse>;

  // Local network info
  getLocalIp: () => Promise<string>;

  // Native directory picker
  openDirectory: () => Promise<string | null>;

  // Folder zip-and-send
  folderZipAndSend: (payload: FolderZipAndSendPayload) => Promise<string>;

  // Clipboard sharing
  sendClipboard: (payload: ClipboardSendPayload) => Promise<void>;
  onClipboardReceived: (cb: (payload: ClipboardReceivedPayload) => void) => () => void;

  // Transfer resume
  resumeTransfer: (payload: TransferResumePayload) => Promise<void>;
  onTransferPaused: (cb: (payload: TransferPausedPayload) => void) => () => void;

  // ── Chat ──────────────────────────────────────────────────────────────────
  chatOpenSession: (payload: ChatSessionOpenPayload) => Promise<ChatSession>;
  chatCloseSession: (payload: ChatSessionClosePayload) => Promise<void>;
  chatSendText: (payload: ChatSendTextPayload) => Promise<ChatMessage | null>;
  chatSendFile: (payload: ChatSendFilePayload) => Promise<ChatMessage | null>;
  chatAcceptInvite: (payload: ChatInviteAcceptPayload) => Promise<void>;
  chatDeclineInvite: (payload: ChatInviteDeclinePayload) => Promise<void>;
  chatGetSessions: () => Promise<ChatSessionsGetResponse>;
  chatMarkRead: (payload: ChatMarkReadPayload) => Promise<void>;
  onChatMessage: (cb: (payload: ChatMessagePayload) => void) => () => void;
  onChatMessageStatus: (cb: (payload: ChatMessageStatusPayload) => void) => () => void;
  onChatSessionUpdated: (cb: (payload: ChatSessionUpdatedPayload) => void) => () => void;
  onChatInvite: (cb: (payload: ChatInvitePayload) => void) => () => void;
  onChatRequestPending: (cb: (payload: ChatRequestPendingPayload) => void) => () => void;
  onChatRequestResolved: (cb: (payload: ChatRequestResolvedPayload) => void) => () => void;
  chatCancelRequest: (payload: ChatRequestCancelPayload) => Promise<void>;
  chatEditMessage: (payload: ChatEditMessagePayload) => Promise<boolean>;
  chatDeleteMessage: (payload: ChatDeleteMessagePayload) => Promise<boolean>;
  onChatMessageEdited: (cb: (payload: ChatMessageEditedPayload) => void) => () => void;
  onChatMessageDeleted: (cb: (payload: ChatMessageDeletedPayload) => void) => () => void;
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

  // Send queue (Feature 1)
  onTransferQueueUpdated: (cb) => createListener(IpcChannels.TRANSFER_QUEUE_UPDATED, cb),

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

  // Shell actions
  openFile: (path: string) => ipcRenderer.invoke(IpcChannels.SHELL_OPEN_FILE, { path }),
  showInFolder: (path: string) => ipcRenderer.invoke(IpcChannels.SHELL_SHOW_IN_FOLDER, { path }),

  // Platform info
  platform: process.platform,

  // Diagnostics (Feature 3)
  getLogs: () => ipcRenderer.invoke(IpcChannels.LOGS_GET),

  // Local network info
  getLocalIp: () => ipcRenderer.invoke(IpcChannels.LOCAL_IP_GET),

  // Native directory picker
  openDirectory: () => ipcRenderer.invoke(IpcChannels.DIALOG_OPEN_DIRECTORY),

  // Folder zip-and-send
  folderZipAndSend: (payload) => ipcRenderer.invoke(IpcChannels.FOLDER_ZIP_AND_SEND, payload),

  // Clipboard sharing
  sendClipboard: (payload) => ipcRenderer.invoke(IpcChannels.CLIPBOARD_SEND, payload),
  onClipboardReceived: (cb) => createListener(IpcChannels.CLIPBOARD_RECEIVED, cb),

  // Transfer resume
  resumeTransfer: (payload) => ipcRenderer.invoke(IpcChannels.TRANSFER_RESUME, payload),
  onTransferPaused: (cb) => createListener(IpcChannels.TRANSFER_PAUSED, cb),

  // ── Chat ──────────────────────────────────────────────────────────────────
  chatOpenSession: (payload) => ipcRenderer.invoke(ChatIpcChannels.CHAT_SESSION_OPEN, payload),
  chatCloseSession: (payload) => ipcRenderer.invoke(ChatIpcChannels.CHAT_SESSION_CLOSE, payload),
  chatSendText: (payload) => ipcRenderer.invoke(ChatIpcChannels.CHAT_SEND_TEXT, payload),
  chatSendFile: (payload) => ipcRenderer.invoke(ChatIpcChannels.CHAT_SEND_FILE, payload),
  chatAcceptInvite: (payload) => ipcRenderer.invoke(ChatIpcChannels.CHAT_INVITE_ACCEPT, payload),
  chatDeclineInvite: (payload) => ipcRenderer.invoke(ChatIpcChannels.CHAT_INVITE_DECLINE, payload),
  chatGetSessions: () => ipcRenderer.invoke(ChatIpcChannels.CHAT_SESSIONS_GET),
  chatMarkRead: (payload) => ipcRenderer.invoke(ChatIpcChannels.CHAT_MARK_READ, payload),
  onChatMessage: (cb) => createListener(ChatIpcChannels.CHAT_MESSAGE, cb),
  onChatMessageStatus: (cb) => createListener(ChatIpcChannels.CHAT_MESSAGE_STATUS, cb),
  onChatSessionUpdated: (cb) => createListener(ChatIpcChannels.CHAT_SESSION_UPDATED, cb),
  onChatInvite: (cb) => createListener(ChatIpcChannels.CHAT_INVITE, cb),
  onChatRequestPending: (cb) => createListener(ChatIpcChannels.CHAT_REQUEST_PENDING, cb),
  onChatRequestResolved: (cb) => createListener(ChatIpcChannels.CHAT_REQUEST_RESOLVED, cb),
  chatCancelRequest: (payload) => ipcRenderer.invoke(ChatIpcChannels.CHAT_REQUEST_CANCEL, payload),
  chatEditMessage: (payload) => ipcRenderer.invoke(ChatIpcChannels.CHAT_EDIT_MESSAGE, payload),
  chatDeleteMessage: (payload) => ipcRenderer.invoke(ChatIpcChannels.CHAT_DELETE_MESSAGE, payload),
  onChatMessageEdited: (cb) => createListener(ChatIpcChannels.CHAT_MESSAGE_EDITED, cb),
  onChatMessageDeleted: (cb) => createListener(ChatIpcChannels.CHAT_MESSAGE_DELETED, cb),
};

contextBridge.exposeInMainWorld('api', api);

// ─── Type augmentation for renderer ──────────────────────────────────────────

declare global {
  interface Window {
    api: FileDropApi;
  }
}
