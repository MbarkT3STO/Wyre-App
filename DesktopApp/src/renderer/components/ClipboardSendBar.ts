/**
 * ClipboardSendBar.ts
 * Compact bar for sending clipboard text to the selected device(s).
 * Feature 2: Clipboard text sharing.
 * Only visible when at least one device is selected.
 */

import { Component } from './base/Component';
import { StateManager } from '../core/StateManager';
import { IpcClient } from '../core/IpcClient';
import type { ToastContainer } from './ToastContainer';

const MAX_CHARS = 5000;

export class ClipboardSendBar extends Component {
  private toasts: ToastContainer;
  private textareaEl: HTMLTextAreaElement | null = null;
  private counterEl: HTMLElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;

  constructor(toasts: ToastContainer) {
    super();
    this.toasts = toasts;
  }

  render(): HTMLElement {
    const selectedIds = StateManager.get('selectedDeviceIds');
    const hasDevice = selectedIds.length > 0;

    const bar = this.el('div', `home-view__clipboard-bar${hasDevice ? '' : ' home-view__clipboard-bar--hidden'}`);
    bar.setAttribute('aria-label', 'Send clipboard text');

    bar.innerHTML = `
      <div class="home-view__clipboard-header">
        <i class="fa-solid fa-clipboard home-view__clipboard-icon" aria-hidden="true"></i>
        <span class="home-view__clipboard-title">Send Text</span>
        <span class="home-view__clipboard-counter" id="clipboard-counter">0 / ${MAX_CHARS}</span>
      </div>
      <textarea
        class="home-view__clipboard-textarea"
        id="clipboard-textarea"
        placeholder="Paste or type text to send…"
        maxlength="${MAX_CHARS}"
        rows="3"
        aria-label="Text to send"
      ></textarea>
      <div class="home-view__clipboard-footer">
        <button class="btn btn--secondary btn--sm home-view__clipboard-send" id="clipboard-send-btn" disabled>
          <i class="fa-solid fa-paper-plane btn__icon"></i>
          Send text
        </button>
      </div>
    `;

    return bar;
  }

  protected onMount(): void {
    this.textareaEl = this.element?.querySelector('#clipboard-textarea') as HTMLTextAreaElement | null;
    this.counterEl = this.element?.querySelector('#clipboard-counter') ?? null;
    this.sendBtn = this.element?.querySelector('#clipboard-send-btn') as HTMLButtonElement | null;

    if (this.textareaEl) {
      this.textareaEl.addEventListener('input', () => this.handleInput());
    }

    if (this.sendBtn) {
      this.sendBtn.addEventListener('click', () => { void this.handleSend(); });
    }

    // Show/hide based on device selection
    const unsub = StateManager.subscribe('selectedDeviceIds', () => {
      this.updateVisibility();
    });
    this.addCleanup(unsub);
  }

  private handleInput(): void {
    if (!this.textareaEl || !this.counterEl || !this.sendBtn) return;
    const len = this.textareaEl.value.length;
    this.counterEl.textContent = `${len} / ${MAX_CHARS}`;
    this.counterEl.classList.toggle('home-view__clipboard-counter--warn', len > MAX_CHARS * 0.9);
    this.sendBtn.disabled = len === 0;

    // Auto-resize up to 4 rows
    this.textareaEl.style.height = 'auto';
    const lineHeight = 22;
    const maxHeight = lineHeight * 4 + 24; // 4 rows + padding
    this.textareaEl.style.height = `${Math.min(this.textareaEl.scrollHeight, maxHeight)}px`;
  }

  private async handleSend(): Promise<void> {
    if (!this.textareaEl || !this.sendBtn) return;
    const text = this.textareaEl.value;
    if (!text.trim()) return;

    const selectedIds = StateManager.get('selectedDeviceIds');
    if (selectedIds.length === 0) return;

    this.sendBtn.disabled = true;
    this.sendBtn.innerHTML = `<i class="fa-solid fa-paper-plane btn__icon"></i> Sending…`;

    const truncated = text.length > MAX_CHARS;
    const safeText = truncated ? text.slice(0, MAX_CHARS) : text;

    try {
      // Fan out to all selected devices
      await Promise.all(
        selectedIds.map(deviceId =>
          IpcClient.sendClipboard({ deviceId, text: safeText }),
        ),
      );

      const target = selectedIds.length === 1 ? '1 device' : `${selectedIds.length} devices`;
      this.toasts.success(`Text sent to ${target}`);
      this.textareaEl.value = '';
      this.handleInput();
    } catch (err) {
      this.toasts.error(`Failed to send text: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.sendBtn.disabled = false;
      this.sendBtn.innerHTML = `<i class="fa-solid fa-paper-plane btn__icon"></i> Send text`;
    }
  }

  private updateVisibility(): void {
    if (!this.element) return;
    const hasDevice = StateManager.get('selectedDeviceIds').length > 0;
    this.element.classList.toggle('home-view__clipboard-bar--hidden', !hasDevice);
  }
}
