/**
 * UdpBroadcaster.ts
 * Sends UDP heartbeat broadcasts every 3 seconds to announce this device's presence.
 * Single responsibility: broadcast only. No discovery logic here.
 */

import { createSocket, Socket } from 'dgram';
import { EventEmitter } from 'events';
import type { DeviceAnnouncement } from '../../shared/models/Device';

const BROADCAST_PORT = 49152;
const BROADCAST_INTERVAL_MS = 3000;
const BROADCAST_ADDRESS = '255.255.255.255';

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

  constructor(announcement: DeviceAnnouncement) {
    super();
    this.announcement = announcement;
  }

  updateAnnouncement(partial: Partial<DeviceAnnouncement>): void {
    this.announcement = { ...this.announcement, ...partial };
  }

  start(): void {
    if (this.socket) return;

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

    const message = Buffer.from(JSON.stringify(this.announcement));
    this.socket.send(message, 0, message.length, BROADCAST_PORT, BROADCAST_ADDRESS, (err) => {
      if (err) this.emit('error', err);
    });
  }
}
