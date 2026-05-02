/**
 * FolderZipper.test.ts
 * Unit tests for FolderZipper — streaming ZIP creation.
 * Uses real tmp directories via fsp.mkdtemp.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { promises as fsp } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FolderZipper } from '../src/main/transfer/FolderZipper';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function makeTmpDir(): Promise<string> {
  return fsp.mkdtemp(join(tmpdir(), 'wyre-zip-test-'));
}

const tmpDirs: string[] = [];

async function createTmpDir(): Promise<string> {
  const dir = await makeTmpDir();
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  // Clean up all temp dirs created during the test
  for (const dir of tmpDirs.splice(0)) {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FolderZipper', () => {
  describe('Case 1 — empty folder', () => {
    it('produces a valid ZIP with EOCD signature and calls onProgress(100)', async () => {
      const srcDir = await createTmpDir();
      const destDir = await createTmpDir();
      const destPath = join(destDir, 'out.zip');

      const progressValues: number[] = [];
      await FolderZipper.zip(srcDir, destPath, (pct) => progressValues.push(pct));

      // File must exist
      const stat = await fsp.stat(destPath);
      expect(stat.size).toBeGreaterThan(0);

      // First 4 bytes of an empty ZIP are the EOCD signature (0x06054b50, little-endian)
      const buf = await fsp.readFile(destPath);
      expect(buf[0]).toBe(0x50); // P
      expect(buf[1]).toBe(0x4b); // K
      expect(buf[2]).toBe(0x05);
      expect(buf[3]).toBe(0x06);

      // onProgress must have been called with 100
      expect(progressValues).toContain(100);
    });
  });

  describe('Case 2 — single file', () => {
    it('produces a ZIP ≥ 30 bytes, calls onProgress(100), and is not larger than original for compressible content', async () => {
      const srcDir = await createTmpDir();
      const destDir = await createTmpDir();
      const destPath = join(destDir, 'out.zip');

      // Write a compressible text file
      const content = 'hello world\n'.repeat(200);
      await fsp.writeFile(join(srcDir, 'hello.txt'), content, 'utf8');

      const progressValues: number[] = [];
      await FolderZipper.zip(srcDir, destPath, (pct) => progressValues.push(pct));

      const zipStat = await fsp.stat(destPath);
      // Must be at least 30 bytes (local file header minimum)
      expect(zipStat.size).toBeGreaterThanOrEqual(30);

      // onProgress must reach 100
      expect(progressValues).toContain(100);

      // Compressible content: ZIP should be smaller than original
      const originalSize = Buffer.byteLength(content, 'utf8');
      expect(zipStat.size).toBeLessThanOrEqual(originalSize);
    });
  });

  describe('Case 3 — nested directory', () => {
    it('contains exactly 2 entries with correct relative paths (forward slashes, no leading slash)', async () => {
      const srcDir = await createTmpDir();
      const destDir = await createTmpDir();
      const destPath = join(destDir, 'out.zip');

      // Create root/a.txt and root/sub/b.txt
      await fsp.writeFile(join(srcDir, 'a.txt'), 'file a', 'utf8');
      await fsp.mkdir(join(srcDir, 'sub'));
      await fsp.writeFile(join(srcDir, 'sub', 'b.txt'), 'file b', 'utf8');

      await FolderZipper.zip(srcDir, destPath, () => {});

      const buf = await fsp.readFile(destPath);

      // Parse the central directory to extract entry names
      const entryNames = parseCentralDirectoryNames(buf);

      expect(entryNames).toHaveLength(2);
      expect(entryNames).toContain('a.txt');
      expect(entryNames).toContain('sub/b.txt');

      // No entry should have a leading slash
      for (const name of entryNames) {
        expect(name.startsWith('/')).toBe(false);
      }
    });
  });

  describe('Case 4 — progress monotonicity', () => {
    it('onProgress values are non-decreasing and end at 100', async () => {
      const srcDir = await createTmpDir();
      const destDir = await createTmpDir();
      const destPath = join(destDir, 'out.zip');

      // Create several files to generate multiple progress calls
      for (let i = 0; i < 5; i++) {
        await fsp.writeFile(join(srcDir, `file${i}.txt`), `content ${i}`.repeat(50), 'utf8');
      }

      const progressValues: number[] = [];
      await FolderZipper.zip(srcDir, destPath, (pct) => progressValues.push(pct));

      expect(progressValues.length).toBeGreaterThan(0);

      // Non-decreasing
      for (let i = 1; i < progressValues.length; i++) {
        expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1]!);
      }

      // Must end at 100
      expect(progressValues[progressValues.length - 1]).toBe(100);
    });
  });
});

// ─── ZIP central directory parser ─────────────────────────────────────────────

/**
 * Minimal parser: scans the buffer for central directory header signatures
 * (0x02014b50) and extracts the file name from each entry.
 */
function parseCentralDirectoryNames(buf: Buffer): string[] {
  const CD_SIG = 0x02014b50;
  const names: string[] = [];
  let pos = 0;

  while (pos < buf.length - 4) {
    if (buf.readUInt32LE(pos) === CD_SIG) {
      // Central directory header layout:
      //  0  signature         4 bytes
      //  4  version made by   2 bytes
      //  6  version needed    2 bytes
      //  8  general purpose   2 bytes
      // 10  compression       2 bytes
      // 12  mod time          2 bytes
      // 14  mod date          2 bytes
      // 16  crc-32            4 bytes
      // 20  compressed size   4 bytes
      // 24  uncompressed size 4 bytes
      // 28  file name length  2 bytes
      // 30  extra field len   2 bytes
      // 32  file comment len  2 bytes
      // 34  disk number start 2 bytes
      // 36  int file attrs    2 bytes
      // 38  ext file attrs    4 bytes
      // 42  local header off  4 bytes
      // 46  file name         (file name length bytes)
      const nameLen = buf.readUInt16LE(pos + 28);
      const extraLen = buf.readUInt16LE(pos + 30);
      const commentLen = buf.readUInt16LE(pos + 32);
      const name = buf.slice(pos + 46, pos + 46 + nameLen).toString('utf8');
      names.push(name);
      pos += 46 + nameLen + extraLen + commentLen;
    } else {
      pos++;
    }
  }

  return names;
}
