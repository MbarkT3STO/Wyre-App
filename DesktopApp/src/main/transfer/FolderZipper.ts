/**
 * FolderZipper.ts
 * Zips a folder into a single .zip file using Node's built-in zlib (DEFLATE).
 * No third-party archiver libraries — pure Node.js.
 *
 * ZIP format reference: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
 * We write a minimal but valid ZIP:
 *   - Local file headers + compressed data for each entry
 *   - Central directory at the end
 *   - End-of-central-directory record
 */

import { promises as fsp, createReadStream } from 'fs';
import { join, relative, basename } from 'path';
import { deflateRaw } from 'zlib';
import { promisify } from 'util';
import { createHash } from 'crypto';

const deflateRawAsync = promisify(deflateRaw);

// ─── ZIP constants ────────────────────────────────────────────────────────────

const LOCAL_FILE_HEADER_SIG  = 0x04034b50;
const CENTRAL_DIR_HEADER_SIG = 0x02014b50;
const END_OF_CENTRAL_DIR_SIG = 0x06054b50;
const VERSION_NEEDED = 20;   // 2.0 — supports DEFLATE
const VERSION_MADE_BY = 20;
const COMPRESSION_DEFLATE = 8;
const COMPRESSION_STORED  = 0;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function writeUInt16LE(buf: Buffer, offset: number, value: number): void {
  buf.writeUInt16LE(value, offset);
}

function writeUInt32LE(buf: Buffer, offset: number, value: number): void {
  buf.writeUInt32LE(value >>> 0, offset);
}

/** DOS date/time encoding for the current time */
function dosDateTime(): { date: number; time: number } {
  const now = new Date();
  const date =
    ((now.getFullYear() - 1980) << 9) |
    ((now.getMonth() + 1) << 5) |
    now.getDate();
  const time =
    (now.getHours() << 11) |
    (now.getMinutes() << 5) |
    Math.floor(now.getSeconds() / 2);
  return { date, time };
}

/** CRC-32 of a buffer */
function crc32(buf: Buffer): number {
  const table = crc32Table();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ (table[(crc ^ (buf[i] ?? 0)) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

let _crc32Table: Uint32Array | null = null;
function crc32Table(): Uint32Array {
  if (_crc32Table) return _crc32Table;
  _crc32Table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    _crc32Table[i] = c;
  }
  return _crc32Table;
}

// ─── Directory walker ─────────────────────────────────────────────────────────

async function walkDir(dir: string): Promise<string[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await walkDir(full);
      files.push(...sub);
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

// ─── Entry builder ────────────────────────────────────────────────────────────

interface ZipEntry {
  localHeaderOffset: number;
  nameBytes: Buffer;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  dosDate: number;
  dosTime: number;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export class FolderZipper {
  /**
   * Zip `folderPath` into `destPath`, calling `onProgress(pct)` as files are written.
   * Uses DEFLATE compression via Node's built-in zlib.
   */
  static async zip(
    folderPath: string,
    destPath: string,
    onProgress: (pct: number) => void,
  ): Promise<void> {
    const allFiles = await walkDir(folderPath);
    const total = allFiles.length;
    if (total === 0) {
      // Write an empty but valid ZIP
      await FolderZipper.writeEmptyZip(destPath);
      onProgress(100);
      return;
    }

    const chunks: Buffer[] = [];
    const entries: ZipEntry[] = [];
    let offset = 0;
    const { date: dosDate, time: dosTime } = dosDateTime();

    for (let i = 0; i < allFiles.length; i++) {
      const filePath = allFiles[i]!;
      // Store relative path with forward slashes (ZIP spec)
      const relPath = relative(folderPath, filePath).replace(/\\/g, '/');
      const nameBytes = Buffer.from(relPath, 'utf8');

      // Read file
      const fileData = await fsp.readFile(filePath);
      const uncompressedSize = fileData.length;
      const crc = crc32(fileData);

      // Compress
      let compressed: Buffer;
      let compressionMethod: number;
      if (uncompressedSize === 0) {
        compressed = Buffer.alloc(0);
        compressionMethod = COMPRESSION_STORED;
      } else {
        compressed = await deflateRawAsync(fileData) as Buffer;
        // Only use DEFLATE if it actually shrinks the data
        if (compressed.length >= uncompressedSize) {
          compressed = fileData;
          compressionMethod = COMPRESSION_STORED;
        } else {
          compressionMethod = COMPRESSION_DEFLATE;
        }
      }

      const compressedSize = compressed.length;

      // Local file header (30 bytes + name)
      const localHeader = Buffer.alloc(30 + nameBytes.length);
      writeUInt32LE(localHeader, 0,  LOCAL_FILE_HEADER_SIG);
      writeUInt16LE(localHeader, 4,  VERSION_NEEDED);
      writeUInt16LE(localHeader, 6,  0);                   // general purpose bit flag
      writeUInt16LE(localHeader, 8,  compressionMethod);
      writeUInt16LE(localHeader, 10, dosTime);
      writeUInt16LE(localHeader, 12, dosDate);
      writeUInt32LE(localHeader, 14, crc);
      writeUInt32LE(localHeader, 18, compressedSize);
      writeUInt32LE(localHeader, 22, uncompressedSize);
      writeUInt16LE(localHeader, 26, nameBytes.length);
      writeUInt16LE(localHeader, 28, 0);                   // extra field length
      nameBytes.copy(localHeader, 30);

      entries.push({
        localHeaderOffset: offset,
        nameBytes,
        crc,
        compressedSize,
        uncompressedSize,
        compressionMethod,
        dosDate,
        dosTime,
      });

      chunks.push(localHeader, compressed);
      offset += localHeader.length + compressedSize;

      onProgress(Math.round(((i + 1) / total) * 90)); // 0–90% for file writing
    }

    // Central directory
    const centralDirOffset = offset;
    for (const entry of entries) {
      const cdHeader = Buffer.alloc(46 + entry.nameBytes.length);
      writeUInt32LE(cdHeader, 0,  CENTRAL_DIR_HEADER_SIG);
      writeUInt16LE(cdHeader, 4,  VERSION_MADE_BY);
      writeUInt16LE(cdHeader, 6,  VERSION_NEEDED);
      writeUInt16LE(cdHeader, 8,  0);                          // general purpose bit flag
      writeUInt16LE(cdHeader, 10, entry.compressionMethod);
      writeUInt16LE(cdHeader, 12, entry.dosTime);
      writeUInt16LE(cdHeader, 14, entry.dosDate);
      writeUInt32LE(cdHeader, 16, entry.crc);
      writeUInt32LE(cdHeader, 20, entry.compressedSize);
      writeUInt32LE(cdHeader, 24, entry.uncompressedSize);
      writeUInt16LE(cdHeader, 28, entry.nameBytes.length);
      writeUInt16LE(cdHeader, 30, 0);                          // extra field length
      writeUInt16LE(cdHeader, 32, 0);                          // file comment length
      writeUInt16LE(cdHeader, 34, 0);                          // disk number start
      writeUInt16LE(cdHeader, 36, 0);                          // internal file attributes
      writeUInt32LE(cdHeader, 38, 0);                          // external file attributes
      writeUInt32LE(cdHeader, 42, entry.localHeaderOffset);
      entry.nameBytes.copy(cdHeader, 46);
      chunks.push(cdHeader);
      offset += cdHeader.length;
    }

    const centralDirSize = offset - centralDirOffset;

    // End of central directory record
    const eocd = Buffer.alloc(22);
    writeUInt32LE(eocd, 0,  END_OF_CENTRAL_DIR_SIG);
    writeUInt16LE(eocd, 4,  0);                    // disk number
    writeUInt16LE(eocd, 6,  0);                    // disk with central dir
    writeUInt16LE(eocd, 8,  entries.length);        // entries on this disk
    writeUInt16LE(eocd, 10, entries.length);        // total entries
    writeUInt32LE(eocd, 12, centralDirSize);
    writeUInt32LE(eocd, 16, centralDirOffset);
    writeUInt16LE(eocd, 20, 0);                    // comment length
    chunks.push(eocd);

    await fsp.writeFile(destPath, Buffer.concat(chunks));
    onProgress(100);

    // Suppress unused import warning — createReadStream and createHash are
    // available for future use (e.g. streaming large files).
    void createReadStream;
    void createHash;
  }

  private static async writeEmptyZip(destPath: string): Promise<void> {
    const eocd = Buffer.alloc(22);
    writeUInt32LE(eocd, 0, END_OF_CENTRAL_DIR_SIG);
    await fsp.writeFile(destPath, eocd);
  }
}
