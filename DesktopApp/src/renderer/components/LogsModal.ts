/**
 * LogsModal.ts
 * Diagnostics modal — displays the last 50 lines of the app log.
 * Follows the same pattern as AboutModal.ts.
 * Feature 3: Persistent transfer log.
 */

import { Component } from './base/Component';
import { IpcClient } from '../core/IpcClient';

export class LogsModal extends Component {
  private onClose: () => void;

  constructor(onClose: () => void) {
    super();
    this.onClose = onClose;
  }

  render(): HTMLElement {
    const backdrop = this.el('div', 'about-backdrop');
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-label', 'Application Logs');

    backdrop.innerHTML = `
      <div class="about-modal logs-modal">
        <button class="about-modal__close" aria-label="Close">
          <i class="fa-solid fa-xmark"></i>
        </button>
        <div class="logs-modal__header">
          <i class="fa-solid fa-terminal logs-modal__icon"></i>
          <h2 class="logs-modal__title">Application Logs</h2>
          <p class="logs-modal__subtitle">Last 50 entries from wyre.log</p>
        </div>
        <div class="logs-modal__body">
          <pre class="logs-modal__pre" id="logs-content" aria-live="polite">Loading…</pre>
        </div>
      </div>
    `;

    return backdrop;
  }

  protected onMount(): void {
    if (!this.element) return;

    // Close on backdrop click
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) this.dismiss();
    });

    // Close button
    this.element.querySelector('.about-modal__close')
      ?.addEventListener('click', () => this.dismiss());

    // Close on Escape
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.dismiss();
    };
    document.addEventListener('keydown', onKey);
    this.addCleanup(() => document.removeEventListener('keydown', onKey));

    // Focus close button
    (this.element.querySelector('.about-modal__close') as HTMLElement)?.focus();

    // Load logs
    void this.loadLogs();
  }

  private async loadLogs(): Promise<void> {
    const pre = this.element?.querySelector('#logs-content');
    if (!pre) return;

    try {
      const { lines } = await IpcClient.getLogs();
      const last50 = lines.slice(-50);
      if (last50.length === 0) {
        pre.textContent = '(no log entries yet)';
      } else {
        pre.textContent = last50.join('\n');
        // Scroll to bottom
        (pre as HTMLElement).scrollTop = (pre as HTMLElement).scrollHeight;
      }
    } catch {
      pre.textContent = 'Failed to load logs.';
    }
  }

  private dismiss(): void {
    const modal = this.element?.querySelector('.about-modal') as HTMLElement;
    const backdrop = this.element as HTMLElement;
    if (modal) modal.classList.add('about-modal--exit');
    if (backdrop) backdrop.classList.add('about-backdrop--exit');
    setTimeout(() => {
      this.unmount();
      this.onClose();
    }, 260);
  }
}
