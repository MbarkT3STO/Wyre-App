/**
 * SettingsStore.ts
 * Typed wrapper around electron-store for persisting AppSettings.
 * Single responsibility: read/write settings with defaults and migration.
 */

import Store from 'electron-store';
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { app } from 'electron';
import { EventEmitter } from 'events';
import type { AppSettings } from '../../shared/models/AppSettings';
import { DEFAULT_SETTINGS } from '../../shared/models/AppSettings';

type StoreSchema = AppSettings;

// Fix 5: Typed event map for SettingsStore
interface SettingsStoreEvents {
  changed: (updated: AppSettings) => void;
}

export class SettingsStore extends EventEmitter {
  private readonly store: Store<StoreSchema>;

  constructor() {
    super();
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

  // Fix 5: Typed overloads so callers get the correct listener signature
  on<K extends keyof SettingsStoreEvents>(event: K, listener: SettingsStoreEvents[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  emit<K extends keyof SettingsStoreEvents>(event: K, ...args: Parameters<SettingsStoreEvents[K]>): boolean {
    return super.emit(event, ...args);
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
      uiScale: this.store.get('uiScale') ?? 1.0,
      version: this.store.get('version'),
    };
  }

  set(partial: Partial<AppSettings>): void {
    for (const [key, value] of Object.entries(partial) as [keyof AppSettings, AppSettings[keyof AppSettings]][]) {
      if (value !== undefined) {
        this.store.set(key, value as AppSettings[typeof key]);
      }
    }
    // Fix 5: Emit typed 'changed' event after persisting so listeners
    // (e.g. AppBootstrapper) can react without coupling to raw IPC channels.
    this.emit('changed', this.get());
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
