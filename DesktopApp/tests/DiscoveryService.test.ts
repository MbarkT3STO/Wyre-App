/**
 * DiscoveryService.test.ts
 * Unit tests for DiscoveryService device registry and eviction logic.
 * Mocks UdpBroadcaster and UdpListener to avoid real network I/O.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../src/main/discovery/UdpBroadcaster', () => ({
  UdpBroadcaster: class MockBroadcaster extends EventEmitter {
    start = vi.fn();
    stop = vi.fn();
    updateAnnouncement = vi.fn();
  },
}));

vi.mock('../src/main/discovery/UdpListener', () => ({
  UdpListener: class MockListener extends EventEmitter {
    start = vi.fn();
    stop = vi.fn();
  },
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { DiscoveryService } from '../src/main/discovery/DiscoveryService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getListener(service: DiscoveryService): EventEmitter {
  // Access the private listener via the service's internal state
  return (service as unknown as { listener: EventEmitter }).listener;
}

function makeAnnouncement(overrides: Partial<{
  id: string; name: string; platform: string; port: number; version: string;
}> = {}) {
  return {
    id: 'peer-1',
    name: 'PeerDevice',
    platform: 'linux' as const,
    port: 5000,
    version: '1.0.0',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DiscoveryService', () => {
  let service: DiscoveryService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new DiscoveryService('own-id', 'MyDevice', 'linux', 4000, '1.0.0');
    service.start();
  });

  afterEach(() => {
    service.stop();
    vi.useRealTimers();
  });

  it('starts with no devices', () => {
    expect(service.getDevices()).toHaveLength(0);
  });

  it('adds a device when an announcement is received', () => {
    const listener = getListener(service);
    listener.emit('announcement', {
      announcement: makeAnnouncement(),
      senderIp: '192.168.1.10',
    });

    const devices = service.getDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0]?.id).toBe('peer-1');
    expect(devices[0]?.name).toBe('PeerDevice');
    expect(devices[0]?.ip).toBe('192.168.1.10');
    expect(devices[0]?.online).toBe(true);
  });

  it('ignores own device announcements', () => {
    const listener = getListener(service);
    listener.emit('announcement', {
      announcement: makeAnnouncement({ id: 'own-id' }),
      senderIp: '192.168.1.1',
    });

    expect(service.getDevices()).toHaveLength(0);
  });

  it('updates existing device on repeated announcement', () => {
    const listener = getListener(service);
    listener.emit('announcement', {
      announcement: makeAnnouncement({ name: 'OldName' }),
      senderIp: '192.168.1.10',
    });
    listener.emit('announcement', {
      announcement: makeAnnouncement({ name: 'NewName' }),
      senderIp: '192.168.1.10',
    });

    const devices = service.getDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0]?.name).toBe('NewName');
  });

  it('emits devicesChanged when a new device appears', () => {
    const listener = getListener(service);
    const onChange = vi.fn();
    service.on('devicesChanged', onChange);

    listener.emit('announcement', {
      announcement: makeAnnouncement(),
      senderIp: '192.168.1.10',
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'peer-1' }),
    ]));
  });

  it('marks device offline after 10 seconds without heartbeat', () => {
    const listener = getListener(service);
    listener.emit('announcement', {
      announcement: makeAnnouncement(),
      senderIp: '192.168.1.10',
    });

    expect(service.getDevices()).toHaveLength(1);

    // Advance time past the 10s timeout
    vi.advanceTimersByTime(12_000);

    expect(service.getDevices()).toHaveLength(0); // offline devices filtered out
  });

  it('keeps device online if heartbeat arrives before timeout', () => {
    const listener = getListener(service);
    listener.emit('announcement', {
      announcement: makeAnnouncement(),
      senderIp: '192.168.1.10',
    });

    // Advance 8 seconds — still within timeout
    vi.advanceTimersByTime(8_000);

    // Send another heartbeat
    listener.emit('announcement', {
      announcement: makeAnnouncement(),
      senderIp: '192.168.1.10',
    });

    // Advance another 8 seconds — total 16s but last heartbeat was at 8s
    vi.advanceTimersByTime(8_000);

    expect(service.getDevices()).toHaveLength(1);
  });

  it('handles multiple devices independently', () => {
    const listener = getListener(service);
    listener.emit('announcement', {
      announcement: makeAnnouncement({ id: 'peer-1', name: 'Device1' }),
      senderIp: '192.168.1.10',
    });
    listener.emit('announcement', {
      announcement: makeAnnouncement({ id: 'peer-2', name: 'Device2' }),
      senderIp: '192.168.1.11',
    });

    expect(service.getDevices()).toHaveLength(2);
  });

  it('emits devicesChanged when device goes offline', () => {
    const listener = getListener(service);
    const onChange = vi.fn();

    listener.emit('announcement', {
      announcement: makeAnnouncement(),
      senderIp: '192.168.1.10',
    });

    service.on('devicesChanged', onChange);
    vi.advanceTimersByTime(12_000);

    expect(onChange).toHaveBeenCalled();
  });
});
