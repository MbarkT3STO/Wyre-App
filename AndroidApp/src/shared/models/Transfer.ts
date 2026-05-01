/**
 * Transfer.ts
 * Transfer model, status enum, and history record.
 */

export enum TransferStatus {
  Pending    = 'pending',
  Connecting = 'connecting',
  Active     = 'active',
  Completed  = 'completed',
  Failed     = 'failed',
  Cancelled  = 'cancelled',
  Declined   = 'declined',
}

export type TransferDirection = 'send' | 'receive';

export interface Transfer {
  id: string;
  direction: TransferDirection;
  status: TransferStatus;
  peerId: string;
  peerName: string;
  fileName: string;
  fileSize: number;
  filePath: string;
  bytesTransferred: number;
  progress: number;   // 0–100
  speed: number;      // bytes/sec
  eta: number;        // seconds
  startedAt: number;
  completedAt?: number;
  errorMessage?: string;
  errorCode?: string;
  savedPath?: string;
  checksum: string;
}

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
