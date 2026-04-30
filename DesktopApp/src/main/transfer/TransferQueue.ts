/**
 * TransferQueue.ts
 * Manages concurrent transfers (both sending and receiving).
 * Tracks all active and historical transfers.
 * Delegates actual I/O to TransferClient and TransferServer.
 */

import { EventEmitter } from 'events';
import { join } from 'path';
import { TransferClient } from './TransferClient';
import { TransferServer } from './TransferServer';
import { FileChunker } from './FileChunker';
import type { Transfer, TransferRecord } from '../../shared/models/Transfer';
import { TransferStatus } from '../../shared/models/Transfer';

export interface TransferQueueEvents {
  transferUpdated: (transfer: Transfer) => void;
  historyUpdated: (history: TransferRecord[]) => void;
}

export declare interface TransferQueue {
  on<K extends keyof TransferQueueEvents>(event: K, listener: TransferQueueEvents[K]): this;
  emit<K extends keyof TransferQueueEvents>(event: K, ...args: Parameters<TransferQueueEvents[K]>): boolean;
}

export class TransferQueue extends EventEmitter {
  private transfers: Map<string, Transfer> = new Map();
  private history: TransferRecord[] = [];
  private client: TransferClient;
  private server: TransferServer;

  constructor(client: TransferClient, server: TransferServer) {
    super();
    this.client = client;
    this.server = server;
    this.wireClientEvents();
    this.wireServerEvents();
  }

  private wireClientEvents(): void {
    this.client.on('progress', (transferId, bytesSent, totalBytes, speed, eta) => {
      this.updateTransfer(transferId, {
        status: TransferStatus.Active,
        bytesTransferred: bytesSent,
        progress: totalBytes > 0 ? Math.round((bytesSent / totalBytes) * 100) : 0,
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
    });

    this.client.on('error', (transferId, err) => {
      this.failTransfer(transferId, err.message, 'SEND_ERROR');
    });

    this.client.on('cancelled', (transferId) => {
      this.updateTransfer(transferId, { status: TransferStatus.Cancelled, completedAt: Date.now() });
      const t = this.transfers.get(transferId);
      if (t) this.addToHistory(t);
    });

    this.client.on('declined', (transferId) => {
      this.updateTransfer(transferId, {
        status: TransferStatus.Declined,
        completedAt: Date.now(),
        errorMessage: 'Transfer was declined by the recipient',
      });
      const t = this.transfers.get(transferId);
      if (t) this.addToHistory(t);
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
    });

    this.server.on('error', (transferId, err) => {
      if (transferId) this.failTransfer(transferId, err.message, 'RECEIVE_ERROR');
    });

    this.server.on('cancelled', (transferId) => {
      this.updateTransfer(transferId, { status: TransferStatus.Cancelled, completedAt: Date.now() });
      const t = this.transfers.get(transferId);
      if (t) this.addToHistory(t);
    });
  }

  /** Queue a new outgoing transfer */
  async enqueueSend(options: {
    filePath: string;
    peerIp: string;
    peerPort: number;
    peerId: string;
    peerName: string;
    senderDeviceId: string;
    senderName: string;
  }): Promise<string> {
    const { filePath, peerIp, peerPort, peerId, peerName, senderDeviceId, senderName } = options;

    const fileName = filePath.split('/').pop() ?? filePath.split('\\').pop() ?? 'file';

    // Compute size and checksum BEFORE starting the TCP connection.
    // This ensures the transfer is registered in this.transfers before
    // any progress events can fire from TransferClient.
    const fileSize = await FileChunker.getFileSize(filePath);
    const checksum = await FileChunker.computeChecksum(filePath);

    // Generate the transferId ourselves so we can register it first
    const { randomUUID } = await import('crypto');
    const transferId = randomUUID();

    // Register in the map BEFORE calling sendFile — progress events
    // from TransferClient reference this id and must find it here
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

    // Now start the TCP connection — progress events will find the entry above
    this.client.sendFileWithId(transferId, {
      filePath,
      fileName,
      fileSize,
      checksum,
      peerIp,
      peerPort,
      senderDeviceId,
      senderName,
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
    if (t) this.addToHistory(t);
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

  getHistory(): TransferRecord[] {
    return [...this.history];
  }

  clearHistory(): void {
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
    const idx = this.history.findIndex(h => h.id === transfer.id);
    if (idx >= 0) {
      this.history[idx] = record;
    } else {
      this.history.unshift(record);
    }

    // Keep history to 500 entries
    if (this.history.length > 500) {
      this.history = this.history.slice(0, 500);
    }

    this.emit('historyUpdated', this.history);
  }
}
