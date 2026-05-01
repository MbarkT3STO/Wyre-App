/**
 * TransferServer.ts
 * TCP server that accepts incoming file transfer connections.
 * Emits typed events for incoming requests and transfer lifecycle.
 * No Electron/IPC knowledge — pure Node.js networking.
 */

import { createServer, Server, Socket } from 'net';
import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import { basename } from 'path';
import { FileChunker } from './FileChunker';

const PROGRESS_EMIT_INTERVAL_MS = 100;
const HEADER_MAX_SIZE = 4096;

// ─── File name sanitisation ───────────────────────────────────────────────────

/**
 * Sanitise a peer-supplied file name so it cannot escape the save directory.
 *
 * Rules applied (in order):
 *  1. Extract only the basename — strips any directory component (e.g. "../../etc/passwd" → "passwd")
 *  2. Remove null bytes and ASCII control characters
 *  3. Replace Windows-illegal characters  \ / : * ? " < > |
 *  4. Strip leading dots and spaces (hidden-file / trailing-space tricks)
 *  5. Reject Windows reserved device names (CON, NUL, COM1 … LPT9, etc.)
 *  6. Truncate to 255 bytes (max filename length on most filesystems)
 *  7. Fall back to "file" if the result is empty after sanitisation
 */
function sanitizeFileName(raw: string): string {
  // 1. Basename only — defeats path traversal
  let name = basename(raw);

  // 2. Remove null bytes and control characters
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\x00-\x1F\x7F]/g, '');

  // 3. Replace characters illegal on Windows (safe to apply on all platforms)
  name = name.replace(/[\\/:*?"<>|]/g, '_');

  // 4. Strip leading dots and spaces
  name = name.replace(/^[. ]+/, '');

  // 5. Reject Windows reserved device names (case-insensitive, with or without extension)
  const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;
  if (reserved.test(name)) {
    name = `_${name}`;
  }

  // 6. Truncate to 255 bytes
  const encoded = Buffer.from(name, 'utf8');
  if (encoded.length > 255) {
    name = encoded.slice(0, 255).toString('utf8').replace(/\uFFFD$/, '');
  }

  // 7. Fallback
  return name.length > 0 ? name : 'file';
}

export interface IncomingTransferRequest {
  transferId: string;
  senderDeviceId: string;
  senderName: string;
  fileName: string;
  fileSize: number;
  checksum: string;
  socket: Socket;
}

export interface TransferServerEvents {
  listening: (port: number) => void;
  incomingRequest: (request: IncomingTransferRequest) => void;
  progress: (transferId: string, bytesReceived: number, totalBytes: number, speed: number, eta: number) => void;
  complete: (transferId: string, savedPath: string) => void;
  error: (transferId: string | null, err: Error) => void;
  cancelled: (transferId: string) => void;
}

export declare interface TransferServer {
  on<K extends keyof TransferServerEvents>(event: K, listener: TransferServerEvents[K]): this;
  emit<K extends keyof TransferServerEvents>(event: K, ...args: Parameters<TransferServerEvents[K]>): boolean;
}

interface PendingRequest {
  socket: Socket;
  header: {
    transferId: string;
    senderDeviceId: string;
    senderName: string;
    fileName: string;
    fileSize: number;
    checksum: string;
  };
  remainingBuffer: Buffer;
}

interface ActiveReceive {
  socket: Socket;
  cancel: () => void;
}

export class TransferServer extends EventEmitter {
  private server: Server | null = null;
  private port = 0;
  /** Requests waiting for user accept/decline */
  private pendingRequests: Map<string, PendingRequest> = new Map();
  /** Active file receives (after accept) */
  private activeReceives: Map<string, ActiveReceive> = new Map();

  constructor() {
    super();
  }

  getPort(): number {
    return this.port;
  }

  start(preferredPort = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => this.handleConnection(socket));

      this.server.on('error', (err) => {
        this.emit('error', null, err);
        reject(err);
      });

      this.server.listen(preferredPort, '0.0.0.0', () => {
        const addr = this.server?.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
          this.emit('listening', this.port);
          resolve(this.port);
        } else {
          reject(new Error('Failed to get server address'));
        }
      });
    });
  }

  stop(): void {
    for (const [, pending] of this.pendingRequests) {
      pending.socket.destroy();
    }
    this.pendingRequests.clear();

    for (const [id, receive] of this.activeReceives) {
      receive.cancel();
      this.activeReceives.delete(id);
    }
    this.server?.close();
    this.server = null;
  }

  /**
   * Called by TransferQueue after user accepts.
   * Writes the accept response to the sender, then starts receiving.
   */
  triggerAccept(transferId: string, savePath: string): void {
    const pending = this.pendingRequests.get(transferId);
    if (!pending) return;
    this.pendingRequests.delete(transferId);

    // Tell the sender we accepted — this unblocks their streaming
    pending.socket.write(JSON.stringify({ accepted: true }) + '\n');

    this.receiveFile(pending.socket, pending.header, savePath, pending.remainingBuffer);
  }

  /**
   * Called by TransferQueue after user declines.
   */
  declineTransfer(transferId: string): void {
    const pending = this.pendingRequests.get(transferId);
    if (pending) {
      // Tell the sender we declined
      pending.socket.write(JSON.stringify({ accepted: false }) + '\n');
      pending.socket.destroy();
      this.pendingRequests.delete(transferId);
    }
  }

  /** Called by TransferQueue to cancel an active receive */
  cancelTransfer(transferId: string): void {
    const receive = this.activeReceives.get(transferId);
    if (receive) {
      receive.cancel();
      this.activeReceives.delete(transferId);
      this.emit('cancelled', transferId);
    }
  }

  /** Legacy: kept for IpcBridge compatibility — delegates to triggerAccept */
  acceptTransfer(transferId: string, savePath: string): void {
    this.triggerAccept(transferId, savePath);
  }

  private handleConnection(socket: Socket): void {
    // Disable Nagle's algorithm: progress feedback JSON lines are small and
    // must be sent immediately so the sender's UI stays responsive.
    socket.setNoDelay(true);

    let headerBuffer = Buffer.alloc(0);
    let headerParsed = false;
    let transferId: string | null = null;

    socket.on('error', (err) => {
      this.emit('error', transferId, err);
    });

    socket.on('data', (chunk: Buffer | string) => {
      if (headerParsed) return;

      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      headerBuffer = Buffer.concat([headerBuffer, buf]);

      if (headerBuffer.length > HEADER_MAX_SIZE) {
        socket.destroy(new Error('Header too large'));
        return;
      }

      // Find the newline that terminates the JSON header
      const newlineIdx = headerBuffer.indexOf(0x0a); // '\n'
      if (newlineIdx === -1) return;

      const headerLine = headerBuffer.slice(0, newlineIdx).toString('utf8');
      // Everything after the newline is the start of the file data
      const remainingBuffer = headerBuffer.slice(newlineIdx + 1);
      headerParsed = true;
      socket.pause();
      socket.removeAllListeners('data');

      try {
        const header = JSON.parse(headerLine) as {
          transferId: string;
          senderDeviceId: string;
          senderName: string;
          fileName: string;
          fileSize: number;
          checksum: string;
        };

        transferId = header.transferId;

        // Sanitise the peer-supplied file name to prevent path traversal
        const safeFileName = sanitizeFileName(header.fileName);

        // Store pending request — remainingBuffer is raw binary file data
        this.pendingRequests.set(header.transferId, {
          socket,
          header: { ...header, fileName: safeFileName },
          remainingBuffer,
        });

        const request: IncomingTransferRequest = {
          transferId: header.transferId,
          senderDeviceId: header.senderDeviceId,
          senderName: header.senderName,
          fileName: safeFileName,
          fileSize: header.fileSize,
          checksum: header.checksum,
          socket,
        };

        this.emit('incomingRequest', request);

      } catch (err) {
        socket.destroy(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private receiveFile(
    socket: Socket,
    header: { transferId: string; fileName: string; fileSize: number; checksum: string },
    savePath: string,
    remainingBuffer: Buffer,
  ): void {
    const { transferId, fileSize, checksum } = header;
    let bytesReceived = 0;
    let lastProgressTime = Date.now();
    let lastBytes = 0;
    let speed = 0;
    let cancelled = false;

    const hash = createHash('sha256');

    FileChunker.createWriteStream(savePath).then((writeStream) => {
      this.activeReceives.set(transferId, {
        socket,
        cancel: () => {
          cancelled = true;
          socket.destroy();
          writeStream.destroy();
          void FileChunker.deleteFile(savePath);
        },
      });

      // Write any file data that arrived in the same packet as the header
      if (remainingBuffer.length > 0) {
        hash.update(remainingBuffer);
        bytesReceived += remainingBuffer.length;
        const canContinue = writeStream.write(remainingBuffer);
        if (!canContinue) {
          socket.pause();
          writeStream.once('drain', () => socket.resume());
        }
      }

      let progressInterval: ReturnType<typeof setInterval> | null = setInterval(() => {
        const now = Date.now();
        const elapsed = (now - lastProgressTime) / 1000;
        speed = elapsed > 0 ? (bytesReceived - lastBytes) / elapsed : 0;
        lastProgressTime = now;
        lastBytes = bytesReceived;
        const eta = speed > 0 ? (fileSize - bytesReceived) / speed : Infinity;
        const progress = fileSize > 0 ? Math.min(Math.round((bytesReceived / fileSize) * 100), 99) : 0;
        this.emit('progress', transferId, bytesReceived, fileSize, speed, eta);
        // Write progress feedback back to the sender on the same socket so the
        // sender can display accurate receive-side progress in its own UI.
        if (!socket.destroyed && socket.writable) {
          socket.write(JSON.stringify({ p: progress, b: bytesReceived, s: Math.round(speed), e: Math.round(eta) }) + '\n');
        }
      }, PROGRESS_EMIT_INTERVAL_MS);

      socket.on('data', (chunk: Buffer | string) => {
        if (cancelled) return;
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        hash.update(buf);
        bytesReceived += buf.length;
        // Respect write-stream backpressure: if the write buffer is full,
        // pause the socket until the stream drains to avoid unbounded memory
        // growth and keep disk I/O from becoming the bottleneck.
        const canContinue = writeStream.write(buf);
        if (!canContinue) {
          socket.pause();
          writeStream.once('drain', () => socket.resume());
        }
      });

      socket.on('end', () => {
        if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
        if (cancelled) return;

        writeStream.end(() => {
          const receivedChecksum = hash.digest('hex');
          if (receivedChecksum !== checksum) {
            void FileChunker.deleteFile(savePath);
            this.emit('error', transferId, new Error('Checksum mismatch — file corrupted'));
          } else {
            this.emit('complete', transferId, savePath);
          }
          this.activeReceives.delete(transferId);
        });
      });

      socket.on('error', (err) => {
        if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
        if (!cancelled) {
          writeStream.destroy();
          void FileChunker.deleteFile(savePath);
          this.emit('error', transferId, err);
        }
        this.activeReceives.delete(transferId);
      });

      socket.resume();
    }).catch((err: Error) => {
      this.emit('error', transferId, err);
    });
  }
}
