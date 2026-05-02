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
import { TransferCrypto } from '../crypto/TransferCrypto';

export interface SendFileOptions {
  filePath: string;
  fileName: string;
  fileSize: number;
  checksum: string;
  peerIp: string;
  peerPort: number;
  senderDeviceId: string;
  senderName: string;
  resumeOffset?: number;
  /** Whether the peer advertised AES-256-GCM encryption support */
  peerSupportsEncryption?: boolean;
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
  /** AES-256-GCM key — set after handshake if encryption was negotiated */
  encryptionKey?: Buffer;
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
    const {
      filePath, fileName, fileSize, checksum,
      peerIp, peerPort, senderDeviceId, senderName,
      resumeOffset = 0,
      peerSupportsEncryption = false,
    } = options;

    const socket = connect({ host: peerIp, port: peerPort }, () => {
      // Disable Nagle's algorithm so small writes (header, feedback ACKs) are
      // sent immediately without waiting to coalesce into a larger segment.
      socket.setNoDelay(true);

      // ── Build JSON header ──────────────────────────────────────────────────
      let senderKeyPair: ReturnType<typeof TransferCrypto.generateKeyPair> | null = null;

      const headerObj: Record<string, unknown> = {
        transferId,
        senderDeviceId,
        senderName,
        fileName,
        fileSize,
        checksum,
        ...(resumeOffset > 0 && { resumeOffset }),
      };

      if (peerSupportsEncryption) {
        senderKeyPair = TransferCrypto.generateKeyPair();
        headerObj['encryption'] = {
          supported: true,
          senderPublicKey: senderKeyPair.publicKeyDer.toString('base64'),
        };
      }

      socket.write(JSON.stringify(headerObj) + '\n');

      // ── Wait for accept/decline response ───────────────────────────────────
      let responseBuffer = '';

      const onResponseData = (chunk: Buffer): void => {
        responseBuffer += chunk.toString('utf8');
        const newlineIdx = responseBuffer.indexOf('\n');
        if (newlineIdx === -1) return;

        socket.removeListener('data', onResponseData);

        try {
          const response = JSON.parse(responseBuffer.slice(0, newlineIdx)) as {
            accepted: boolean;
            resumeOffset?: number;
            encryption?: { accepted: boolean; receiverPublicKey: string };
          };

          if (!response.accepted) {
            socket.destroy();
            this.activeSends.delete(transferId);
            this.emit('declined', transferId);
            return;
          }

          const serverOffset = response.resumeOffset ?? resumeOffset;

          // ── Negotiate encryption ─────────────────────────────────────────
          let encryptionKey: Buffer | undefined;

          if (
            peerSupportsEncryption &&
            senderKeyPair !== null &&
            response.encryption?.accepted === true &&
            typeof response.encryption.receiverPublicKey === 'string'
          ) {
            const receiverPubKeyDer = Buffer.from(response.encryption.receiverPublicKey, 'base64');
            encryptionKey = TransferCrypto.deriveKey(
              senderKeyPair.privateKey,
              receiverPubKeyDer,
              senderKeyPair.publicKeyDer,
              receiverPubKeyDer,
            );

            // Store key on the active send entry
            const existing = this.activeSends.get(transferId);
            if (existing) {
              this.activeSends.set(transferId, { ...existing, encryptionKey });
            }
          }

          this.streamFile(socket, transferId, filePath, fileSize, serverOffset, encryptionKey);
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

  private streamFile(
    socket: Socket,
    transferId: string,
    filePath: string,
    fileSize: number,
    resumeOffset = 0,
    encryptionKey?: Buffer,
  ): void {
    if (encryptionKey !== undefined) {
      this.streamFileEncrypted(socket, transferId, filePath, fileSize, resumeOffset, encryptionKey);
    } else {
      this.streamFilePlaintext(socket, transferId, filePath, fileSize, resumeOffset);
    }
  }

  /** Plaintext streaming — original behaviour, unchanged. */
  private streamFilePlaintext(
    socket: Socket,
    transferId: string,
    filePath: string,
    fileSize: number,
    resumeOffset = 0,
  ): void {
    const readStream = FileChunker.createReadStream(filePath, resumeOffset > 0 ? resumeOffset : undefined);
    let cancelled = false;
    let streamDone = false;

    const existing = this.activeSends.get(transferId);
    if (existing) {
      this.activeSends.set(transferId, {
        ...existing,
        cancel: () => {
          cancelled = true;
          readStream.destroy();
          socket.destroy();
        },
      });
    }

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

    readStream.pipe(socket, { end: false });

    readStream.on('end', () => {
      if (cancelled) {
        this.activeSends.delete(transferId);
        return;
      }
      streamDone = true;
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

  /** Encrypted streaming — reads file in TRANSFER_CHUNK_SIZE chunks, encrypts each. */
  private streamFileEncrypted(
    socket: Socket,
    transferId: string,
    filePath: string,
    fileSize: number,
    resumeOffset = 0,
    encryptionKey: Buffer,
  ): void {
    const CHUNK_SIZE = 1024 * 1024; // 1 MB — matches TRANSFER_CHUNK_SIZE
    let cancelled = false;

    const existing = this.activeSends.get(transferId);
    if (existing) {
      this.activeSends.set(transferId, {
        ...existing,
        cancel: () => {
          cancelled = true;
          socket.destroy();
        },
      });
    }

    // Feedback listener (same as plaintext path)
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

    // Read and encrypt the file asynchronously
    const doEncryptedStream = async (): Promise<void> => {
      const { createReadStream } = await import('fs');
      const readStream = createReadStream(filePath, {
        start: resumeOffset > 0 ? resumeOffset : 0,
        highWaterMark: CHUNK_SIZE,
      });

      for await (const rawChunk of readStream) {
        if (cancelled) return;
        const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as Uint8Array);
        const encrypted = TransferCrypto.encryptChunk(encryptionKey, chunk);
        const encoded = TransferCrypto.encodeChunk(encrypted);

        // Respect backpressure
        const canContinue = socket.write(encoded);
        if (!canContinue) {
          await new Promise<void>((resolve) => socket.once('drain', resolve));
        }
      }

      if (!cancelled) {
        socket.end();
        await new Promise<void>((resolve) => socket.once('close', resolve));
        if (!cancelled) {
          this.emit('progress', transferId, fileSize, fileSize, 0, 0, 100);
          this.emit('complete', transferId);
        }
      }
    };

    doEncryptedStream().catch((err: Error) => {
      if (!cancelled) {
        socket.destroy(err);
        this.emit('error', transferId, err);
      }
      this.activeSends.delete(transferId);
    });
  }
}
