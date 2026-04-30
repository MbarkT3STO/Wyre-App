/**
 * FileChunker.test.ts
 * Unit tests for FileChunker static utilities.
 * Uses real filesystem via temp files.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fsp } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileChunker } from '../src/main/transfer/FileChunker';

const TMP_DIR = join(tmpdir(), 'filedrop-test-' + Date.now());

beforeAll(async () => {
  await fsp.mkdir(TMP_DIR, { recursive: true });
});

afterAll(async () => {
  await fsp.rm(TMP_DIR, { recursive: true, force: true });
});

describe('FileChunker.computeChecksum', () => {
  it('computes a consistent SHA-256 checksum', async () => {
    const filePath = join(TMP_DIR, 'checksum-test.txt');
    await fsp.writeFile(filePath, 'Hello, FileDrop!');

    const checksum1 = await FileChunker.computeChecksum(filePath);
    const checksum2 = await FileChunker.computeChecksum(filePath);

    expect(checksum1).toBe(checksum2);
    expect(checksum1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different checksums for different content', async () => {
    const file1 = join(TMP_DIR, 'cs1.txt');
    const file2 = join(TMP_DIR, 'cs2.txt');
    await fsp.writeFile(file1, 'content A');
    await fsp.writeFile(file2, 'content B');

    const cs1 = await FileChunker.computeChecksum(file1);
    const cs2 = await FileChunker.computeChecksum(file2);

    expect(cs1).not.toBe(cs2);
  });

  it('produces correct SHA-256 for known content', async () => {
    const filePath = join(TMP_DIR, 'known.txt');
    // SHA-256 of empty string
    await fsp.writeFile(filePath, '');
    const checksum = await FileChunker.computeChecksum(filePath);
    expect(checksum).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('FileChunker.getFileSize', () => {
  it('returns the correct file size in bytes', async () => {
    const filePath = join(TMP_DIR, 'size-test.txt');
    const content = 'Hello World'; // 11 bytes
    await fsp.writeFile(filePath, content, 'utf8');

    const size = await FileChunker.getFileSize(filePath);
    expect(size).toBe(11);
  });

  it('returns 0 for an empty file', async () => {
    const filePath = join(TMP_DIR, 'empty.txt');
    await fsp.writeFile(filePath, '');
    const size = await FileChunker.getFileSize(filePath);
    expect(size).toBe(0);
  });
});

describe('FileChunker.ensureUniquePath', () => {
  it('returns the original path if file does not exist', async () => {
    const path = join(TMP_DIR, 'nonexistent-unique.txt');
    const result = await FileChunker.ensureUniquePath(path);
    expect(result).toBe(path);
  });

  it('appends (1) if file already exists', async () => {
    const path = join(TMP_DIR, 'duplicate.txt');
    await fsp.writeFile(path, 'exists');

    const result = await FileChunker.ensureUniquePath(path);
    expect(result).toBe(join(TMP_DIR, 'duplicate (1).txt'));
  });

  it('appends (2) if both original and (1) exist', async () => {
    const path = join(TMP_DIR, 'multi.txt');
    await fsp.writeFile(path, 'exists');
    await fsp.writeFile(join(TMP_DIR, 'multi (1).txt'), 'exists');

    const result = await FileChunker.ensureUniquePath(path);
    expect(result).toBe(join(TMP_DIR, 'multi (2).txt'));
  });

  it('handles files without extension', async () => {
    const path = join(TMP_DIR, 'noext');
    await fsp.writeFile(path, 'exists');

    const result = await FileChunker.ensureUniquePath(path);
    expect(result).toBe(join(TMP_DIR, 'noext (1)'));
  });
});

describe('FileChunker.deleteFile', () => {
  it('deletes an existing file', async () => {
    const path = join(TMP_DIR, 'to-delete.txt');
    await fsp.writeFile(path, 'delete me');
    await FileChunker.deleteFile(path);

    await expect(fsp.access(path)).rejects.toThrow();
  });

  it('does not throw if file does not exist', async () => {
    const path = join(TMP_DIR, 'does-not-exist.txt');
    await expect(FileChunker.deleteFile(path)).resolves.not.toThrow();
  });
});

describe('FileChunker.createReadStream', () => {
  it('creates a readable stream for a file', async () => {
    const path = join(TMP_DIR, 'readable.txt');
    const content = 'stream content';
    await fsp.writeFile(path, content);

    const stream = FileChunker.createReadStream(path);
    const chunks: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    const result = Buffer.concat(chunks).toString('utf8');
    expect(result).toBe(content);
  });
});

describe('FileChunker.createWriteStream', () => {
  it('creates a writable stream and creates parent directories', async () => {
    const path = join(TMP_DIR, 'nested', 'dir', 'output.txt');
    const stream = await FileChunker.createWriteStream(path);

    await new Promise<void>((resolve, reject) => {
      stream.write('written content');
      stream.end(resolve);
      stream.on('error', reject);
    });

    const content = await fsp.readFile(path, 'utf8');
    expect(content).toBe('written content');
  });
});
