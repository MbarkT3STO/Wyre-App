/**
 * TransferClient.test.ts
 * Unit tests for TransferClient — TCP send logic.
 * Uses mock net.connect to avoid real network I/O.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// ─── Mock net module ──────────────────────────────────────────────────────────

class MockSocket extends EventEmitter {
  write = vi.fn().mockReturnValue(true);
  end = vi.fn();
  destroy = vi.fn();
  pause = vi.fn();
  resume = vi.fn();
}

let mockSocket: MockSocket;

vi.mock('net', () => ({
  connect: vi.fn((_opts: unknown, cb: () => void) => {
    mockSocket = new MockSocket();
    // Call connect callback asynchronously
    setTimeout(cb, 0);
    return mockSocket;
  }),
}));

vi.mock('../src/main/transfer/FileChunker', () => ({
  FileChunker: {
    createReadStream: vi.fn(() => {
      const stream = new EventEmitter() as EventEmitter & { destroy: () => void };
      stream.destroy = vi.fn();
      // Emit data and end asynchronously
      setTimeout(() => {
        stream.emit('data', Buffer.from('chunk1'));
        stream.emit('data', Buffer.from('chunk2'));
        stream.emit('end');
      }, 10);
      return stream;
    }),
  },
}));

import { TransferClient } from '../src/main/transfer/TransferClient';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TransferClient', () => {
  let client: TransferClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new TransferClient();
  });

  it('sendFile returns a transferId string', () => {
    const id = client.sendFile({
      filePath: '/tmp/test.txt',
      fileName: 'test.txt',
      fileSize: 1024,
      checksum: 'abc123',
      peerIp: '192.168.1.10',
      peerPort: 5000,
      senderDeviceId: 'my-id',
      senderName: 'MyDevice',
    });

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('sendFile returns unique IDs for each call', () => {
    const id1 = client.sendFile({
      filePath: '/tmp/a.txt',
      fileName: 'a.txt',
      fileSize: 100,
      checksum: 'cs1',
      peerIp: '192.168.1.10',
      peerPort: 5000,
      senderDeviceId: 'my-id',
      senderName: 'MyDevice',
    });

    const id2 = client.sendFile({
      filePath: '/tmp/b.txt',
      fileName: 'b.txt',
      fileSize: 200,
      checksum: 'cs2',
      peerIp: '192.168.1.10',
      peerPort: 5000,
      senderDeviceId: 'my-id',
      senderName: 'MyDevice',
    });

    expect(id1).not.toBe(id2);
  });

  it('emits declined when receiver sends accepted: false', async () => {
    const declinedListener = vi.fn();
    client.on('declined', declinedListener);

    const id = client.sendFile({
      filePath: '/tmp/test.txt',
      fileName: 'test.txt',
      fileSize: 1024,
      checksum: 'abc123',
      peerIp: '192.168.1.10',
      peerPort: 5000,
      senderDeviceId: 'my-id',
      senderName: 'MyDevice',
    });

    // Wait for connect callback
    await new Promise(r => setTimeout(r, 5));

    // Simulate receiver declining
    mockSocket.emit('data', Buffer.from(JSON.stringify({ accepted: false }) + '\n'));

    await new Promise(r => setTimeout(r, 5));
    expect(declinedListener).toHaveBeenCalledWith(id);
  });

  it('emits error when socket errors before connect', async () => {
    const errorListener = vi.fn();
    client.on('error', errorListener);

    const id = client.sendFile({
      filePath: '/tmp/test.txt',
      fileName: 'test.txt',
      fileSize: 1024,
      checksum: 'abc123',
      peerIp: '192.168.1.10',
      peerPort: 5000,
      senderDeviceId: 'my-id',
      senderName: 'MyDevice',
    });

    await new Promise(r => setTimeout(r, 5));
    mockSocket.emit('error', new Error('ECONNREFUSED'));

    await new Promise(r => setTimeout(r, 5));
    expect(errorListener).toHaveBeenCalledWith(id, expect.any(Error));
  });

  it('cancelTransfer destroys the socket', async () => {
    const id = client.sendFile({
      filePath: '/tmp/test.txt',
      fileName: 'test.txt',
      fileSize: 1024,
      checksum: 'abc123',
      peerIp: '192.168.1.10',
      peerPort: 5000,
      senderDeviceId: 'my-id',
      senderName: 'MyDevice',
    });

    await new Promise(r => setTimeout(r, 5));
    client.cancelTransfer(id);

    expect(mockSocket.destroy).toHaveBeenCalled();
  });

  it('emits cancelled when cancelTransfer is called', async () => {
    const cancelledListener = vi.fn();
    client.on('cancelled', cancelledListener);

    const id = client.sendFile({
      filePath: '/tmp/test.txt',
      fileName: 'test.txt',
      fileSize: 1024,
      checksum: 'abc123',
      peerIp: '192.168.1.10',
      peerPort: 5000,
      senderDeviceId: 'my-id',
      senderName: 'MyDevice',
    });

    await new Promise(r => setTimeout(r, 5));
    client.cancelTransfer(id);

    expect(cancelledListener).toHaveBeenCalledWith(id);
  });
});
