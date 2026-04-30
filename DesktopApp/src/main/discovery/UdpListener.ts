/**
 * UdpListener.ts
 * Listens on the UDP broadcast port for peer announcements.
 * Emits typed 'announcement' events with the sender's IP and payload.
 * Single responsibility: receive and parse UDP packets only.
 */

import { createSocket, Socket } from 'dgram';
import { EventEmitter } from 'events';
import type { DeviceAnnouncement } from '../../shared/models/Device';

const BROADCAST_PORT = 49152;

export interface AnnouncementEvent {
  announcement: DeviceAnnouncement;
  senderIp: string;
}

export interface UdpListenerEvents {
  announcement: (event: AnnouncementEvent) => void;
  error: (err: Error) => void;
}

export declare interface UdpListener {
  on<K extends keyof UdpListenerEvents>(event: K, listener: UdpListenerEvents[K]): this;
  emit<K extends keyof UdpListenerEvents>(event: K, ...args: Parameters<UdpListenerEvents[K]>): boolean;
}

export class UdpListener extends EventEmitter {
  private socket: Socket | null = null;
  private ownDeviceId: string;

  constructor(ownDeviceId: string) {
    super();
    this.ownDeviceId = ownDeviceId;
  }

  start(): void {
    if (this.socket) return;

    this.socket = createSocket({ type: 'udp4', reuseAddr: true });

    this.socket.on('error', (err) => {
      this.emit('error', err);
    });

    this.socket.on('message', (msg, rinfo) => {
      this.handleMessage(msg, rinfo.address);
    });

    this.socket.bind(BROADCAST_PORT, () => {
      try {
        this.socket?.setBroadcast(true);
      } catch (err) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  stop(): void {
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // Already closed
      }
      this.socket = null;
    }
  }

  private handleMessage(msg: Buffer, senderIp: string): void {
    try {
      const data: unknown = JSON.parse(msg.toString('utf8'));
      if (!this.isValidAnnouncement(data)) return;

      // Ignore our own broadcasts
      if (data.id === this.ownDeviceId) return;

      this.emit('announcement', { announcement: data, senderIp });
    } catch {
      // Malformed packet — ignore silently
    }
  }

  private isValidAnnouncement(data: unknown): data is DeviceAnnouncement {
    if (typeof data !== 'object' || data === null) return false;
    const d = data as Record<string, unknown>;
    return (
      typeof d['id'] === 'string' &&
      typeof d['name'] === 'string' &&
      typeof d['platform'] === 'string' &&
      typeof d['port'] === 'number' &&
      typeof d['version'] === 'string'
    );
  }
}
