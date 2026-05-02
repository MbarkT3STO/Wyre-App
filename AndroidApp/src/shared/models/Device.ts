/**
 * Device.ts
 * Represents a discovered peer device on the local network.
 */

export type Platform = 'windows' | 'macos' | 'linux' | 'android' | 'unknown';

export interface Device {
  /** Stable UUID persisted across restarts */
  id: string;
  /** Human-readable hostname or user-set name */
  name: string;
  /** Operating system platform */
  platform: Platform;
  /** IP address on the local network */
  ip: string;
  /** TCP port the device's TransferServer is listening on */
  port: number;
  /** App version string */
  version: string;
  /** Unix timestamp of last heartbeat received */
  lastSeen: number;
  /** Whether the device is currently reachable */
  online: boolean;
  /** Whether the device supports AES-256-GCM encrypted transfers */
  encryptionSupported?: boolean;
}

/** Payload broadcast over UDP for device discovery */
export interface DeviceAnnouncement {
  id: string;
  name: string;
  platform: Platform;
  port: number;
  version: string;
  encryptionSupported?: boolean;
}
