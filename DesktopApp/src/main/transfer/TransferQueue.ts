/**
 * TransferQueue.ts
 * Manages concurrent transfers (both sending and receiving).
 * Tracks all active and historical transfers.
 * Delegates actual I/O to TransferClient and TransferServer.
 */

import { EventEmitter } from 'events';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { TransferClient } from './TransferClient';
import { TransferServer } from './TransferServer';
import { FileChunker } from './FileChunker';
import { Logger } from '../logging/Logger';
import type { Transfer, TransferRecord } from '../../shared/models/Transfer';
import { TransferStatus } from '../../shared/models/Transfer';

/** A send that is waiting for the current active outgoing transfer to finish */
interface QueuedSend {
  filePath: string;
  fileName: string;
  fileSize: number;
  peerId: string;
  peerIp: string;
  peerPort: number;
  peerName: string;
  senderDeviceId: string;
  senderName: string;
}

export interface TransferQueueEvents {
  transferUpdated: (transfer: Transfer) => void;
  historyUpdated: (history: TransferRecord[]) => void;
  /** Emitted whenever the pending-send queue changes (Feature 1) */
  queueUpdated: (queue: QueuedSend[]) => void;
}

export declare interface TransferQueue {
  on<K extends keyof TransferQueueEvents>(event: K, listener: TransferQueueEvents[K]): this;
  emit<K extends keyof TransferQueueEvents>(event: K, ...args: Parameters<TransferQueueEvents[K]>): boolean;
}

export class TransferQueue extends EventEmitter {
  private transfers: Map<string, Transfer> = new Map();
  private history: TransferRecord[] = [];
  private historyIdSet: Set<string> = new Set();
  private client: TransferClient;
  private server: TransferServer;
  /** Pending outgoing sends waiting for the active transfer to finish (Feature 1) */
  private pendingSends: QueuedSend[] = [];

  constructor(client: TransferClient, server: TransferServer) {
    super();
    this.client = client;
    this.server = server;
    this.wireClientEvents();
    this.wireServerEvents();
  }

  private logger(): Logger | null {
    try { return Logger.getInstance(); } catch { return null; }
  }

  private wireClientEvents(): void {
    this.client.on('progress', (transferId, bytesSent, totalBytes, speed, eta, progress) => {
      this.updateTransfer(transferId, {
        status: TransferStatus.Active,
        bytesTransferred: bytesSent,
        progress,
        speed,
        eta,
      });
    });

    this.client.on('complete', (transferId) => {
      const transfer = this.transfers.get(transferId);
      if (!transfer) return;
      const completed: Transfer = {
        ...transfer,
        status: TransferStatus.Completed,
        progress: 100,
        completedAt: Date.now(),
      };
      this.transfers.set(transferId, completed);
      this.addToHistory(completed);
      this.emit('transferUpdated', completed);
      this.logger()?.info('Transfer completed', {
        transferId,
        direction: completed.direction,
        fileName: completed.fileName,
        fileSize: completed.fileSize,
        peerName: completed.peerName,
      });
      this.drainQueue();
    });

    this.client.on('error', (transferId, err) => {
      const transfer = this.transfers.get(transferId);
      this.logger()?.warn('Transfer failed', {
        transferId,
        direction: transfer?.direction ?? 'send',
        fileName: transfer?.fileName ?? '',
        fileSize: transfer?.fileSize ?? 0,
        peerName: transfer?.peerName ?? '',
        error: err.message,
      });

      // If bytes were transferred and the peer is still online, pause for resume
      // instead of immediately failing.
      if (transfer && transfer.bytesTransferred > 0 && transfer.direction === 'send') {
        this.updateTransfer(transferId, {
          status: TransferStatus.Paused,
          resumeOffset: transfer.bytesTransferred,
          errorMessage: err.message,
        });
        this.logger()?.info('Transfer paused (resumable)', {
          transferId,
          bytesTransferred: transfer.bytesTransferred,
        });
      } else {
        this.failTransfer(transferId, err.message, 'SEND_ERROR');
      }
      this.drainQueue();
    });

    this.client.on('cancelled', (transferId) => {
      this.updateTransfer(transferId, { status: TransferStatus.Cancelled, completedAt: Date.now() });
      const t = this.transfers.get(transferId);
      if (t) {
        this.addToHistory(t);
        this.logger()?.info('Transfer cancelled', {
          transferId,
          direction: t.direction,
          fileName: t.fileName,
          fileSize: t.fileSize,
          peerName: t.peerName,
        });
      }
      this.drainQueue();
    });

    this.client.on('declined', (transferId) => {
      this.updateTransfer(transferId, {
        status: TransferStatus.Declined,
        completedAt: Date.now(),
        errorMessage: 'Transfer was declined by the recipient',
      });
      const t = this.transfers.get(transferId);
      if (t) {
        this.addToHistory(t);
        this.logger()?.info('Transfer declined', {
          transferId,
          direction: t.direction,
          fileName: t.fileName,
          fileSize: t.fileSize,
          peerName: t.peerName,
        });
      }
      this.drainQueue();
    });
  }

  private wireServerEvents(): void {
    this.server.on('progress', (transferId, bytesReceived, totalBytes, speed, eta) => {
      this.updateTransfer(transferId, {
        status: TransferStatus.Active,
        bytesTransferred: bytesReceived,
        progress: totalBytes > 0 ? Math.round((bytesReceived / totalBytes) * 100) : 0,
        speed,
        eta,
      });
    });

    this.server.on('complete', (transferId, savedPath) => {
      const transfer = this.transfers.get(transferId);
      if (!transfer) return;
      const completed: Transfer = {
        ...transfer,
        status: TransferStatus.Completed,
        progress: 100,
        completedAt: Date.now(),
        savedPath,
      };
      this.transfers.set(transferId, completed);
      this.addToHistory(completed);
      this.emit('transferUpdated', completed);
      this.logger()?.info('Transfer completed', {
        transferId,
        direction: completed.direction,
        fileName: completed.fileName,
        fileSize: completed.fileSize,
        peerName: completed.peerName,
      });
    });

    this.server.on('error', (transferId, err) => {
      if (transferId) {
        const transfer = this.transfers.get(transferId);
        this.logger()?.warn('Transfer failed', {
          transferId,
          direction: transfer?.direction ?? 'receive',
          fileName: transfer?.fileName ?? '',
          fileSize: transfer?.fileSize ?? 0,
          peerName: transfer?.peerName ?? '',
          error: err.message,
        });
        this.failTransfer(transferId, err.message, 'RECEIVE_ERROR');
      }
    });

    this.server.on('cancelled', (transferId) => {
      this.updateTransfer(transferId, { status: TransferStatus.Cancelled, completedAt: Date.now() });
      const t = this.transfers.get(transferId);
      if (t) {
        this.addToHistory(t);
        this.logger()?.info('Transfer cancelled', {
          transferId,
          direction: t.direction,
          fileName: t.fileName,
          fileSize: t.fileSize,
          peerName: t.peerName,
        });
      }
    });
  }

  /** Queue a new outgoing transfer (Feature 1: defers if one is already active) */
  async enqueueSend(options: {
    filePath: string;
    peerIp: string;
    peerPort: number;
    peerId: string;
    peerName: string;
    senderDeviceId: string;
    senderName: string;
    peerSupportsEncryption?: boolean;
  }): Promise<string> {
    const { filePath, peerIp, peerPort, peerId, peerName, senderDeviceId, senderName, peerSupportsEncryption } = options;

    const fileName = filePath.split('/').pop() ?? filePath.split('\\').pop() ?? 'file';

    // Check whether there is already an active outgoing transfer
    const hasActiveOutgoing = Array.from(this.transfers.values()).some(
      t => t.direction === 'send' &&
           (t.status === TransferStatus.Active ||
            t.status === TransferStatus.Connecting),
    );

    if (hasActiveOutgoing) {
      // Compute size now so the queue indicator can show it immediately
      const fileSize = await FileChunker.getFileSize(filePath);
      const queued: QueuedSend = {
        filePath, fileName, fileSize, peerId, peerIp, peerPort, peerName, senderDeviceId, senderName,
      };
      this.pendingSends.push(queued);
      this.emit('queueUpdated', [...this.pendingSends]);
      this.logger()?.info('Transfer queued (pending)', {
        fileName,
        fileSize,
        peerName,
        queueDepth: this.pendingSends.length,
      });
      // Return a placeholder id so the caller has something to track
      return randomUUID();
    }

    return this.startSend({ filePath, fileName, peerIp, peerPort, peerId, peerName, senderDeviceId, senderName, peerSupportsEncryption });
  }

  /** Start the next pending send if one exists (Feature 1) */
  private drainQueue(): void {
    if (this.pendingSends.length === 0) return;

    const next = this.pendingSends.shift()!;
    this.emit('queueUpdated', [...this.pendingSends]);
    this.logger()?.info('Draining send queue', {
      fileName: next.fileName,
      remaining: this.pendingSends.length,
    });

    this.startSend(next).catch((err: Error) => {
      this.logger()?.error('Failed to start queued send', { fileName: next.fileName, error: err.message });
    });
  }

  /** Internal: actually start a send transfer (no queue check) */
  private async startSend(options: {
    filePath: string;
    fileName: string;
    peerIp: string;
    peerPort: number;
    peerId: string;
    peerName: string;
    senderDeviceId: string;
    senderName: string;
    peerSupportsEncryption?: boolean;
  }): Promise<string> {
    const { filePath, fileName, peerIp, peerPort, peerId, peerName, senderDeviceId, senderName, peerSupportsEncryption } = options;

    // Compute size and checksum BEFORE starting the TCP connection.
    const fileSize = await FileChunker.getFileSize(filePath);
    const checksum = await FileChunker.computeChecksum(filePath);

    const transferId = randomUUID();

    const transfer: Transfer = {
      id: transferId,
      direction: 'send',
      status: TransferStatus.Connecting,
      peerId,
      peerName,
      fileName,
      fileSize,
      filePath,
      bytesTransferred: 0,
      progress: 0,
      speed: 0,
      eta: 0,
      startedAt: Date.now(),
      checksum,
    };

    this.transfers.set(transferId, transfer);
    this.emit('transferUpdated', transfer);

    this.logger()?.info('Transfer started', {
      transferId,
      direction: 'send',
      fileName,
      fileSize,
      peerName,
    });

    this.client.sendFileWithId(transferId, {
      filePath,
      fileName,
      fileSize,
      checksum,
      peerIp,
      peerPort,
      senderDeviceId,
      senderName,
      peerSupportsEncryption: peerSupportsEncryption ?? false,
    });

    return transferId;
  }

  /** Register an incoming transfer (before accept/decline) */
  registerIncoming(options: {
    transferId: string;
    peerId: string;
    peerName: string;
    fileName: string;
    fileSize: number;
    checksum: string;
  }): void {
    const transfer: Transfer = {
      id: options.transferId,
      direction: 'receive',
      status: TransferStatus.Pending,
      peerId: options.peerId,
      peerName: options.peerName,
      fileName: options.fileName,
      fileSize: options.fileSize,
      filePath: '',
      bytesTransferred: 0,
      progress: 0,
      speed: 0,
      eta: 0,
      startedAt: Date.now(),
      checksum: options.checksum,
    };
    this.transfers.set(options.transferId, transfer);
    this.emit('transferUpdated', transfer);
  }

  /** Accept an incoming transfer */
  acceptIncoming(transferId: string, saveDirectory: string): void {
    const transfer = this.transfers.get(transferId);
    if (!transfer) return;

    const savePath = join(saveDirectory, transfer.fileName);
    FileChunker.ensureUniquePath(savePath).then((uniquePath) => {
      this.updateTransfer(transferId, {
        status: TransferStatus.Active,
        filePath: uniquePath,
        savedPath: uniquePath,
      });
      this.server.triggerAccept(transferId, uniquePath);
    }).catch((err: Error) => {
      this.failTransfer(transferId, err.message, 'PATH_ERROR');
    });
  }

  /** Decline an incoming transfer */
  declineIncoming(transferId: string): void {
    this.server.declineTransfer(transferId);
    this.updateTransfer(transferId, {
      status: TransferStatus.Declined,
      completedAt: Date.now(),
    });
    const t = this.transfers.get(transferId);
    if (t) {
      this.addToHistory(t);
      this.logger()?.info('Transfer declined', {
        transferId,
        direction: t.direction,
        fileName: t.fileName,
        fileSize: t.fileSize,
        peerName: t.peerName,
      });
    }
  }

  /** Resume a paused outgoing transfer from where it left off */
  async resumeTransfer(transferId: string): Promise<void> {
    const transfer = this.transfers.get(transferId);
    if (!transfer || transfer.status !== TransferStatus.Paused) return;
    if (transfer.direction !== 'send') return;

    const resumeOffset = transfer.resumeOffset ?? transfer.bytesTransferred;

    this.updateTransfer(transferId, {
      status: TransferStatus.Connecting,
      errorMessage: undefined,
    });

    this.logger()?.info('Resuming transfer', { transferId, resumeOffset });

    // Re-use the existing transferId so the renderer entry updates in place
    this.client.sendFileWithId(transferId, {
      filePath: transfer.filePath,
      fileName: transfer.fileName,
      fileSize: transfer.fileSize,
      checksum: transfer.checksum,
      peerIp: '', // resolved below
      peerPort: 0,
      senderDeviceId: transfer.peerId, // will be overridden
      senderName: transfer.peerName,
      resumeOffset,
    });

    // Note: peerIp/peerPort must be resolved by the caller (TransferHandlers)
    // which has access to DiscoveryService. This method is intentionally thin.
  }

  /** Resume a paused transfer with full peer connection details */
  async resumeTransferWithPeer(transferId: string, peerIp: string, peerPort: number, senderDeviceId: string, senderName: string): Promise<void> {
    const transfer = this.transfers.get(transferId);
    if (!transfer || transfer.status !== TransferStatus.Paused) return;
    if (transfer.direction !== 'send') return;

    const resumeOffset = transfer.resumeOffset ?? transfer.bytesTransferred;

    this.updateTransfer(transferId, {
      status: TransferStatus.Connecting,
      errorMessage: undefined,
    });

    this.logger()?.info('Resuming transfer', { transferId, resumeOffset, peerIp });

    this.client.sendFileWithId(transferId, {
      filePath: transfer.filePath,
      fileName: transfer.fileName,
      fileSize: transfer.fileSize,
      checksum: transfer.checksum,
      peerIp,
      peerPort,
      senderDeviceId,
      senderName,
      resumeOffset,
    });
  }

  cancelTransfer(transferId: string): void {
    const transfer = this.transfers.get(transferId);
    if (!transfer) return;

    if (transfer.direction === 'send') {
      this.client.cancelTransfer(transferId);
    } else {
      this.server.cancelTransfer(transferId);
    }
  }

  getActiveTransfers(): Transfer[] {
    return Array.from(this.transfers.values()).filter(
      t => t.status === TransferStatus.Active ||
           t.status === TransferStatus.Pending ||
           t.status === TransferStatus.Connecting,
    );
  }

  /** Return a snapshot of the pending send queue (Feature 1) */
  getPendingQueue(): Array<{ fileName: string; fileSize: number; deviceId: string }> {
    return this.pendingSends.map(s => ({
      fileName: s.fileName,
      fileSize: s.fileSize,
      deviceId: s.peerId,
    }));
  }

  getHistory(): TransferRecord[] {
    return [...this.history];
  }

  /** Return a paused transfer by ID (for resume) */
  getPausedTransfer(transferId: string): Transfer | undefined {
    const t = this.transfers.get(transferId);
    return t?.status === TransferStatus.Paused ? t : undefined;
  }

  clearHistory(): void {
    this.historyIdSet.clear();
    this.history = [];
    this.emit('historyUpdated', this.history);
  }

  private updateTransfer(transferId: string, partial: Partial<Transfer>): void {
    const existing = this.transfers.get(transferId);
    if (!existing) return;
    const updated = { ...existing, ...partial };
    this.transfers.set(transferId, updated);
    this.emit('transferUpdated', updated);
  }

  private failTransfer(transferId: string, message: string, code: string): void {
    this.updateTransfer(transferId, {
      status: TransferStatus.Failed,
      completedAt: Date.now(),
      errorMessage: message,
      errorCode: code,
    });
    const t = this.transfers.get(transferId);
    if (t) this.addToHistory(t);
  }

  private addToHistory(transfer: Transfer): void {
    const record: TransferRecord = {
      id: transfer.id,
      direction: transfer.direction,
      status: transfer.status,
      peerId: transfer.peerId,
      peerName: transfer.peerName,
      fileName: transfer.fileName,
      fileSize: transfer.fileSize,
      startedAt: transfer.startedAt,
      ...(transfer.completedAt !== undefined && { completedAt: transfer.completedAt }),
      ...(transfer.errorMessage !== undefined && { errorMessage: transfer.errorMessage }),
      ...(transfer.savedPath !== undefined && { savedPath: transfer.savedPath }),
    };

    // Avoid duplicates
    if (this.historyIdSet.has(transfer.id)) {
      const idx = this.history.findIndex(h => h.id === transfer.id);
      if (idx >= 0) this.history[idx] = record;
    } else {
      this.historyIdSet.add(transfer.id);
      this.history.unshift(record);
    }

    // Keep history to 500 entries
    if (this.history.length > 500) {
      this.history = this.history.slice(0, 500);
    }

    this.emit('historyUpdated', this.history);
  }
}
