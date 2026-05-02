/**
 * FileChunker.ts
 * Handles chunked file I/O with progress callbacks.
 * Single responsibility: read/write files in chunks, compute checksums.
 */

import { createReadStream, createWriteStream, promises as fsp } from 'fs';
import { EventEmitter } from 'events';
import { dirname, join } from 'path';
import { Worker } from 'worker_threads';
import { TRANSFER_CHUNK_SIZE } from '../../shared/utils/constants';

export interface ChunkReadEvents {
  progress: (bytesRead: number, totalBytes: number) => void;
  error: (err: Error) => void;
  done: (checksum: string) => void;
}

export declare interface FileChunker {
  on<K extends keyof ChunkReadEvents>(event: K, listener: ChunkReadEvents[K]): this;
  emit<K extends keyof ChunkReadEvents>(event: K, ...args: Parameters<ChunkReadEvents[K]>): boolean;
}

export class FileChunker extends EventEmitter {
  /**
   * Compute the SHA-256 checksum of a file.
   *
   * Runs in a dedicated worker thread so the main-process event loop is never
   * blocked — even for multi-gigabyte files the UI and TCP handshake remain
   * fully responsive while hashing proceeds in parallel.
   */
  static computeChecksum(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // Resolve the worker script path relative to this file at runtime.
      // In the Vite/Electron build the worker is bundled alongside FileChunker
      // in dist/main/, so __dirname points to the right place.
      const workerPath = join(__dirname, 'checksumWorker.js');

      const worker = new Worker(workerPath, { workerData: { filePath } });

      worker.on('message', (msg: { checksum?: string; error?: string }) => {
        if (msg.error) {
          reject(new Error(msg.error));
        } else if (msg.checksum) {
          resolve(msg.checksum);
        }
      });

      worker.on('error', reject);

      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Checksum worker exited with code ${code}`));
        }
      });
    });
  }

  /**
   * Get the size of a file in bytes.
   */
  static async getFileSize(filePath: string): Promise<number> {
    const stat = await fsp.stat(filePath);
    return stat.size;
  }

  /**
   * Create a readable stream for sending a file in chunks.
   * Optionally starts from `startOffset` bytes for resume support.
   */
  static createReadStream(filePath: string, startOffset?: number): ReturnType<typeof createReadStream> {
    return createReadStream(filePath, {
      highWaterMark: TRANSFER_CHUNK_SIZE,
      ...(startOffset !== undefined && startOffset > 0 && { start: startOffset }),
    });
  }

  /**
   * Create a writable stream for receiving a file.
   * Ensures the destination directory exists.
   * highWaterMark matches the read-side chunk size so the stream's internal
   * buffer can absorb a full chunk without stalling the socket.
   * Pass `appendMode: true` to open with flags:'a' for resume support.
   */
  static async createWriteStream(destPath: string, appendMode = false): Promise<ReturnType<typeof createWriteStream>> {
    await fsp.mkdir(dirname(destPath), { recursive: true });
    return createWriteStream(destPath, {
      highWaterMark: TRANSFER_CHUNK_SIZE,
      ...(appendMode && { flags: 'a' }),
    });
  }

  /**
   * Delete a file (used to clean up failed/partial transfers).
   */
  static async deleteFile(filePath: string): Promise<void> {
    try {
      await fsp.unlink(filePath);
    } catch {
      // File may not exist — ignore
    }
  }

  /**
   * Ensure a unique file path by appending a counter if the file already exists.
   * @example ensureUniquePath('/downloads/file.txt') → '/downloads/file (1).txt'
   */
  static async ensureUniquePath(filePath: string): Promise<string> {
    try {
      await fsp.access(filePath);
    } catch {
      return filePath; // File doesn't exist, path is free
    }

    const dotIndex = filePath.lastIndexOf('.');
    const hasExt = dotIndex > filePath.lastIndexOf('/') && dotIndex !== -1;
    const base = hasExt ? filePath.slice(0, dotIndex) : filePath;
    const ext = hasExt ? filePath.slice(dotIndex) : '';

    let counter = 1;
    while (counter < 1000) {
      const candidate = `${base} (${counter})${ext}`;
      try {
        await fsp.access(candidate);
        counter++;
      } catch {
        return candidate;
      }
    }
    return `${base} (${Date.now()})${ext}`;
  }
}
