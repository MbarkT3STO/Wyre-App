/**
 * SettingsView.ts — Android version.
 * Removes desktop-only features: window controls, save directory browser,
 * port config (Android uses a fixed port), logs modal.
 * Adds: Android-specific save location info.
 */

import { Component } from '../components/base/Component';
import { AppBridge } from '../../bridge/AppBridge';
import { StateManager } from '../core/StateManager';
import type { AppSettings } from '../../shared/models/AppSettings';
import type { ToastContainer } from '../components/ToastContainer';
import { validateDeviceName, validateTimeout } from '../../shared/utils/validators';

// Extended type that includes the Android-only backgroundService field
type AppSettingsWithBackground = AppSettings & { backgroundService?: boolean };

const ICONS = {
  identity:      `<i class="fa-solid fa-user"></i>`,
  incoming:      `<i class="fa-solid fa-inbox"></i>`,
  appearance:    `<i class="fa-solid fa-palette"></i>`,
  notifications: `<i class="fa-solid fa-bell"></i>`,
  background:    `<i class="fa-solid fa-moon"></i>`,
  data:          `<i class="fa-solid fa-trash-can"></i>`,
  trusted:       `<i class="fa-solid fa-shield-halved"></i>`,
};

export class SettingsView extends Component {
  private toasts: ToastContainer;
  private settings: AppSettings | null = null;

  constructor(toasts: ToastContainer) {
    super();
    this.toasts = toasts;
  }

  render(): HTMLElement {
    const view = this.el('div', 'view settings-view');
    const settings = this.settings ?? StateManager.get('settings');

    view.innerHTML = `
      <div class="settings-view__scroll">
        <div class="settings-view__content">
          <div class="view-page-title">
            <h1 class="view-page-title__heading">Settings</h1>
            <p class="view-page-title__sub">Manage your device preferences</p>
          </div>
          ${settings ? this.renderForm(settings) : this.renderLoading()}
        </div>
      </div>
    `;

    return view;
  }

  private renderLoading(): string {
    return `<div class="settings-loading"><div class="settings-loading__spinner"></div><span>Loading settings…</span></div>`;
  }

  private renderForm(s: AppSettings): string {
    return `
      <!-- ── Security (read-only, reactive) ── -->
      <div class="sg" id="security-section">
        <div class="sg__header">
          <div class="sg__icon sg__icon--green" id="security-icon-wrap">
            <i class="fa-solid fa-lock" id="security-icon"></i>
          </div>
          <div class="sg__meta">
            <div class="sg__title">Security</div>
            <div class="sg__desc" id="security-desc">Encryption status for the selected peer</div>
          </div>
        </div>
        <div class="sg__body">
          <div class="sg__row">
            <div class="sg__row-info">
              <span class="sg__label" id="security-label">No peer selected</span>
              <span class="sg__hint" id="security-hint">Select a device to see its encryption capability</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Device Identity ── -->
      <div class="sg">
        <div class="sg__header">
          <div class="sg__icon sg__icon--accent">${ICONS.identity}</div>
          <div class="sg__meta">
            <div class="sg__title">Device Identity</div>
            <div class="sg__desc">How you appear to other devices on the network</div>
          </div>
        </div>
        <div class="sg__body">
          <div class="sg__row">
            <div class="sg__row-info">
              <label class="sg__label" for="device-name">Device Name</label>
              <span class="sg__hint">Visible to nearby devices</span>
            </div>
            <div class="sg__row-control sg__row-control--wide">
              <input class="sg__input" id="device-name" type="text"
                value="${escapeHtml(s.deviceName)}" maxlength="64"
                autocomplete="off" spellcheck="false" placeholder="My Android"/>
              <button class="btn btn--primary btn--sm" id="save-name-btn">Save</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Incoming Requests ── -->
      <div class="sg">
        <div class="sg__header">
          <div class="sg__icon sg__icon--green">${ICONS.incoming}</div>
          <div class="sg__meta">
            <div class="sg__title">Incoming Requests</div>
            <div class="sg__desc">Control how incoming file transfers are handled</div>
          </div>
        </div>
        <div class="sg__body">
          <div class="sg__row sg__row--toggle">
            <div class="sg__row-info">
              <label class="sg__label" for="auto-accept">Auto-Accept</label>
              <span class="sg__hint">Accept all incoming transfers without prompting</span>
            </div>
            <label class="toggle">
              <input class="toggle__input" id="auto-accept" type="checkbox" ${s.autoAccept ? 'checked' : ''}/>
              <span class="toggle__track"><span class="toggle__thumb"></span></span>
            </label>
          </div>
          <div class="sg__divider"></div>
          <div class="sg__row sg__row--column">
            <div class="sg__row-info">
              <label class="sg__label" for="decline-timeout">
                Auto-Decline Timeout
                <span class="sg__badge" id="timeout-value">${s.autoDeclineTimeout}s</span>
              </label>
              <span class="sg__hint">Auto-decline if not responded to within this time</span>
            </div>
            <div class="sg__slider-wrap">
              <input class="sg__range" id="decline-timeout" type="range"
                min="10" max="120" step="5" value="${s.autoDeclineTimeout}"/>
              <div class="sg__range-labels"><span>10s</span><span>120s</span></div>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Trusted Devices ── -->
      <div class="sg" id="trusted-devices-section" ${s.autoAccept ? '' : 'style="display:none"'}>
        <div class="sg__header">
          <div class="sg__icon sg__icon--green">${ICONS.trusted}</div>
          <div class="sg__meta">
            <div class="sg__title">Trusted Devices</div>
            <div class="sg__desc">Devices that are auto-accepted without prompting</div>
          </div>
        </div>
        <div class="sg__body">
          <div class="sg__row sg__row--column">
            <div class="sg__row-info">
              <span class="sg__label">Trusted Device IDs</span>
              <span class="sg__hint">Only these devices will be auto-accepted</span>
            </div>
            <div class="settings-view__trusted-list" id="trusted-list">
              ${this.renderTrustedList(s.trustedDeviceIds)}
            </div>
          </div>
          <div class="sg__divider"></div>
          <div class="sg__row">
            <div class="sg__row-info">
              <span class="sg__label">Add Trusted Device</span>
              <span class="sg__hint">Select an online device to trust</span>
            </div>
            <div class="sg__row-control sg__row-control--wide">
              <select class="sg__input sg__input--select" id="trust-device-select" aria-label="Select a device to trust">
                <option value="">Select a device…</option>
                ${this.renderDeviceOptions(s.trustedDeviceIds)}
              </select>
              <button class="btn btn--primary btn--sm" id="trust-device-btn">
                <i class="fa-solid fa-shield-halved btn__icon"></i>
                Trust
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Appearance ── -->
      <div class="sg">
        <div class="sg__header">
          <div class="sg__icon sg__icon--purple">${ICONS.appearance}</div>
          <div class="sg__meta">
            <div class="sg__title">Appearance</div>
            <div class="sg__desc">Customize the look and feel of Wyre</div>
          </div>
        </div>
        <div class="sg__body">
          <div class="sg__row sg__row--column">
            <div class="sg__row-info">
              <span class="sg__label">Theme</span>
              <span class="sg__hint">Choose your preferred color scheme</span>
            </div>
            <div class="sg__theme-group" role="radiogroup" aria-label="Theme">
              <label class="sg__theme-option${s.theme === 'dark' ? ' sg__theme-option--active' : ''}">
                <input type="radio" name="theme" value="dark" ${s.theme === 'dark' ? 'checked' : ''}/>
                <span class="sg__theme-preview sg__theme-preview--dark"></span>
                <span class="sg__theme-label">Dark</span>
              </label>
              <label class="sg__theme-option${s.theme === 'light' ? ' sg__theme-option--active' : ''}">
                <input type="radio" name="theme" value="light" ${s.theme === 'light' ? 'checked' : ''}/>
                <span class="sg__theme-preview sg__theme-preview--light"></span>
                <span class="sg__theme-label">Light</span>
              </label>
              <label class="sg__theme-option${s.theme === 'system' ? ' sg__theme-option--active' : ''}">
                <input type="radio" name="theme" value="system" ${s.theme === 'system' ? 'checked' : ''}/>
                <span class="sg__theme-preview sg__theme-preview--system"></span>
                <span class="sg__theme-label">System</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Notifications ── -->
      <div class="sg">
        <div class="sg__header">
          <div class="sg__icon sg__icon--yellow">${ICONS.notifications}</div>
          <div class="sg__meta">
            <div class="sg__title">Notifications</div>
            <div class="sg__desc">System alerts for transfer events</div>
          </div>
        </div>
        <div class="sg__body">
          <div class="sg__row sg__row--toggle">
            <div class="sg__row-info">
              <label class="sg__label" for="show-notifications">System Notifications</label>
              <span class="sg__hint">Show notifications when transfers complete or fail</span>
            </div>
            <label class="toggle">
              <input class="toggle__input" id="show-notifications" type="checkbox" ${s.showNotifications ? 'checked' : ''}/>
              <span class="toggle__track"><span class="toggle__thumb"></span></span>
            </label>
          </div>
        </div>
      </div>

      <!-- ── Background Service ── -->
      <div class="sg">
        <div class="sg__header">
          <div class="sg__icon sg__icon--blue">${ICONS.background}</div>
          <div class="sg__meta">
            <div class="sg__title">Background Service</div>
            <div class="sg__desc">Keep Wyre running when the app is closed</div>
          </div>
        </div>
        <div class="sg__body">
          <div class="sg__row sg__row--toggle">
            <div class="sg__row-info">
              <label class="sg__label" for="background-service">Run in Background</label>
              <span class="sg__hint">Receive files and notifications even when Wyre is closed. Uses a persistent notification to stay active.</span>
            </div>
            <label class="toggle">
              <input class="toggle__input" id="background-service" type="checkbox" ${(s as AppSettingsWithBackground).backgroundService ? 'checked' : ''}/>
              <span class="toggle__track"><span class="toggle__thumb"></span></span>
            </label>
          </div>
        </div>
      </div>

      <!-- ── Data ── -->
      <div class="sg">
        <div class="sg__header">
          <div class="sg__icon sg__icon--red">${ICONS.data}</div>
          <div class="sg__meta">
            <div class="sg__title">Data</div>
            <div class="sg__desc">Manage stored transfer records</div>
          </div>
        </div>
        <div class="sg__body">
          <div class="sg__row sg__row--toggle">
            <div class="sg__row-info">
              <span class="sg__label">Transfer History</span>
              <span class="sg__hint">Permanently removes all completed, failed, and cancelled records</span>
            </div>
            <button class="btn btn--danger btn--sm" id="clear-history-btn">
              <i class="fa-solid fa-trash-can btn__icon"></i>
              Clear
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderTrustedList(trustedIds: string[]): string {
    if (trustedIds.length === 0) {
      return `<span class="sg__hint settings-view__trusted-empty">No trusted devices yet</span>`;
    }
    return trustedIds.map(id => `
      <div class="settings-view__trusted-item">
        <i class="fa-solid fa-shield-halved settings-view__trusted-icon"></i>
        <span class="settings-view__trusted-id" title="${escapeHtml(id)}">…${escapeHtml(id.slice(-8))}</span>
        <button class="settings-view__trusted-remove btn btn--ghost btn--sm"
          aria-label="Remove trusted device"
          data-remove-trusted="${escapeHtml(id)}">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    `).join('');
  }

  private renderDeviceOptions(trustedIds: string[]): string {
    return StateManager.get('devices')
      .filter(d => !trustedIds.includes(d.id))
      .map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)}</option>`)
      .join('');
  }

  protected onMount(): void {
    const unsub = StateManager.subscribe('settings', (settings) => {
      if (settings) this.settings = settings;
    });
    this.addCleanup(unsub);

    const unsubDevices = StateManager.subscribe('devices', () => {
      this.refreshTrustedDeviceDropdown();
      this.refreshSecuritySection();
    });
    this.addCleanup(unsubDevices);

    const current = StateManager.get('settings');
    if (current) this.settings = current;

    // Initial security section render
    this.refreshSecuritySection();

    this.attachEvents();
  }

  /** Update the Security section based on the currently selected device */
  private refreshSecuritySection(): void {
    const iconWrap = this.element?.querySelector('#security-icon-wrap') as HTMLElement | null;
    const icon = this.element?.querySelector('#security-icon') as HTMLElement | null;
    const label = this.element?.querySelector('#security-label') as HTMLElement | null;
    const hint = this.element?.querySelector('#security-hint') as HTMLElement | null;
    if (!iconWrap || !icon || !label || !hint) return;

    const devices = StateManager.get('devices');
    const selectedIds = StateManager.get('selectedDeviceIds');
    const selectedDevice = selectedIds.length > 0
      ? devices.find(d => d.id === selectedIds[0])
      : devices.find(d => d.online);

    if (!selectedDevice) {
      iconWrap.className = 'sg__icon sg__icon--green';
      icon.className = 'fa-solid fa-lock';
      label.textContent = 'No peer selected';
      hint.textContent = 'Select a device to see its encryption capability';
      return;
    }

    if (selectedDevice.encryptionSupported === true) {
      iconWrap.className = 'sg__icon sg__icon--green';
      icon.className = 'fa-solid fa-lock';
      label.textContent = 'AES-256-GCM encrypted';
      hint.textContent = `${escapeHtml(selectedDevice.name)} supports end-to-end encrypted transfers`;
    } else {
      iconWrap.className = 'sg__icon sg__icon--muted';
      icon.className = 'fa-solid fa-lock-open';
      label.textContent = 'Unencrypted (peer does not support encryption)';
      hint.textContent = `${escapeHtml(selectedDevice.name)} does not advertise encryption support`;
    }
  }

  private refreshTrustedDeviceDropdown(): void {
    const select = this.element?.querySelector('#trust-device-select') as HTMLSelectElement | null;
    if (!select) return;
    const current = this.settings ?? StateManager.get('settings');
    const trustedIds = current?.trustedDeviceIds ?? [];
    select.innerHTML = `<option value="">Select a device…</option>` + this.renderDeviceOptions(trustedIds);
  }

  private attachTrustedListEvents(): void {
    if (!this.element) return;
    this.element.querySelectorAll('[data-remove-trusted]').forEach(btn => {
      btn.addEventListener('click', () => {
        void (async () => {
          const idToRemove = (btn as HTMLElement).dataset['removeTrusted'] ?? '';
          const current = StateManager.get('settings');
          if (!current) return;
          const updated = current.trustedDeviceIds.filter(id => id !== idToRemove);
          await AppBridge.setSettings({ trustedDeviceIds: updated });
          StateManager.setState('settings', { ...current, trustedDeviceIds: updated });
          const listEl = this.element?.querySelector('#trusted-list');
          if (listEl) listEl.innerHTML = this.renderTrustedList(updated);
          this.refreshTrustedDeviceDropdown();
          this.attachTrustedListEvents();
          this.toasts.success('Device removed from trusted list');
        })();
      });
    });
  }

  private attachEvents(): void {
    if (!this.element) return;

    this.element.querySelector('#save-name-btn')
      ?.addEventListener('click', () => { void this.saveDeviceName(); });

    const autoAcceptInput = this.element.querySelector('#auto-accept') as HTMLInputElement;
    autoAcceptInput?.addEventListener('change', async () => {
      await AppBridge.setSettings({ autoAccept: autoAcceptInput.checked });
      const current = StateManager.get('settings');
      if (current) StateManager.setState('settings', { ...current, autoAccept: autoAcceptInput.checked });
      const trustedSection = this.element?.querySelector('#trusted-devices-section') as HTMLElement | null;
      if (trustedSection) trustedSection.style.display = autoAcceptInput.checked ? '' : 'none';
      this.toasts.success('Settings saved');
    });

    const timeoutSlider = this.element.querySelector('#decline-timeout') as HTMLInputElement;
    const timeoutValue = this.element.querySelector('#timeout-value');
    timeoutSlider?.addEventListener('input', () => {
      if (timeoutValue) timeoutValue.textContent = `${timeoutSlider.value}s`;
    });
    timeoutSlider?.addEventListener('change', async () => {
      const val = parseInt(timeoutSlider.value, 10);
      const { valid, error } = validateTimeout(val);
      if (!valid) { this.toasts.error(error ?? 'Invalid timeout'); return; }
      await AppBridge.setSettings({ autoDeclineTimeout: val });
      const current = StateManager.get('settings');
      if (current) StateManager.setState('settings', { ...current, autoDeclineTimeout: val });
      this.toasts.success('Settings saved');
    });

    this.element.querySelectorAll('input[name="theme"]').forEach(radio => {
      radio.addEventListener('change', async () => {
        const val = (radio as HTMLInputElement).value as 'dark' | 'light' | 'system';
        this.element?.querySelectorAll('.sg__theme-option').forEach(opt => {
          opt.classList.toggle('sg__theme-option--active',
            (opt.querySelector('input') as HTMLInputElement)?.value === val);
        });
        await AppBridge.setSettings({ theme: val });
        const current = StateManager.get('settings');
        if (current) StateManager.setState('settings', { ...current, theme: val });
        window.dispatchEvent(new CustomEvent('wyre:theme-change', { detail: { theme: val } }));
        this.toasts.success('Theme updated');
      });
    });

    const notifInput = this.element.querySelector('#show-notifications') as HTMLInputElement;
    notifInput?.addEventListener('change', async () => {
      await AppBridge.setSettings({ showNotifications: notifInput.checked });
      const current = StateManager.get('settings');
      if (current) StateManager.setState('settings', { ...current, showNotifications: notifInput.checked });
      this.toasts.success('Settings saved');
    });

    const bgServiceInput = this.element.querySelector('#background-service') as HTMLInputElement;
    bgServiceInput?.addEventListener('change', async () => {
      const enabled = bgServiceInput.checked;
      // Cast to extended type since backgroundService is Android-only
      await AppBridge.setSettings({ backgroundService: enabled } as Partial<AppSettings>);
      const current = StateManager.get('settings');
      if (current) StateManager.setState('settings', { ...current, backgroundService: enabled } as AppSettings);
      if (enabled) {
        this.toasts.success('Background service enabled — Wyre will run in the background');
      } else {
        this.toasts.info('Background service disabled');
      }
    });

    this.element.querySelector('#clear-history-btn')
      ?.addEventListener('click', async () => {
        await AppBridge.clearHistory();
        StateManager.setState('transferHistory', []);
        this.toasts.success('Transfer history cleared');
      });

    this.attachTrustedListEvents();

    this.element.querySelector('#trust-device-btn')
      ?.addEventListener('click', () => {
        void (async () => {
          const select = this.element?.querySelector('#trust-device-select') as HTMLSelectElement | null;
          const deviceId = select?.value ?? '';
          if (!deviceId) { this.toasts.error('Please select a device first'); return; }
          const current = StateManager.get('settings');
          if (!current) return;
          if (current.trustedDeviceIds.includes(deviceId)) { this.toasts.info('Device is already trusted'); return; }
          const updated = [...current.trustedDeviceIds, deviceId];
          await AppBridge.setSettings({ trustedDeviceIds: updated });
          StateManager.setState('settings', { ...current, trustedDeviceIds: updated });
          const listEl = this.element?.querySelector('#trusted-list');
          if (listEl) listEl.innerHTML = this.renderTrustedList(updated);
          this.refreshTrustedDeviceDropdown();
          this.attachTrustedListEvents();
          this.toasts.success('Device added to trusted list');
        })();
      });
  }

  private async saveDeviceName(): Promise<void> {
    const input = this.element?.querySelector('#device-name') as HTMLInputElement;
    if (!input) return;
    const { valid, error } = validateDeviceName(input.value);
    if (!valid) { this.toasts.error(error ?? 'Invalid name'); return; }
    await AppBridge.setSettings({ deviceName: input.value });
    const current = StateManager.get('settings');
    if (current) StateManager.setState('settings', { ...current, deviceName: input.value });
    this.toasts.success('Device name saved');
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
