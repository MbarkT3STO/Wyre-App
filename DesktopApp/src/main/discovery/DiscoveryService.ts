/**
 * DiscoveryService.ts
 * Orchestrates device discovery: starts broadcaster + listener,
 * maintains the live device registry, evicts stale devices.
 * Emits typed events. No Electron/IPC knowledge.
 */

import { EventEmitter } from 'events';
import { networkInterfaces } from 'os';
import { UdpBroadcaster } from './UdpBroadcaster';
import { UdpListener } from './UdpListener';
import type { Device, DeviceAnnouncement, Platform } from '../../shared/models/Device';

const DEVICE_TIMEOUT_MS = 10_000;
const EVICTION_CHECK_INTERVAL_MS = 2_000;

export interface DiscoveryServiceEvents {
  devicesChanged: (devices: Device[]) => void;
  error: (err: Error) => void;
}

export declare interface DiscoveryService {
  on<K extends keyof DiscoveryServiceEvents>(event: K, listener: DiscoveryServiceEvents[K]): this;
  emit<K extends keyof DiscoveryServiceEvents>(event: K, ...args: Parameters<DiscoveryServiceEvents[K]>): boolean;
}

export class DiscoveryService extends EventEmitter {
  private broadcaster: UdpBroadcaster;
  private listener: UdpListener;
  private devices: Map<string, Device> = new Map();
  private evictionTimer: ReturnType<typeof setInterval> | null = null;
  private ownDeviceId: string;

  constructor(
    deviceId: string,
    deviceName: string,
    platform: Platform,
    transferPort: number,
    version: string,
  ) {
    super();
    this.ownDeviceId = deviceId;

    const announcement: DeviceAnnouncement = {
      id: deviceId,
      name: deviceName,
      platform,
      port: transferPort,
      version,
    };

    this.broadcaster = new UdpBroadcaster(announcement);
    this.listener = new UdpListener(deviceId);

    this.broadcaster.on('error', (err) => this.emit('error', err));
    this.listener.on('error', (err) => this.emit('error', err));

    this.listener.on('announcement', ({ announcement: ann, senderIp }) => {
      this.handleAnnouncement(ann, senderIp);
    });
  }

  start(): void {
    this.broadcaster.start();
    this.listener.start();
    this.evictionTimer = setInterval(() => this.evictStaleDevices(), EVICTION_CHECK_INTERVAL_MS);
  }

  stop(): void {
    this.broadcaster.stop();
    this.listener.stop();
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }
  }

  getDevices(): Device[] {
    return Array.from(this.devices.values()).filter(d => d.online);
  }

  updateAnnouncement(partial: { name?: string; port?: number }): void {
    this.broadcaster.updateAnnouncement(partial);
  }

  getOwnIp(): string {
    return this.detectLocalIp();
  }

  private handleAnnouncement(ann: DeviceAnnouncement, senderIp: string): void {
    // Ignore our own announcements (second line of defence after UdpListener)
    if (ann.id === this.ownDeviceId) return;

    const existing = this.devices.get(ann.id);
    const now = Date.now();

    const device: Device = {
      id: ann.id,
      name: ann.name,
      platform: ann.platform,
      ip: senderIp,
      port: ann.port,
      version: ann.version,
      lastSeen: now,
      online: true,
    };

    const wasOffline = existing ? !existing.online : true;
    const changed =
      !existing ||
      wasOffline ||
      existing.name !== device.name ||
      existing.ip !== device.ip ||
      existing.port !== device.port;

    this.devices.set(ann.id, device);

    if (changed) {
      this.emit('devicesChanged', this.getDevices());
    }
  }

  private evictStaleDevices(): void {
    const now = Date.now();
    let changed = false;

    for (const [id, device] of this.devices) {
      if (device.online && now - device.lastSeen > DEVICE_TIMEOUT_MS) {
        this.devices.set(id, { ...device, online: false });
        changed = true;
      }
    }

    // Remove fully stale devices (offline for > 60s)
    for (const [id, device] of this.devices) {
      if (!device.online && now - device.lastSeen > 60_000) {
        this.devices.delete(id);
        changed = true;
      }
    }

    if (changed) {
      this.emit('devicesChanged', this.getDevices());
    }
  }

  private detectLocalIp(): string {
    const nets = networkInterfaces();
    for (const iface of Object.values(nets)) {
      if (!iface) continue;
      for (const net of iface) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
    return '127.0.0.1';
  }
}
