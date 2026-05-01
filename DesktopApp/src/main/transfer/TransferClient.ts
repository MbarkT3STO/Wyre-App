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
  progress: (transferId: string, bytesSent: number, totalBytes: number, speed: number, eta: number, progress: number) => void;
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
      // Disable Nagle's algorithm so small writes (header, feedback ACKs) are
      // sent immediately without waiting to coalesce into a larger segment.
      // For bulk data the kernel will still batch full-sized segments.
      socket.setNoDelay(true);

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
    let cancelled = false;
    let streamDone = false;

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

    // The receiver writes progress-feedback JSON lines back on the same socket
    // while it receives data. We read those here to drive the sender's progress.
    // Format: {"p":<0-100>,"b":<bytesReceived>,"s":<speed>,"e":<eta>}\n
    let feedbackBuffer = '';
    socket.on('data', (chunk: Buffer) => {
      feedbackBuffer += chunk.toString('utf8');
      let newlineIdx: number;
      while ((newlineIdx = feedbackBuffer.indexOf('\n')) !== -1) {
        const line = feedbackBuffer.slice(0, newlineIdx);
        feedbackBuffer = feedbackBuffer.slice(newlineIdx + 1);
        try {
          const fb = JSON.parse(line) as { p: number; b: number; s: number; e: number };
          if (typeof fb.p === 'number') {
            this.emit('progress', transferId, fb.b, fileSize, fb.s, fb.e, fb.p);
          }
        } catch {
          // ignore malformed feedback
        }
      }
    });

    // Use pipe() so Node.js stream backpressure is respected automatically:
    // when the socket's write buffer is full, the read stream pauses until the
    // kernel drains the buffer — preventing unbounded memory growth and keeping
    // the event loop free for other work.
    // `end: false` because we call socket.end() manually after the stream
    // finishes so we can emit the correct events in the right order.
    readStream.pipe(socket, { end: false });

    readStream.on('end', () => {
      if (cancelled) {
        this.activeSends.delete(transferId);
        return;
      }

      streamDone = true;

      // Half-close the write side — signals end of file data to the receiver.
      // The socket read side stays open so we keep receiving progress feedback.
      socket.end();

      socket.once('close', (hadError: boolean) => {
        if (!cancelled && !hadError) {
          this.emit('progress', transferId, fileSize, fileSize, 0, 0, 100);
          this.emit('complete', transferId);
        }
        this.activeSends.delete(transferId);
      });
    });

    readStream.on('error', (err) => {
      if (!cancelled) {
        socket.destroy(err);
        this.emit('error', transferId, err);
      }
      this.activeSends.delete(transferId);
    });

    void streamDone;
  }
}
