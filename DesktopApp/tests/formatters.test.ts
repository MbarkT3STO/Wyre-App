/**
 * formatters.test.ts
 * Unit tests for all formatter utility functions.
 */

import { describe, it, expect } from 'vitest';
import {
  formatFileSize,
  formatSpeed,
  formatEta,
  formatDuration,
  truncateFilename,
  getExtension,
} from '../src/shared/utils/formatters';

describe('formatFileSize', () => {
  it('returns "0 B" for zero', () => {
    expect(formatFileSize(0)).toBe('0 B');
  });

  it('returns "—" for negative values', () => {
    expect(formatFileSize(-1)).toBe('—');
  });

  it('formats bytes correctly', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1)).toBe('1 B');
  });

  it('formats kilobytes correctly', () => {
    expect(formatFileSize(1024)).toBe('1.00 KB');
    expect(formatFileSize(1536)).toBe('1.50 KB');
    expect(formatFileSize(10240)).toBe('10.0 KB');
  });

  it('formats megabytes correctly', () => {
    expect(formatFileSize(1048576)).toBe('1.00 MB');
    expect(formatFileSize(10 * 1024 * 1024)).toBe('10.0 MB');
  });

  it('formats gigabytes correctly', () => {
    expect(formatFileSize(1073741824)).toBe('1.00 GB');
  });

  it('formats terabytes correctly', () => {
    expect(formatFileSize(1099511627776)).toBe('1.00 TB');
  });
});

describe('formatSpeed', () => {
  it('returns "—" for zero or negative', () => {
    expect(formatSpeed(0)).toBe('—');
    expect(formatSpeed(-100)).toBe('—');
  });

  it('formats bytes/sec', () => {
    expect(formatSpeed(512)).toBe('512 B/s');
  });

  it('formats KB/s', () => {
    expect(formatSpeed(1024)).toBe('1.00 KB/s');
  });

  it('formats MB/s', () => {
    expect(formatSpeed(1048576)).toBe('1.00 MB/s');
  });
});

describe('formatEta', () => {
  it('returns "—" for non-finite values', () => {
    expect(formatEta(Infinity)).toBe('—');
    expect(formatEta(NaN)).toBe('—');
    expect(formatEta(-1)).toBe('—');
  });

  it('returns "< 1s" for sub-second values', () => {
    expect(formatEta(0)).toBe('< 1s');
    expect(formatEta(0.5)).toBe('< 1s');
  });

  it('formats seconds', () => {
    expect(formatEta(1)).toBe('1s');
    expect(formatEta(45)).toBe('45s');
    expect(formatEta(59)).toBe('59s');
  });

  it('formats minutes and seconds', () => {
    expect(formatEta(60)).toBe('1m');
    expect(formatEta(90)).toBe('1m 30s');
    expect(formatEta(3599)).toBe('59m 59s');
  });

  it('formats hours and minutes', () => {
    expect(formatEta(3600)).toBe('1h');
    expect(formatEta(3660)).toBe('1h 1m');
    expect(formatEta(7200)).toBe('2h');
  });
});

describe('formatDuration', () => {
  it('converts milliseconds to seconds for formatting', () => {
    expect(formatDuration(1000)).toBe('1s');
    expect(formatDuration(60000)).toBe('1m');
    expect(formatDuration(90000)).toBe('1m 30s');
  });
});

describe('truncateFilename', () => {
  it('returns the original name if short enough', () => {
    expect(truncateFilename('short.txt', 30)).toBe('short.txt');
  });

  it('truncates long names preserving extension', () => {
    const result = truncateFilename('very-long-filename-that-exceeds-limit.txt', 20);
    expect(result.endsWith('.txt')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result).toContain('…');
  });

  it('truncates names without extension', () => {
    const result = truncateFilename('averylongfilenamewithoutext', 10);
    expect(result.length).toBeLessThanOrEqual(10);
    expect(result).toContain('…');
  });

  it('uses default max length of 30', () => {
    const name = 'a'.repeat(40) + '.txt';
    const result = truncateFilename(name);
    expect(result.length).toBeLessThanOrEqual(30);
  });
});

describe('getExtension', () => {
  it('returns lowercase extension without dot', () => {
    expect(getExtension('file.txt')).toBe('txt');
    expect(getExtension('photo.JPG')).toBe('jpg');
    expect(getExtension('archive.tar.gz')).toBe('gz');
  });

  it('returns empty string for no extension', () => {
    expect(getExtension('Makefile')).toBe('');
    expect(getExtension('file.')).toBe('');
  });

  it('handles hidden files (dot-files) — treats everything after the leading dot as extension', () => {
    // '.gitignore' → dotIndex=0, so returns '' per the dotIndex===0 guard
    expect(getExtension('.gitignore')).toBe('gitignore');
  });
});
