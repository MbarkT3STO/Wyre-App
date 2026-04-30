/**
 * TransferClient.ts
 * TCP client that connects to a peer's TransferServer and streams a file.
 * Emits typed events for progress and completion.
 * No Electron/IPC knowledge — pure Node.js networking.
 */

import { connect, Socket } from 'net';
import { EventEmitter } from 'events';
import { FileChunker } from './FileChunker';
import { randomUUID } from 'crypto';

const PROGRESS_EMIT_INTERVAL_MS = 100;

export interface SendFileOptions {
  filePath: string;
  fileName: string;
  fileSize: number;
  checksum: string;
  peerIp: string;
  peerPort: number;
  senderDeviceId: string;
  senderName: string;
}

export interface TransferClientEvents {
  progress: (transferId: string, bytesSent: number, totalBytes: number, speed: number, eta: number) => void;
  complete: (transferId: string) => void;
  error: (transferId: string, err: Error) => void;
  cancelled: (transferId: string) => void;
  declined: (transferId: string) => void;
}

export declare interface TransferClient {
  on<K extends keyof TransferClientEvents>(event: K, listener: TransferClientEvents[K]): this;
  emit<K extends keyof TransferClientEvents>(event: K, ...args: Parameters<TransferClientEvents[K]>): boolean;
}

interface ActiveSend {
  socket: Socket;
  cancel: () => void;
}

export class TransferClient extends EventEmitter {
  private activeSends: Map<string, ActiveSend> = new Map();

  /**
   * Initiate a file transfer to a peer.
   * Returns the transferId immediately; events fire asynchronously.
   */
  sendFile(options: SendFileOptions): string {
    const transferId = randomUUID();
    this.doSend(transferId, options);
    return transferId;
  }

  /**
   * Same as sendFile but uses a caller-supplied transferId.
   * Used by TransferQueue so it can register the transfer before
   * the TCP connection starts, preventing lost progress events.
   */
  sendFileWithId(transferId: string, options: SendFileOptions): void {
    this.doSend(transferId, options);
  }

  cancelTransfer(transferId: string): void {
    const send = this.activeSends.get(transferId);
    if (send) {
      send.cancel();
      this.activeSends.delete(transferId);
      this.emit('cancelled', transferId);
    }
  }

  private doSend(transferId: string, options: SendFileOptions): void {
    const { filePath, fileName, fileSize, checksum, peerIp, peerPort, senderDeviceId, senderName } = options;

    const socket = connect({ host: peerIp, port: peerPort }, () => {
      // Send JSON header
      const header = JSON.stringify({
        transferId,
        senderDeviceId,
        senderName,
        fileName,
        fileSize,
        checksum,
      }) + '\n';

      socket.write(header);

      // Wait for accept/decline response from receiver.
      // The response is a newline-terminated JSON line, but it may arrive
      // split across multiple TCP packets, so we accumulate until we see '\n'.
      let responseBuffer = '';

      const onResponseData = (chunk: Buffer): void => {
        responseBuffer += chunk.toString('utf8');
        const newlineIdx = responseBuffer.indexOf('\n');
        if (newlineIdx === -1) return; // incomplete — wait for more data

        // We have a full line — stop listening for response data
        socket.removeListener('data', onResponseData);

        try {
          const response = JSON.parse(responseBuffer.slice(0, newlineIdx)) as { accepted: boolean };
          if (!response.accepted) {
            socket.destroy();
            this.activeSends.delete(transferId);
            this.emit('declined', transferId);
            return;
          }

          // Accepted — start streaming
          this.streamFile(socket, transferId, filePath, fileSize);
        } catch (err) {
          socket.destroy(err instanceof Error ? err : new Error(String(err)));
          this.emit('error', transferId, err instanceof Error ? err : new Error(String(err)));
        }
      };

      socket.on('data', onResponseData);
    });

    let cancelled = false;

    this.activeSends.set(transferId, {
      socket,
      cancel: () => {
        cancelled = true;
        socket.destroy();
      },
    });

    socket.on('error', (err) => {
      if (!cancelled) {
        this.emit('error', transferId, err);
      }
      this.activeSends.delete(transferId);
    });

    socket.on('close', () => {
      this.activeSends.delete(transferId);
    });
  }

  private streamFile(socket: Socket, transferId: string, filePath: string, fileSize: number): void {
    const readStream = FileChunker.createReadStream(filePath);
    let bytesSent = 0;
    let lastProgressTime = Date.now();
    let lastBytes = 0;
    let speed = 0;
    let cancelled = false;

    // Update cancel handler to also destroy the read stream
    const existing = this.activeSends.get(transferId);
    if (existing) {
      this.activeSends.set(transferId, {
        socket,
        cancel: () => {
          cancelled = true;
          readStream.destroy();
          socket.destroy();
        },
      });
    }

    const progressInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - lastProgressTime) / 1000;
      speed = elapsed > 0 ? (bytesSent - lastBytes) / elapsed : 0;
      lastProgressTime = now;
      lastBytes = bytesSent;
      const eta = speed > 0 ? (fileSize - bytesSent) / speed : Infinity;
      this.emit('progress', transferId, bytesSent, fileSize, speed, eta);
    }, PROGRESS_EMIT_INTERVAL_MS);

    readStream.on('data', (chunk: Buffer | string) => {
      if (cancelled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      socket.write(buf);
      bytesSent += buf.length;
    });

    readStream.on('end', () => {
      clearInterval(progressInterval);
      if (!cancelled) {
        socket.end();
        this.emit('complete', transferId);
      }
      this.activeSends.delete(transferId);
    });

    readStream.on('error', (err) => {
      clearInterval(progressInterval);
      if (!cancelled) {
        socket.destroy(err);
        this.emit('error', transferId, err);
      }
      this.activeSends.delete(transferId);
    });
  }
}
