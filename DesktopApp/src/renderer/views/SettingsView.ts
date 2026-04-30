/**
 * SettingsView.ts
 * Modern settings page — icon-led sections, inline rows, clean hierarchy.
 */

import { Component } from '../components/base/Component';
import { IpcClient } from '../core/IpcClient';
import { StateManager } from '../core/StateManager';
import type { AppSettings } from '../../shared/models/AppSettings';
import type { ToastContainer } from '../components/ToastContainer';
import { validateDeviceName, validatePort, validateTimeout } from '../../shared/utils/validators';

// SVG icons for each section
const ICONS = {
  identity: `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd"/></svg>`,
  transfer: `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M8 5a1 1 0 100 2h5.586l-1.293 1.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L13.586 5H8zM12 15a1 1 0 100-2H6.414l1.293-1.293a1 1 0 10-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L6.414 15H12z"/></svg>`,
  incoming: `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zm0 16a3 3 0 01-3-3h6a3 3 0 01-3 3z"/></svg>`,
  appearance: `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M4 2a2 2 0 00-2 2v11a3 3 0 106 0V4a2 2 0 00-2-2H4zm1 14a1 1 0 110-2 1 1 0 010 2zm5-1.757l4.9-4.9a2 2 0 000-2.828L13.485 5.1a2 2 0 00-2.828 0L10 5.757v8.486zM16 18H9.071l6-6H16a2 2 0 012 2v2a2 2 0 01-2 2z"/></svg>`,
  notifications: `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zm0 16a3 3 0 01-3-3h6a3 3 0 01-3 3z"/></svg>`,
  data: `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>`,
  folder: `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>`,
  port: `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>`,
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
      <div class="view__header">
        <div class="view__header-left">
          <h1 class="view__title">Settings</h1>
          <p class="view__subtitle">Manage your device preferences</p>
        </div>
      </div>
      <div class="settings-view__scroll">
        <div class="settings-view__content">
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
                <svg viewBox="0 0 16 16" fill="currentColor" class="btn__icon"><path d="M1.75 1A1.75 1.75 0 000 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0016 13.25v-8.5A1.75 1.75 0 0014.25 3H7.5a.25.25 0 01-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75z"/></svg>
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
                <span class="sg__theme-preview sg__theme-preview--dark">
                  <span class="sg__theme-preview-bar"></span>
                  <span class="sg__theme-preview-bar"></span>
                  <span class="sg__theme-preview-bar"></span>
                </span>
                <span class="sg__theme-label">Dark</span>
              </label>
              <label class="sg__theme-option${s.theme === 'light' ? ' sg__theme-option--active' : ''}">
                <input type="radio" name="theme" value="light" ${s.theme === 'light' ? 'checked' : ''}/>
                <span class="sg__theme-preview sg__theme-preview--light">
                  <span class="sg__theme-preview-bar"></span>
                  <span class="sg__theme-preview-bar"></span>
                  <span class="sg__theme-preview-bar"></span>
                </span>
                <span class="sg__theme-label">Light</span>
              </label>
              <label class="sg__theme-option${s.theme === 'system' ? ' sg__theme-option--active' : ''}">
                <input type="radio" name="theme" value="system" ${s.theme === 'system' ? 'checked' : ''}/>
                <span class="sg__theme-preview sg__theme-preview--system">
                  <span class="sg__theme-preview-bar"></span>
                  <span class="sg__theme-preview-bar"></span>
                  <span class="sg__theme-preview-bar"></span>
                </span>
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
              <svg viewBox="0 0 16 16" fill="currentColor" class="btn__icon"><path d="M6.5 1.75a.25.25 0 01.25-.25h2.5a.25.25 0 01.25.25V3h-3V1.75zm4.5 0V3h2.25a.75.75 0 010 1.5H2.75a.75.75 0 010-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75zM4.496 6.675a.75.75 0 10-1.492.15l.66 6.6A1.75 1.75 0 005.405 15h5.19a1.75 1.75 0 001.741-1.575l.66-6.6a.75.75 0 10-1.492-.15l-.66 6.6a.25.25 0 01-.249.225H5.405a.25.25 0 01-.249-.225l-.66-6.6z"/></svg>
              Clear History
            </button>
          </div>
        </div>
      </div>

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

    this.element.querySelector('#save-name-btn')
      ?.addEventListener('click', () => this.saveDeviceName());

    this.element.querySelector('#browse-dir-btn')
      ?.addEventListener('click', () => this.browseSaveDirectory());

    this.element.querySelector('#save-port-btn')
      ?.addEventListener('click', () => this.savePort());

    this.element.querySelector('#randomize-port-btn')
      ?.addEventListener('click', () => {
        const input = this.element?.querySelector('#transfer-port') as HTMLInputElement;
        if (input) input.value = String(Math.floor(Math.random() * (65535 - 1024)) + 1024);
      });

    const autoAcceptInput = this.element.querySelector('#auto-accept') as HTMLInputElement;
    autoAcceptInput?.addEventListener('change', async () => {
      await IpcClient.setSettings({ autoAccept: autoAcceptInput.checked });
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
      this.toasts.success('Settings saved');
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
        window.dispatchEvent(new CustomEvent('filedrop:theme-change', { detail: { theme: val } }));
        this.toasts.success('Theme updated');
      });
    });

    const notifInput = this.element.querySelector('#show-notifications') as HTMLInputElement;
    notifInput?.addEventListener('change', async () => {
      await IpcClient.setSettings({ showNotifications: notifInput.checked });
      this.toasts.success('Settings saved');
    });

    this.element.querySelector('#clear-history-btn')
      ?.addEventListener('click', async () => {
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
