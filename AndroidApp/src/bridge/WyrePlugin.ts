/**
 * WyrePlugin.ts
 * Typed Capacitor plugin interface for the native WyrePlugin (Java/Kotlin).
 *
 * The native plugin handles:
 *  - UDP broadcast / listen (device discovery)
 *  - TCP server / client (file transfer)
 *  - File I/O (read/write streams, SHA-256 checksum)
 *  - Settings persistence (SharedPreferences)
 *
 * All calls go through Capacitor.Plugins.WyrePlugin.
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
  cancelTransfer(options: { transferId: string }): Promise<void>;
  respondToIncoming(options: { transferId: string; accepted: boolean; savePath?: string }): Promise<void>;

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
  addListener(event: 'incomingRequest',      handler: (data: IncomingRequestEvent)      => void): Promise<{ remove: () => void }>;
  addListener(event: 'transferQueueUpdated', handler: (data: TransferQueueUpdatedEvent) => void): Promise<{ remove: () => void }>;
}

export const WyrePlugin = registerPlugin<WyrePluginInterface>('WyrePlugin');
