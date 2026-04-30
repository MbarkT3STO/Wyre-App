/**
 * AppSettings.ts
 * Application settings model — persisted via electron-store.
 */

export type ThemePreference = 'dark' | 'light' | 'system';

export interface AppSettings {
  /** Stable device identifier (UUID) */
  deviceId: string;
  /** Display name shown to peers */
  deviceName: string;
  /** TCP port for the transfer server (0 = random assigned) */
  transferPort: number;
  /** Directory where received files are saved */
  saveDirectory: string;
  /** Theme preference */
  theme: ThemePreference;
  /** Auto-accept incoming transfers without prompting */
  autoAccept: boolean;
  /** List of device IDs that are trusted for auto-accept */
  trustedDeviceIds: string[];
  /** Seconds before auto-declining an incoming request */
  autoDeclineTimeout: number;
  /** Whether to show OS notifications on transfer complete */
  showNotifications: boolean;
  /** App version (for migration checks) */
  version: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  deviceId: '',
  deviceName: '',
  transferPort: 0,
  saveDirectory: '',
  theme: 'system',
  autoAccept: false,
  trustedDeviceIds: [],
  autoDeclineTimeout: 30,
  showNotifications: true,
  version: '1.0.0',
};
