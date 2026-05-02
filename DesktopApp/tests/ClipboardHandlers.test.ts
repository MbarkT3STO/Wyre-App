/**
 * ClipboardHandlers.test.ts
 * Unit tests for clipboard payload validation and the CLIPBOARD_SEND handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { validateClipboardPayload } from '../src/main/ipc/handlers/ClipboardHandlers';

// ─── validateClipboardPayload ─────────────────────────────────────────────────

describe('validateClipboardPayload', () => {
  it('throws on null input', () => {
    expect(() => validateClipboardPayload(null)).toThrow('Invalid clipboard payload');
  });

  it('throws on non-object input', () => {
    expect(() => validateClipboardPayload('string')).toThrow('Invalid clipboard payload');
    expect(() => validateClipboardPayload(42)).toThrow('Invalid clipboard payload');
    expect(() => validateClipboardPayload(undefined)).toThrow('Invalid clipboard payload');
  });

  it('throws when deviceId is missing', () => {
    expect(() => validateClipboardPayload({ text: 'hello' })).toThrow('Invalid clipboard payload');
  });

  it('throws when deviceId is not a string', () => {
    expect(() => validateClipboardPayload({ deviceId: 123, text: 'hello' })).toThrow('Invalid clipboard payload');
  });

  it('throws when text is missing', () => {
    expect(() => validateClipboardPayload({ deviceId: 'dev-1' })).toThrow('Invalid clipboard payload');
  });

  it('throws when text is not a string', () => {
    expect(() => validateClipboardPayload({ deviceId: 'dev-1', text: true })).toThrow('Invalid clipboard payload');
  });

  it('returns the payload unchanged for a valid input', () => {
    const payload = { deviceId: 'dev-1', text: 'hello world' };
    const result = validateClipboardPayload(payload);
    expect(result).toEqual(payload);
    expect(result.deviceId).toBe('dev-1');
    expect(result.text).toBe('hello world');
  });
});

// ─── CLIPBOARD_SEND handler — truncation behaviour ────────────────────────────

// We test the handler by registering it against a mock ipcMain and invoking
// the registered callback directly, avoiding real TCP connections.

const CLIPBOARD_MAX_CHARS = 5000;

// Minimal mock of the net.connect socket
function makeMockSocket() {
  const emitter = new EventEmitter() as EventEmitter & {
    setNoDelay: ReturnType<typeof vi.fn>;
    setTimeout: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
  emitter.setNoDelay = vi.fn();
  emitter.setTimeout = vi.fn();
  emitter.write = vi.fn();
  emitter.end = vi.fn();
  emitter.destroy = vi.fn();
  return emitter;
}

vi.mock('net', () => {
  const socket = makeMockSocket();
  return {
    connect: vi.fn((_opts: unknown, cb: () => void) => {
      // Simulate immediate connection
      setTimeout(cb, 0);
      return socket;
    }),
    _socket: socket,
  };
});

import * as net from 'net';

describe('CLIPBOARD_SEND handler — text truncation', () => {
  let ipcHandlers: Map<string, (_event: unknown, payload: unknown) => Promise<void>>;
  let mockDiscovery: { getDevices: ReturnType<typeof vi.fn> };
  let mockSettings: { get: ReturnType<typeof vi.fn> };
  let mockIpcMain: { handle: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    ipcHandlers = new Map();

    mockIpcMain = {
      handle: vi.fn((channel: string, handler: (_event: unknown, payload: unknown) => Promise<void>) => {
        ipcHandlers.set(channel, handler);
      }),
    };

    mockDiscovery = {
      getDevices: vi.fn().mockReturnValue([
        { id: 'dev-1', ip: '192.168.1.10', port: 5000, name: 'Peer', platform: 'linux', version: '1.0.0', lastSeen: Date.now(), online: true },
      ]),
    };

    mockSettings = {
      get: vi.fn().mockReturnValue({ deviceId: 'my-id', deviceName: 'MyDevice', saveDirectory: '/tmp', theme: 'system', launchAtLogin: false }),
    };

    // Re-import to trigger handler registration with fresh mocks
    const { registerClipboardHandlers } = await import('../src/main/ipc/handlers/ClipboardHandlers');
    registerClipboardHandlers(
      mockIpcMain as unknown as import('electron').IpcMain,
      mockDiscovery as unknown as import('../src/main/discovery/DiscoveryService').DiscoveryService,
      mockSettings as unknown as import('../src/main/store/SettingsStore').SettingsStore,
    );
  });

  it('text over 5000 chars is truncated in the frame sent to the peer', async () => {
    const longText = 'x'.repeat(CLIPBOARD_MAX_CHARS + 100);
    const handler = ipcHandlers.get('clipboard:send');
    expect(handler).toBeDefined();

    // Capture what gets written to the socket
    const writtenFrames: string[] = [];
    const mockSocket = (net as unknown as { _socket: ReturnType<typeof makeMockSocket> })._socket;
    mockSocket.write = vi.fn((data: string | Buffer) => {
      writtenFrames.push(typeof data === 'string' ? data : data.toString('utf8'));
      return true;
    });

    await handler!({}, { deviceId: 'dev-1', text: longText });

    expect(writtenFrames.length).toBeGreaterThan(0);
    const frame = JSON.parse(writtenFrames[0]!.trim()) as { text: string; truncated: boolean };
    expect(frame.text.length).toBe(CLIPBOARD_MAX_CHARS);
    expect(frame.truncated).toBe(true);
  });

  it('text within 5000 chars passes through unchanged with truncated: false', async () => {
    const shortText = 'hello world';
    const handler = ipcHandlers.get('clipboard:send');
    expect(handler).toBeDefined();

    const writtenFrames: string[] = [];
    const mockSocket = (net as unknown as { _socket: ReturnType<typeof makeMockSocket> })._socket;
    mockSocket.write = vi.fn((data: string | Buffer) => {
      writtenFrames.push(typeof data === 'string' ? data : data.toString('utf8'));
      return true;
    });

    await handler!({}, { deviceId: 'dev-1', text: shortText });

    expect(writtenFrames.length).toBeGreaterThan(0);
    const frame = JSON.parse(writtenFrames[0]!.trim()) as { text: string; truncated: boolean };
    expect(frame.text).toBe(shortText);
    expect(frame.truncated).toBe(false);
  });

  it('throws when the target device is not found', async () => {
    mockDiscovery.getDevices.mockReturnValue([]);
    const handler = ipcHandlers.get('clipboard:send');
    expect(handler).toBeDefined();

    await expect(handler!({}, { deviceId: 'unknown-dev', text: 'hi' })).rejects.toThrow('not found or offline');
  });
});
