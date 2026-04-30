/**
 * SettingsView.ts
 * User preferences view — all settings implemented and persisted.
 */

import { Component } from '../components/base/Component';
import { IpcClient } from '../core/IpcClient';
import { StateManager } from '../core/StateManager';
import type { AppSettings } from '../../shared/models/AppSettings';
import type { ToastContainer } from '../components/ToastContainer';
import { validateDeviceName, validatePort, validateTimeout } from '../../shared/utils/validators';

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
      <div class="view__header">
        <h1 class="view__title">Settings</h1>
      </div>
      <div class="view__content settings-view__content">
        ${settings ? this.renderForm(settings) : '<p class="settings-view__loading">Loading settings…</p>'}
      </div>
    `;

    return view;
  }

  private renderForm(s: AppSettings): string {
    return `
      <section class="settings-section">
        <div class="settings-section__header">
          <div class="settings-section__title">Device Identity</div>
          <div class="settings-section__desc">How you appear to other devices on the network</div>
        </div>
        <div class="settings-section__body">
          <div class="settings-field">
            <label class="settings-field__label" for="device-name">Device Name</label>
            <div class="settings-field__row">
              <input class="settings-field__input" id="device-name" type="text"
                value="${escapeHtml(s.deviceName)}" maxlength="64" autocomplete="off" spellcheck="false"/>
              <button class="btn btn--primary btn--sm" id="save-name-btn">Save</button>
            </div>
            <span class="settings-field__hint">Visible to nearby devices when they discover you.</span>
          </div>
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section__header">
          <div class="settings-section__title">File Transfer</div>
          <div class="settings-section__desc">Storage and network settings</div>
        </div>
        <div class="settings-section__body">
          <div class="settings-field">
            <label class="settings-field__label" for="save-dir">Save Location</label>
            <div class="settings-field__row">
              <input class="settings-field__input settings-field__input--readonly" id="save-dir" type="text"
                value="${escapeHtml(s.saveDirectory)}" readonly/>
              <button class="btn btn--secondary btn--sm" id="browse-dir-btn">Browse…</button>
            </div>
            <span class="settings-field__hint">Received files are saved here by default.</span>
          </div>
          <div class="settings-field">
            <label class="settings-field__label" for="transfer-port">Transfer Port</label>
            <div class="settings-field__row">
              <input class="settings-field__input settings-field__input--narrow" id="transfer-port" type="number"
                value="${s.transferPort}" min="1" max="65535"/>
              <button class="btn btn--secondary btn--sm" id="randomize-port-btn">Randomize</button>
              <button class="btn btn--primary btn--sm" id="save-port-btn">Save</button>
            </div>
            <span class="settings-field__hint">TCP port for incoming transfers. Restart required.</span>
          </div>
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section__header">
          <div class="settings-section__title">Incoming Requests</div>
          <div class="settings-section__desc">Control how incoming transfers are handled</div>
        </div>
        <div class="settings-section__body">
          <div class="settings-field settings-field--toggle">
            <div class="settings-field__toggle-info">
              <label class="settings-field__label" for="auto-accept">Auto-Accept</label>
              <span class="settings-field__hint">Accept all incoming transfers without prompting.</span>
            </div>
            <label class="toggle">
              <input class="toggle__input" id="auto-accept" type="checkbox" ${s.autoAccept ? 'checked' : ''}/>
              <span class="toggle__track"><span class="toggle__thumb"></span></span>
            </label>
          </div>
          <div class="settings-field">
            <label class="settings-field__label" for="decline-timeout">
              Auto-Decline Timeout — <strong id="timeout-value">${s.autoDeclineTimeout}s</strong>
            </label>
            <input class="settings-field__range" id="decline-timeout" type="range"
              min="10" max="120" step="5" value="${s.autoDeclineTimeout}"/>
            <div class="settings-field__range-labels"><span>10s</span><span>120s</span></div>
          </div>
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section__header">
          <div class="settings-section__title">Appearance</div>
          <div class="settings-section__desc">Customize the look of FileDrop</div>
        </div>
        <div class="settings-section__body">
          <div class="settings-field">
            <label class="settings-field__label">Theme</label>
            <div class="settings-field__radio-group" role="radiogroup">
              ${['dark', 'light', 'system'].map(t => `
                <label class="radio-option${s.theme === t ? ' radio-option--selected' : ''}">
                  <input type="radio" name="theme" value="${t}" ${s.theme === t ? 'checked' : ''}/>
                  ${t.charAt(0).toUpperCase() + t.slice(1)}
                </label>
              `).join('')}
            </div>
          </div>
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section__header">
          <div class="settings-section__title">Notifications</div>
        </div>
        <div class="settings-section__body">
          <div class="settings-field settings-field--toggle">
            <div class="settings-field__toggle-info">
              <label class="settings-field__label" for="show-notifications">System Notifications</label>
              <span class="settings-field__hint">Show OS notifications when transfers complete.</span>
            </div>
            <label class="toggle">
              <input class="toggle__input" id="show-notifications" type="checkbox" ${s.showNotifications ? 'checked' : ''}/>
              <span class="toggle__track"><span class="toggle__thumb"></span></span>
            </label>
          </div>
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section__header">
          <div class="settings-section__title">Data</div>
        </div>
        <div class="settings-section__body">
          <div class="settings-field">
            <button class="btn btn--danger btn--sm" id="clear-history-btn">Clear Transfer History</button>
            <span class="settings-field__hint">Removes all completed, failed, and cancelled records.</span>
          </div>
        </div>
      </section>
    `;
  }

  protected onMount(): void {
    const unsub = StateManager.subscribe('settings', (settings) => {
      if (settings) {
        this.settings = settings;
        super.update();
        this.attachEvents();
      }
    });
    this.addCleanup(unsub);

    const current = StateManager.get('settings');
    if (current) {
      this.settings = current;
      super.update();
    }

    this.attachEvents();
  }

  private attachEvents(): void {
    if (!this.element) return;

    // Device name save
    const saveNameBtn = this.element.querySelector('#save-name-btn');
    saveNameBtn?.addEventListener('click', () => this.saveDeviceName());

    // Browse save directory
    const browseDirBtn = this.element.querySelector('#browse-dir-btn');
    browseDirBtn?.addEventListener('click', () => this.browseSaveDirectory());

    // Port save
    const savePortBtn = this.element.querySelector('#save-port-btn');
    savePortBtn?.addEventListener('click', () => this.savePort());

    // Randomize port
    const randomizePortBtn = this.element.querySelector('#randomize-port-btn');
    randomizePortBtn?.addEventListener('click', () => {
      const input = this.element?.querySelector('#transfer-port') as HTMLInputElement;
      if (input) input.value = String(Math.floor(Math.random() * (65535 - 1024)) + 1024);
    });

    // Auto-accept toggle
    const autoAcceptInput = this.element.querySelector('#auto-accept') as HTMLInputElement;
    autoAcceptInput?.addEventListener('change', async () => {
      await IpcClient.setSettings({ autoAccept: autoAcceptInput.checked });
      this.toasts.success('Settings saved');
    });

    // Decline timeout slider
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
      this.toasts.success('Settings saved');
    });

    // Theme radio
    const themeRadios = this.element.querySelectorAll('input[name="theme"]');
    themeRadios.forEach(radio => {
      radio.addEventListener('change', async () => {
        const val = (radio as HTMLInputElement).value as 'dark' | 'light' | 'system';
        await IpcClient.setSettings({ theme: val });
        // Apply theme immediately
        window.dispatchEvent(new CustomEvent('filedrop:theme-change', { detail: { theme: val } }));
        this.toasts.success('Theme updated');
      });
    });

    // Notifications toggle
    const notifInput = this.element.querySelector('#show-notifications') as HTMLInputElement;
    notifInput?.addEventListener('change', async () => {
      await IpcClient.setSettings({ showNotifications: notifInput.checked });
      this.toasts.success('Settings saved');
    });

    // Clear history
    const clearHistoryBtn = this.element.querySelector('#clear-history-btn');
    clearHistoryBtn?.addEventListener('click', async () => {
      await IpcClient.clearHistory();
      StateManager.setState('transferHistory', []);
      this.toasts.success('Transfer history cleared');
    });
  }

  private async saveDeviceName(): Promise<void> {
    const input = this.element?.querySelector('#device-name') as HTMLInputElement;
    if (!input) return;
    const { valid, error } = validateDeviceName(input.value);
    if (!valid) { this.toasts.error(error ?? 'Invalid name'); return; }
    await IpcClient.setSettings({ deviceName: input.value });
    this.toasts.success('Device name saved');
  }

  private async browseSaveDirectory(): Promise<void> {
    // Use a file input with webkitdirectory as fallback
    // In Electron, we'd normally use dialog.showOpenDialog via IPC
    // For now, show a toast directing user
    this.toasts.info('Use the file picker to select a folder');
    const input = document.createElement('input');
    input.type = 'file';
    (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file) {
        const dirPath = (file as File & { path?: string }).path?.split('/').slice(0, -1).join('/') ?? '';
        if (dirPath) {
          await IpcClient.setSettings({ saveDirectory: dirPath });
          const dirInput = this.element?.querySelector('#save-dir') as HTMLInputElement;
          if (dirInput) dirInput.value = dirPath;
          this.toasts.success('Save location updated');
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
    this.toasts.success('Port saved — restart required');
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
