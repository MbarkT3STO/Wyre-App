/**
 * AppSettings.ts
 * Application settings model — persisted via Capacitor Preferences.
 */

export type ThemePreference = 'dark' | 'light' | 'system';
export type UiScale = 0.85 | 0.9 | 1.0 | 1.1 | 1.2 | 1.35;

export interface AppSettings {
  deviceId: string;
  deviceName: string;
  transferPort: number;
  saveDirectory: string;
  theme: ThemePreference;
  autoAccept: boolean;
  trustedDeviceIds: string[];
  autoDeclineTimeout: number;
  showNotifications: boolean;
  backgroundService: boolean;
  uiScale: UiScale;
  version: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  deviceId: '',
  deviceName: '',
  transferPort: 49200,
  saveDirectory: '',
  theme: 'system',
  autoAccept: false,
  trustedDeviceIds: [],
  autoDeclineTimeout: 30,
  showNotifications: true,
  backgroundService: false,
  uiScale: 1.0,
  version: '1.0.0',
};
