/**
 * SettingsStore.ts
 * Typed wrapper around electron-store for persisting AppSettings.
 * Single responsibility: read/write settings with defaults and migration.
 */

import Store from 'electron-store';
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { app } from 'electron';
import type { AppSettings } from '../../shared/models/AppSettings';
import { DEFAULT_SETTINGS } from '../../shared/models/AppSettings';

type StoreSchema = AppSettings;

export class SettingsStore {
  private readonly store: Store<StoreSchema>;

  constructor() {
    this.store = new Store<StoreSchema>({
      name: 'settings',
      defaults: {
        ...DEFAULT_SETTINGS,
        deviceId: randomUUID(),
        deviceName: hostname(),
        saveDirectory: app.getPath('downloads'),
        version: app.getVersion(),
      },
    });

    this.ensureDefaults();
  }

  private ensureDefaults(): void {
    // Ensure deviceId is always set
    if (!this.store.get('deviceId')) {
      this.store.set('deviceId', randomUUID());
    }
    // Ensure deviceName is always set
    if (!this.store.get('deviceName')) {
      this.store.set('deviceName', hostname());
    }
    // Ensure saveDirectory is always set
    if (!this.store.get('saveDirectory')) {
      this.store.set('saveDirectory', app.getPath('downloads'));
    }
  }

  get(): AppSettings {
    return {
      deviceId: this.store.get('deviceId'),
      deviceName: this.store.get('deviceName'),
      transferPort: this.store.get('transferPort'),
      saveDirectory: this.store.get('saveDirectory'),
      theme: this.store.get('theme'),
      autoAccept: this.store.get('autoAccept'),
      trustedDeviceIds: this.store.get('trustedDeviceIds'),
      autoDeclineTimeout: this.store.get('autoDeclineTimeout'),
      showNotifications: this.store.get('showNotifications'),
      version: this.store.get('version'),
    };
  }

  set(partial: Partial<AppSettings>): void {
    for (const [key, value] of Object.entries(partial) as [keyof AppSettings, AppSettings[keyof AppSettings]][]) {
      if (value !== undefined) {
        this.store.set(key, value as AppSettings[typeof key]);
      }
    }
  }

  getDeviceId(): string {
    return this.store.get('deviceId');
  }

  getDeviceName(): string {
    return this.store.get('deviceName');
  }

  getTransferPort(): number {
    return this.store.get('transferPort');
  }

  setTransferPort(port: number): void {
    this.store.set('transferPort', port);
  }

  getSaveDirectory(): string {
    return this.store.get('saveDirectory');
  }

  getAutoDeclineTimeout(): number {
    return this.store.get('autoDeclineTimeout');
  }

  getAutoAccept(): boolean {
    return this.store.get('autoAccept');
  }

  getTrustedDeviceIds(): string[] {
    return this.store.get('trustedDeviceIds');
  }
}
