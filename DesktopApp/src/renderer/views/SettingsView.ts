/**
 * SettingsView.ts
 * Modern settings page — icon-led sections, inline rows, clean hierarchy.
 * Feature 2: Trusted devices management UI.
 * Feature 3: Diagnostics / View Logs section.
 */

import { Component } from '../components/base/Component';
import { IpcClient } from '../core/IpcClient';
import { StateManager } from '../core/StateManager';
import { LogsModal } from '../components/LogsModal';
import type { AppSettings } from '../../shared/models/AppSettings';
import type { ToastContainer } from '../components/ToastContainer';
import { validateDeviceName, validatePort, validateTimeout } from '../../shared/utils/validators';

// Font Awesome icons for each section — consistent with the rest of the UI
const ICONS = {
  identity:      `<i class="fa-solid fa-user"></i>`,
  transfer:      `<i class="fa-solid fa-arrow-right-arrow-left"></i>`,
  incoming:      `<i class="fa-solid fa-inbox"></i>`,
  appearance:    `<i class="fa-solid fa-palette"></i>`,
  notifications: `<i class="fa-solid fa-bell"></i>`,
  data:          `<i class="fa-solid fa-trash-can"></i>`,
  folder:        `<i class="fa-solid fa-folder-open"></i>`,
  port:          `<i class="fa-solid fa-plug"></i>`,
  scale:         `<i class="fa-solid fa-magnifying-glass"></i>`,
  trusted:       `<i class="fa-solid fa-shield-halved"></i>`,
  diagnostics:   `<i class="fa-solid fa-stethoscope"></i>`,
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
    return `
      <div class="settings-loading">
        <div class="settings-loading__spinner"></div>
        <span>Loading settings…</span>
      </div>
    `;
  }

  private renderForm(s: AppSettings): string {
    return `

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
              <span class="sg__hint">Visible to nearby devices when they discover you</span>
            </div>
            <div class="sg__row-control sg__row-control--wide">
              <input class="sg__input" id="device-name" type="text"
                value="${escapeHtml(s.deviceName)}" maxlength="64"
                autocomplete="off" spellcheck="false" placeholder="My Device"/>
              <button class="btn btn--primary btn--sm" id="save-name-btn">Save</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ── File Transfer ── -->
      <div class="sg">
        <div class="sg__header">
          <div class="sg__icon sg__icon--blue">${ICONS.transfer}</div>
          <div class="sg__meta">
            <div class="sg__title">File Transfer</div>
            <div class="sg__desc">Storage location and network port settings</div>
          </div>
        </div>
        <div class="sg__body">
          <div class="sg__row">
            <div class="sg__row-info">
              <label class="sg__label" for="save-dir">
                <span class="sg__label-icon">${ICONS.folder}</span>
                Save Location
              </label>
              <span class="sg__hint">Received files are saved here by default</span>
            </div>
            <div class="sg__row-control sg__row-control--wide">
              <input class="sg__input sg__input--mono sg__input--readonly" id="save-dir"
                type="text" value="${escapeHtml(s.saveDirectory)}" readonly/>
              <button class="btn btn--secondary btn--sm" id="browse-dir-btn">
                <i class="fa-solid fa-folder-open btn__icon"></i>
                Browse
              </button>
            </div>
          </div>
          <div class="sg__divider"></div>
          <div class="sg__row">
            <div class="sg__row-info">
              <label class="sg__label" for="transfer-port">
                <span class="sg__label-icon">${ICONS.port}</span>
                Transfer Port
              </label>
              <span class="sg__hint">TCP port for incoming transfers — restart required</span>
            </div>
            <div class="sg__row-control">
              <input class="sg__input sg__input--mono sg__input--narrow" id="transfer-port"
                type="number" value="${s.transferPort}" min="1" max="65535"/>
              <button class="btn btn--ghost btn--sm" id="randomize-port-btn">Randomize</button>
              <button class="btn btn--primary btn--sm" id="save-port-btn">Save</button>
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
              <span class="sg__hint">Automatically decline if not responded to within this time</span>
            </div>
            <div class="sg__slider-wrap">
              <input class="sg__range" id="decline-timeout" type="range"
                min="10" max="120" step="5" value="${s.autoDeclineTimeout}"/>
              <div class="sg__range-labels">
                <span>10s</span>
                <span>120s</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Trusted Devices (Feature 2) ── -->
      <div class="sg" id="trusted-devices-section" ${s.autoAccept ? '' : 'style="display:none"'}>
        <div class="sg__header">
          <div class="sg__icon sg__icon--green">${ICONS.trusted}</div>
          <div class="sg__meta">
            <div class="sg__title">Trusted Devices</div>
            <div class="sg__desc">Devices that are auto-accepted without prompting</div>
          </div>
        </div>
        <div class="sg__body">
          <div class="sg__row sg__row--column" id="trusted-list-row">
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
                Trust this device
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ── UI Scale ── -->
      <div class="sg">
        <div class="sg__header">
          <div class="sg__icon sg__icon--blue">${ICONS.scale}</div>
          <div class="sg__meta">
            <div class="sg__title">UI Scale</div>
            <div class="sg__desc">Adjust the size of all interface elements</div>
          </div>
        </div>
        <div class="sg__body">
          <div class="sg__row sg__row--column">
            <div class="sg__row-info">
              <span class="sg__label">
                Interface Size
                <span class="sg__badge" id="scale-value">${Math.round((s.uiScale ?? 1.0) * 100)}%</span>
              </span>
              <span class="sg__hint">Changes take effect immediately across the whole app</span>
            </div>
            <div class="sg__scale-group" role="radiogroup" aria-label="UI Scale">
              ${([0.85, 0.9, 1.0, 1.1, 1.2, 1.35] as const).map(v => `
                <label class="sg__scale-option${(s.uiScale ?? 1.0) === v ? ' sg__scale-option--active' : ''}">
                  <input type="radio" name="uiScale" value="${v}" ${(s.uiScale ?? 1.0) === v ? 'checked' : ''}/>
                  <span class="sg__scale-preview">
                    <span class="sg__scale-preview-text">Aa</span>
                  </span>
                  <span class="sg__scale-label">${v === 0.85 ? 'XS' : v === 0.9 ? 'S' : v === 1.0 ? 'M' : v === 1.1 ? 'L' : v === 1.2 ? 'XL' : 'XXL'}</span>
                </label>
              `).join('')}
            </div>
          </div>
        </div>
      </div>

      <!-- ── Appearance ── -->
      <div class="sg">        <div class="sg__header">
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
              <span class="sg__hint">Show OS notifications when transfers complete or fail</span>
            </div>
            <label class="toggle">
              <input class="toggle__input" id="show-notifications" type="checkbox" ${s.showNotifications ? 'checked' : ''}/>
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
              Clear History
            </button>
          </div>
        </div>
      </div>

      <!-- ── Diagnostics (Feature 3) ── -->
      <div class="sg">
        <div class="sg__header">
          <div class="sg__icon sg__icon--blue">${ICONS.diagnostics}</div>
          <div class="sg__meta">
            <div class="sg__title">Diagnostics</div>
            <div class="sg__desc">View application logs for troubleshooting</div>
          </div>
        </div>
        <div class="sg__body">
          <div class="sg__row sg__row--toggle">
            <div class="sg__row-info">
              <span class="sg__label">Application Logs</span>
              <span class="sg__hint">View the last 50 log entries from wyre.log</span>
            </div>
            <button class="btn btn--secondary btn--sm" id="view-logs-btn">
              <i class="fa-solid fa-terminal btn__icon"></i>
              View Logs
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
          aria-label="Remove trusted device ${escapeHtml(id.slice(-8))}"
          data-remove-trusted="${escapeHtml(id)}">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    `).join('');
  }

  private renderDeviceOptions(trustedIds: string[]): string {
    const devices = StateManager.get('devices');
    return devices
      .filter(d => !trustedIds.includes(d.id))
      .map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)}</option>`)
      .join('');
  }

  protected onMount(): void {
    // Fix 4: Subscribe to settings changes only to keep our local cache in sync.
    const unsub = StateManager.subscribe('settings', (settings) => {
      if (settings) {
        this.settings = settings;
        this.attachEvents();
      }
    });
    this.addCleanup(unsub);

    // Feature 2: Keep the trusted-device dropdown populated with live devices
    const unsubDevices = StateManager.subscribe('devices', () => {
      this.refreshTrustedDeviceDropdown();
    });
    this.addCleanup(unsubDevices);

    const current = StateManager.get('settings');
    if (current) {
      this.settings = current;
    }

    this.attachEvents();
  }

  /** Re-populate only the device <select> without re-rendering the whole form (Feature 2) */
  private refreshTrustedDeviceDropdown(): void {
    const select = this.element?.querySelector('#trust-device-select') as HTMLSelectElement | null;
    if (!select) return;
    const current = this.settings ?? StateManager.get('settings');
    const trustedIds = current?.trustedDeviceIds ?? [];
    const placeholder = `<option value="">Select a device…</option>`;
    select.innerHTML = placeholder + this.renderDeviceOptions(trustedIds);
  }

  private attachEvents(): void {
    if (!this.element) return;

    this.element.querySelector('#save-name-btn')
      ?.addEventListener('click', () => { void this.saveDeviceName(); });

    this.element.querySelector('#browse-dir-btn')
      ?.addEventListener('click', () => { void this.browseSaveDirectory(); });

    this.element.querySelector('#save-port-btn')
      ?.addEventListener('click', () => { void this.savePort(); });

    this.element.querySelector('#randomize-port-btn')
      ?.addEventListener('click', () => {
        const input = this.element?.querySelector('#transfer-port') as HTMLInputElement;
        if (input) input.value = String(Math.floor(Math.random() * (65535 - 1024)) + 1024);
      });

    const autoAcceptInput = this.element.querySelector('#auto-accept') as HTMLInputElement;
    autoAcceptInput?.addEventListener('change', async () => {
      await IpcClient.setSettings({ autoAccept: autoAcceptInput.checked });
      // Fix 4: Patch StateManager slice without triggering a full re-render
      const current = StateManager.get('settings');
      if (current) StateManager.setState('settings', { ...current, autoAccept: autoAcceptInput.checked });
      // Feature 2: Show/hide trusted devices section
      const trustedSection = this.element?.querySelector('#trusted-devices-section') as HTMLElement | null;
      if (trustedSection) {
        trustedSection.style.display = autoAcceptInput.checked ? '' : 'none';
      }
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
      await IpcClient.setSettings({ autoDeclineTimeout: val });
      // Fix 4: Patch StateManager slice without triggering a full re-render
      const current = StateManager.get('settings');
      if (current) StateManager.setState('settings', { ...current, autoDeclineTimeout: val });
      this.toasts.success('Settings saved');
    });

    this.element.querySelectorAll('input[name="uiScale"]').forEach(radio => {
      radio.addEventListener('change', async () => {
        const val = parseFloat((radio as HTMLInputElement).value) as import('../../shared/models/AppSettings').UiScale;
        // Update active class
        this.element?.querySelectorAll('.sg__scale-option').forEach(opt => {
          const optVal = parseFloat((opt.querySelector('input') as HTMLInputElement)?.value ?? '1');
          opt.classList.toggle('sg__scale-option--active', optVal === val);
        });
        // Update badge
        const badge = this.element?.querySelector('#scale-value');
        if (badge) badge.textContent = `${Math.round(val * 100)}%`;
        // Apply immediately
        window.dispatchEvent(new CustomEvent('filedrop:scale-change', { detail: { scale: val } }));
        await IpcClient.setSettings({ uiScale: val });
        // Fix 4: Patch StateManager slice without triggering a full re-render
        const current = StateManager.get('settings');
        if (current) StateManager.setState('settings', { ...current, uiScale: val });
        this.toasts.success('UI scale updated');
      });
    });

    this.element.querySelectorAll('input[name="theme"]').forEach(radio => {
      radio.addEventListener('change', async () => {
        const val = (radio as HTMLInputElement).value as 'dark' | 'light' | 'system';
        // Update active class on theme options
        this.element?.querySelectorAll('.sg__theme-option').forEach(opt => {
          opt.classList.toggle('sg__theme-option--active',
            (opt.querySelector('input') as HTMLInputElement)?.value === val);
        });
        await IpcClient.setSettings({ theme: val });
        // Fix 4: Patch StateManager slice without triggering a full re-render
        const current = StateManager.get('settings');
        if (current) StateManager.setState('settings', { ...current, theme: val });
        window.dispatchEvent(new CustomEvent('filedrop:theme-change', { detail: { theme: val } }));
        this.toasts.success('Theme updated');
      });
    });

    const notifInput = this.element.querySelector('#show-notifications') as HTMLInputElement;
    notifInput?.addEventListener('change', async () => {
      await IpcClient.setSettings({ showNotifications: notifInput.checked });
      // Fix 4: Patch StateManager slice without triggering a full re-render
      const current = StateManager.get('settings');
      if (current) StateManager.setState('settings', { ...current, showNotifications: notifInput.checked });
      this.toasts.success('Settings saved');
    });

    this.element.querySelector('#clear-history-btn')
      ?.addEventListener('click', async () => {
        await IpcClient.clearHistory();
        StateManager.setState('transferHistory', []);
        this.toasts.success('Transfer history cleared');
      });

    // ── Feature 2: Trusted Devices ──────────────────────────────────────────

    // Remove trusted device buttons
    this.element.querySelectorAll('[data-remove-trusted]').forEach(btn => {
      btn.addEventListener('click', () => {
        void (async () => {
          const idToRemove = (btn as HTMLElement).dataset['removeTrusted'] ?? '';
          const current = StateManager.get('settings');
          if (!current) return;
          const updated = current.trustedDeviceIds.filter(id => id !== idToRemove);
          await IpcClient.setSettings({ trustedDeviceIds: updated });
          StateManager.setState('settings', { ...current, trustedDeviceIds: updated });
          // Re-render the trusted list in-place
          const listEl = this.element?.querySelector('#trusted-list');
          if (listEl) listEl.innerHTML = this.renderTrustedList(updated);
          this.refreshTrustedDeviceDropdown();
          // Re-attach remove buttons
          this.attachEvents();
          this.toasts.success('Device removed from trusted list');
        })();
      });
    });

    // Trust this device button
    this.element.querySelector('#trust-device-btn')
      ?.addEventListener('click', () => {
        void (async () => {
          const select = this.element?.querySelector('#trust-device-select') as HTMLSelectElement | null;
          const deviceId = select?.value ?? '';
          if (!deviceId) {
            this.toasts.error('Please select a device first');
            return;
          }
          const current = StateManager.get('settings');
          if (!current) return;
          if (current.trustedDeviceIds.includes(deviceId)) {
            this.toasts.info('Device is already trusted');
            return;
          }
          const updated = [...current.trustedDeviceIds, deviceId];
          await IpcClient.setSettings({ trustedDeviceIds: updated });
          StateManager.setState('settings', { ...current, trustedDeviceIds: updated });
          // Re-render the trusted list in-place
          const listEl = this.element?.querySelector('#trusted-list');
          if (listEl) listEl.innerHTML = this.renderTrustedList(updated);
          this.refreshTrustedDeviceDropdown();
          this.attachEvents();
          this.toasts.success('Device added to trusted list');
        })();
      });

    // ── Feature 3: Diagnostics ───────────────────────────────────────────────

    this.element.querySelector('#view-logs-btn')
      ?.addEventListener('click', () => {
        const modal = new LogsModal(() => { /* no-op on close */ });
        modal.mount(document.body);
      });
  }

  private async saveDeviceName(): Promise<void> {
    const input = this.element?.querySelector('#device-name') as HTMLInputElement;
    if (!input) return;
    const { valid, error } = validateDeviceName(input.value);
    if (!valid) { this.toasts.error(error ?? 'Invalid name'); return; }
    await IpcClient.setSettings({ deviceName: input.value });
    // Fix 4: Patch StateManager slice without triggering a full re-render
    const current = StateManager.get('settings');
    if (current) StateManager.setState('settings', { ...current, deviceName: input.value });
    this.toasts.success('Device name saved');
  }

  private browseSaveDirectory(): void {
    this.toasts.info('Use the file picker to select a folder');
    const input = document.createElement('input');
    input.type = 'file';
    (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) {
        const dirPath = (file as File & { path?: string }).path?.split('/').slice(0, -1).join('/') ?? '';
        if (dirPath) {
          void IpcClient.setSettings({ saveDirectory: dirPath }).then(() => {
            // Fix 4: Patch StateManager slice and DOM input without triggering a full re-render
            const current = StateManager.get('settings');
            if (current) StateManager.setState('settings', { ...current, saveDirectory: dirPath });
            const dirInput = this.element?.querySelector('#save-dir') as HTMLInputElement;
            if (dirInput) dirInput.value = dirPath;
            this.toasts.success('Save location updated');
          });
        }
      }
    };
    input.click();
  }

  private async savePort(): Promise<void> {
    const input = this.element?.querySelector('#transfer-port') as HTMLInputElement;
    if (!input) return;
    const val = parseInt(input.value, 10);
    const { valid, error } = validatePort(val);
    if (!valid) { this.toasts.error(error ?? 'Invalid port'); return; }
    await IpcClient.setSettings({ transferPort: val });
    // Fix 4: Patch StateManager slice without triggering a full re-render
    const current = StateManager.get('settings');
    if (current) StateManager.setState('settings', { ...current, transferPort: val });
    this.toasts.success('Port saved — restart required');
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
