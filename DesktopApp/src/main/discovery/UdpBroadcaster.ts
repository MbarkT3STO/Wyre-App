/**
 * UdpBroadcaster.ts
 * Sends UDP heartbeat broadcasts every 3 seconds to announce this device's presence.
 * Single responsibility: broadcast only. No discovery logic here.
 */

import { createSocket, Socket } from 'dgram';
import { networkInterfaces } from 'os';
import { EventEmitter } from 'events';
import type { DeviceAnnouncement } from '../../shared/models/Device';

const BROADCAST_PORT = 49152;
const BROADCAST_INTERVAL_MS = 3000;

/**
 * Derive the subnet-directed broadcast address from the first non-internal
 * IPv4 interface (e.g. 192.168.1.255).  This works on macOS in production
 * where 255.255.255.255 (limited broadcast) is blocked by the OS/firewall.
 * Falls back to 255.255.255.255 only when no suitable interface is found.
 */
function getDirectedBroadcastAddress(): string {
  const nets = networkInterfaces();
  for (const iface of Object.values(nets)) {
    if (!iface) continue;
    for (const net of iface) {
      if (net.family !== 'IPv4' || net.internal) continue;
      // Convert address + netmask to broadcast address
      const addrParts = net.address.split('.').map(Number);
      const maskParts = net.netmask.split('.').map(Number);
      const broadcast = addrParts
        .map((octet, i) => (octet & maskParts[i]) | (~maskParts[i] & 0xff))
        .join('.');
      return broadcast;
    }
  }
  return '255.255.255.255';
}

export interface UdpBroadcasterEvents {
  error: (err: Error) => void;
}

export declare interface UdpBroadcaster {
  on<K extends keyof UdpBroadcasterEvents>(event: K, listener: UdpBroadcasterEvents[K]): this;
  emit<K extends keyof UdpBroadcasterEvents>(event: K, ...args: Parameters<UdpBroadcasterEvents[K]>): boolean;
}

export class UdpBroadcaster extends EventEmitter {
  private socket: Socket | null = null;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private announcement: DeviceAnnouncement;
  private broadcastAddress: string;

  constructor(announcement: DeviceAnnouncement) {
    super();
    this.announcement = announcement;
    this.broadcastAddress = getDirectedBroadcastAddress();
  }

  updateAnnouncement(partial: Partial<DeviceAnnouncement>): void {
    this.announcement = { ...this.announcement, ...partial };
  }

  start(): void {
    if (this.socket) return;

    // Recalculate broadcast address at start time in case network changed
    this.broadcastAddress = getDirectedBroadcastAddress();

    this.socket = createSocket({ type: 'udp4', reuseAddr: true });

    this.socket.on('error', (err) => {
      this.emit('error', err);
    });

    this.socket.bind(() => {
      try {
        this.socket?.setBroadcast(true);
        this.sendBroadcast();
        this.intervalHandle = setInterval(() => this.sendBroadcast(), BROADCAST_INTERVAL_MS);
      } catch (err) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // Already closed
      }
      this.socket = null;
    }
  }

  private sendBroadcast(): void {
    if (!this.socket) return;

    const message = Buffer.from(JSON.stringify({
      ...this.announcement,
      encryptionSupported: true,
    }));
    this.socket.send(message, 0, message.length, BROADCAST_PORT, this.broadcastAddress, (err) => {
      if (err) this.emit('error', err);
    });
  }
}
