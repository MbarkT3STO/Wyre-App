/**
 * FileChunker.ts
 * Handles chunked file I/O with progress callbacks.
 * Single responsibility: read/write files in chunks, compute checksums.
 */

import { createReadStream, createWriteStream, promises as fsp } from 'fs';
import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import { dirname } from 'path';

const CHUNK_SIZE = 64 * 1024; // 64 KB

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
   */
  static async computeChecksum(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(filePath, { highWaterMark: CHUNK_SIZE });
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
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
   * Returns the stream and total file size.
   */
  static createReadStream(filePath: string): ReturnType<typeof createReadStream> {
    return createReadStream(filePath, { highWaterMark: CHUNK_SIZE });
  }

  /**
   * Create a writable stream for receiving a file.
   * Ensures the destination directory exists.
   */
  static async createWriteStream(destPath: string): Promise<ReturnType<typeof createWriteStream>> {
    await fsp.mkdir(dirname(destPath), { recursive: true });
    return createWriteStream(destPath);
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
