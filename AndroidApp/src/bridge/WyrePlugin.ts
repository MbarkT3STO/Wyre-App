/**
 * WyrePlugin.ts
 * Typed Capacitor plugin interface for the native WyrePlugin (Java/Kotlin).
 */

import { registerPlugin } from '@capacitor/core';

// ─── Event payloads (native → JS) ────────────────────────────────────────────

export interface DevicesUpdatedEvent {
  devices: import('../shared/models/Device').Device[];
}

export interface TransferStartedEvent {
  transferId: string;
  direction: 'send' | 'receive';
  peerId: string;
  peerName: string;
  fileName: string;
  fileSize: number;
  status: string;
}

export interface TransferProgressEvent {
  transferId: string;
  progress: number;
  speed: number;
  eta: number;
  bytesTransferred: number;
  totalBytes: number;
}

export interface TransferCompleteEvent {
  transferId: string;
  savedPath: string;
}

export interface TransferErrorEvent {
  transferId: string;
  error: string;
  code: string;
}

export interface TransferPausedEvent {
  transferId: string;
  bytesTransferred: number;
}

export interface IncomingRequestEvent {
  transferId: string;
  senderName: string;
  senderDeviceId: string;
  fileName: string;
  fileSize: number;
  checksum: string;
}

export interface TransferQueueUpdatedEvent {
  queue: Array<{ fileName: string; fileSize: number; deviceId: string }>;
}

/** Feature 2: Clipboard text received from a peer */
export interface ClipboardReceivedEvent {
  senderName: string;
  text: string;
  truncated: boolean;
}

/** Chat message received */
export interface ChatMessageEvent {
  sessionId: string;
  message: import('../shared/models/ChatMessage').ChatMessage;
}

/** Chat message status updated */
export interface ChatMessageStatusEvent {
  sessionId: string;
  messageId: string;
  status: string;
}

/** Chat session state changed */
export interface ChatSessionUpdatedEvent {
  session: import('../shared/models/ChatMessage').ChatSession;
}

/** A peer wants to start a chat */
export interface ChatInviteEvent {
  sessionId: string;
  peerId: string;
  peerName: string;
}

// ─── Plugin interface ─────────────────────────────────────────────────────────

export interface WyrePluginInterface {
  // ── Settings ──────────────────────────────────────────────────────────────
  getSettings(): Promise<import('../shared/models/AppSettings').AppSettings>;
  setSettings(options: Partial<import('../shared/models/AppSettings').AppSettings>): Promise<void>;

  // ── Device discovery ──────────────────────────────────────────────────────
  getDevices(): Promise<{ devices: import('../shared/models/Device').Device[] }>;
  startDiscovery(): Promise<void>;
  stopDiscovery(): Promise<void>;

  // ── File transfer ─────────────────────────────────────────────────────────
  sendFile(options: { deviceId: string; filePath: string; fileName: string; fileSize: number }): Promise<{ transferId: string }>;
  /** Feature 1: Zip a folder on the native side and send it. folderUri is the content:// tree URI. */
  sendFolder(options: { deviceId: string; folderUri: string; folderName: string }): Promise<{ transferId: string }>;
  cancelTransfer(options: { transferId: string }): Promise<void>;
  /** Feature 4: Resume a paused transfer from its last byte offset */
  resumeTransfer(options: { transferId: string }): Promise<void>;
  respondToIncoming(options: { transferId: string; accepted: boolean; savePath?: string }): Promise<void>;

  // ── Clipboard (Feature 2) ─────────────────────────────────────────────────
  sendClipboard(options: { deviceId: string; text: string }): Promise<void>;

  // ── Chat ──────────────────────────────────────────────────────────────────
  chatOpenSession(options: { deviceId: string }): Promise<{ sessionId: string; peerId: string; peerName: string; connected: boolean }>;
  chatCloseSession(options: { sessionId: string }): Promise<void>;
  chatSendText(options: { sessionId: string; text: string }): Promise<{ messageId: string } | null>;
  chatSendFile(options: { sessionId: string; filePath: string; fileName: string; fileSize: number; base64?: string }): Promise<{ messageId: string } | null>;
  chatEditMessage(options: { sessionId: string; messageId: string; newText: string }): Promise<void>;
  chatDeleteMessage(options: { sessionId: string; messageId: string }): Promise<void>;
  chatAcceptInvite(options: { sessionId: string }): Promise<void>;
  chatDeclineInvite(options: { sessionId: string }): Promise<void>;
  chatGetSessions(): Promise<{ sessions: import('../shared/models/ChatMessage').ChatSession[] }>;
  chatMarkRead(options: { sessionId: string }): Promise<void>;
  // ── History ───────────────────────────────────────────────────────────────
  getHistory(): Promise<{ history: import('../shared/models/Transfer').TransferRecord[] }>;
  clearHistory(): Promise<void>;

  // ── File picker ───────────────────────────────────────────────────────────
  pickFile(): Promise<{ files: Array<{ path: string; name: string; size: number }> }>;

  pickFolder(): Promise<{ path: string; uri: string }>;

  // ── Shell actions ─────────────────────────────────────────────────────────
  openFile(options: { path: string }): Promise<void>;
  showInFolder(options: { path: string }): Promise<void>;

  // ── Event listeners ───────────────────────────────────────────────────────
  addListener(event: 'devicesUpdated',       handler: (data: DevicesUpdatedEvent)       => void): Promise<{ remove: () => void }>;
  addListener(event: 'transferStarted',      handler: (data: TransferStartedEvent)      => void): Promise<{ remove: () => void }>;
  addListener(event: 'transferProgress',     handler: (data: TransferProgressEvent)     => void): Promise<{ remove: () => void }>;
  addListener(event: 'transferComplete',     handler: (data: TransferCompleteEvent)     => void): Promise<{ remove: () => void }>;
  addListener(event: 'transferError',        handler: (data: TransferErrorEvent)        => void): Promise<{ remove: () => void }>;
  addListener(event: 'transferPaused',       handler: (data: TransferPausedEvent)       => void): Promise<{ remove: () => void }>;
  addListener(event: 'incomingRequest',      handler: (data: IncomingRequestEvent)      => void): Promise<{ remove: () => void }>;
  addListener(event: 'transferQueueUpdated', handler: (data: TransferQueueUpdatedEvent) => void): Promise<{ remove: () => void }>;
  addListener(event: 'clipboardReceived',    handler: (data: ClipboardReceivedEvent)    => void): Promise<{ remove: () => void }>;
  addListener(event: 'chatMessage',          handler: (data: ChatMessageEvent)          => void): Promise<{ remove: () => void }>;
  addListener(event: 'chatMessageStatus',    handler: (data: ChatMessageStatusEvent)    => void): Promise<{ remove: () => void }>;
  addListener(event: 'chatSessionUpdated',   handler: (data: ChatSessionUpdatedEvent)   => void): Promise<{ remove: () => void }>;
  addListener(event: 'chatInvite',           handler: (data: ChatInviteEvent)           => void): Promise<{ remove: () => void }>;
}

export const WyrePlugin = registerPlugin<WyrePluginInterface>('WyrePlugin');
