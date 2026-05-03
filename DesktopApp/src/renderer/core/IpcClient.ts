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
  FolderZipAndSendPayload,
  ClipboardSendPayload,
  ClipboardReceivedPayload,
  TransferResumePayload,
  TransferPausedPayload,
} from '../../shared/ipc/IpcContracts';
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
} from '../../shared/ipc/ChatIpcContracts';
import type { ChatMessage, ChatSession } from '../../shared/models/ChatMessage';

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

  // Native directory picker
  openDirectory: (): Promise<string | null> => getApi().openDirectory(),

  // Folder zip-and-send
  folderZipAndSend: (payload: FolderZipAndSendPayload): Promise<string> => getApi().folderZipAndSend(payload),

  // Clipboard sharing
  sendClipboard: (payload: ClipboardSendPayload): Promise<void> => getApi().sendClipboard(payload),
  onClipboardReceived: (cb: (payload: ClipboardReceivedPayload) => void): (() => void) =>
    getApi().onClipboardReceived(cb),

  // Transfer resume
  resumeTransfer: (payload: TransferResumePayload): Promise<void> => getApi().resumeTransfer(payload),
  onTransferPaused: (cb: (payload: TransferPausedPayload) => void): (() => void) =>
    getApi().onTransferPaused(cb),

  // ── Chat ──────────────────────────────────────────────────────────────────
  chatOpenSession: (payload: ChatSessionOpenPayload): Promise<ChatSession> =>
    getApi().chatOpenSession(payload),
  chatCloseSession: (payload: ChatSessionClosePayload): Promise<void> =>
    getApi().chatCloseSession(payload),
  chatSendText: (payload: ChatSendTextPayload): Promise<ChatMessage | null> =>
    getApi().chatSendText(payload),
  chatSendFile: (payload: ChatSendFilePayload): Promise<ChatMessage | null> =>
    getApi().chatSendFile(payload),
  chatAcceptInvite: (payload: ChatInviteAcceptPayload): Promise<void> =>
    getApi().chatAcceptInvite(payload),
  chatDeclineInvite: (payload: ChatInviteDeclinePayload): Promise<void> =>
    getApi().chatDeclineInvite(payload),
  chatGetSessions: (): Promise<ChatSessionsGetResponse> =>
    getApi().chatGetSessions(),
  chatMarkRead: (payload: ChatMarkReadPayload): Promise<void> =>
    getApi().chatMarkRead(payload),
  onChatMessage: (cb: (payload: ChatMessagePayload) => void): (() => void) =>
    getApi().onChatMessage(cb),
  onChatMessageStatus: (cb: (payload: ChatMessageStatusPayload) => void): (() => void) =>
    getApi().onChatMessageStatus(cb),
  onChatSessionUpdated: (cb: (payload: ChatSessionUpdatedPayload) => void): (() => void) =>
    getApi().onChatSessionUpdated(cb),
  onChatInvite: (cb: (payload: ChatInvitePayload) => void): (() => void) =>
    getApi().onChatInvite(cb),
  onChatRequestPending: (cb: (payload: ChatRequestPendingPayload) => void): (() => void) =>
    getApi().onChatRequestPending(cb),
  onChatRequestResolved: (cb: (payload: ChatRequestResolvedPayload) => void): (() => void) =>
    getApi().onChatRequestResolved(cb),
  chatCancelRequest: (payload: ChatRequestCancelPayload): Promise<void> =>
    getApi().chatCancelRequest(payload),
  chatEditMessage: (payload: ChatEditMessagePayload): Promise<boolean> =>
    getApi().chatEditMessage(payload),
  chatDeleteMessage: (payload: ChatDeleteMessagePayload): Promise<boolean> =>
    getApi().chatDeleteMessage(payload),
  onChatMessageEdited: (cb: (payload: ChatMessageEditedPayload) => void): (() => void) =>
    getApi().onChatMessageEdited(cb),
  onChatMessageDeleted: (cb: (payload: ChatMessageDeletedPayload) => void): (() => void) =>
    getApi().onChatMessageDeleted(cb),
} as const;
