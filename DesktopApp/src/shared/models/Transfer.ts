/**
 * Transfer.ts
 * Transfer model, status enum, and history record.
 */

export enum TransferStatus {
  Pending = 'pending',
  Connecting = 'connecting',
  Active = 'active',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
  Declined = 'declined',
  Paused = 'paused',
}

export type TransferDirection = 'send' | 'receive';

export interface Transfer {
  id: string;
  direction: TransferDirection;
  status: TransferStatus;
  /** Remote device info */
  peerId: string;
  peerName: string;
  /** File metadata */
  fileName: string;
  fileSize: number;
  filePath: string;
  /** Progress tracking */
  bytesTransferred: number;
  progress: number;   // 0–100
  speed: number;      // bytes/sec
  eta: number;        // seconds
  /** Timestamps */
  startedAt: number;
  completedAt?: number;
  /** Error info if failed */
  errorMessage?: string;
  errorCode?: string;
  /** Where the file was saved (receive only) */
  savedPath?: string;
  /** SHA-256 checksum */
  checksum: string;
  /** Byte offset to resume from (Feature: Resume) */
  resumeOffset?: number;
}

/** Persisted record in transfer history */
export interface TransferRecord {
  id: string;
  direction: TransferDirection;
  status: TransferStatus;
  peerId: string;
  peerName: string;
  fileName: string;
  fileSize: number;
  startedAt: number;
  completedAt?: number;
  errorMessage?: string;
  savedPath?: string;
}
