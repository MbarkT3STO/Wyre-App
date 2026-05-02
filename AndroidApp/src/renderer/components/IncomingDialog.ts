/**
 * IncomingDialog.ts — Android version.
 * Accept/Decline modal with optional save-location picker.
 */

import { Component } from './base/Component';
import { AppBridge } from '../../bridge/AppBridge';
import { formatFileSize, truncateFilename } from '../../shared/utils/formatters';
import type { IncomingRequestEvent } from '../../bridge/WyrePlugin';

export class IncomingDialog extends Component {
  private request: IncomingRequestEvent;
  private timeoutSeconds: number;
  private remaining: number;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;
  private svgCircle: SVGCircleElement | null = null;
  private countdownEl: HTMLElement | null = null;
  private readonly circumference = 2 * Math.PI * 44;
  /** Custom save path chosen by the user — null means use default */
  private customSavePath: string | null = null;

  constructor(request: IncomingRequestEvent, timeoutSeconds = 30) {
    super();
    this.request = request;
    this.timeoutSeconds = timeoutSeconds;
    this.remaining = timeoutSeconds;
  }

  render(): HTMLElement {
    const { senderName, fileName, fileSize } = this.request;
    const initial = senderName.charAt(0).toUpperCase();

    const backdrop = this.el('div', 'incoming-dialog-backdrop');
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-label', `Incoming file from ${senderName}`);

    backdrop.innerHTML = `
      <div class="incoming-dialog">

        <div class="incoming-dialog__avatar-wrap">
          <svg class="incoming-dialog__countdown-ring" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#7C3AED"/>
                <stop offset="50%" stop-color="#A855F7"/>
                <stop offset="100%" stop-color="#EC4899"/>
              </linearGradient>
            </defs>
            <circle class="incoming-dialog__ring-track" cx="50" cy="50" r="44"/>
            <circle class="incoming-dialog__ring-fill" cx="50" cy="50" r="44"/>
          </svg>
          <span class="incoming-dialog__initial">${escapeHtml(initial)}</span>
          <span class="incoming-dialog__countdown" aria-live="polite">${this.remaining}</span>
        </div>

        <div class="incoming-dialog__body">
          <h2 class="incoming-dialog__title">
            <span>${escapeHtml(senderName)}</span> wants to send you a file
          </h2>

          <div class="incoming-dialog__file-row">
            <div class="incoming-dialog__file-icon">
              <i class="fa-solid fa-file-lines"></i>
            </div>
            <div class="incoming-dialog__file-info">
              <span class="incoming-dialog__file-name" title="${escapeHtml(fileName)}">${escapeHtml(truncateFilename(fileName, 40))}</span>
              <span class="incoming-dialog__file-size">${formatFileSize(fileSize)}</span>
            </div>
          </div>

          <!-- Save location row -->
          <div class="incoming-dialog__save-row">
            <div class="incoming-dialog__save-info">
              <i class="fa-solid fa-folder incoming-dialog__save-icon"></i>
              <span class="incoming-dialog__save-path" id="save-path-label">Downloads</span>
            </div>
            <button class="incoming-dialog__save-change" id="change-save-btn" type="button">
              Change
            </button>
          </div>
        </div>

        <div class="incoming-dialog__actions">
          <button class="incoming-dialog__decline" type="button">Decline</button>
          <button class="incoming-dialog__accept" type="button">
            <i class="fa-solid fa-check"></i>
            Accept
          </button>
        </div>

      </div>
    `;

    return backdrop;
  }

  protected onMount(): void {
    if (!this.element) return;

    this.svgCircle = this.element.querySelector('.incoming-dialog__ring-fill');
    this.countdownEl = this.element.querySelector('.incoming-dialog__countdown');

    this.countdownInterval = setInterval(() => {
      this.remaining--;
      this.updateCountdown();
      if (this.remaining <= 0) void this.handleDecline();
    }, 1000);

    this.element.querySelector('.incoming-dialog__accept')
      ?.addEventListener('click', () => { void this.handleAccept(); });
    this.element.querySelector('.incoming-dialog__decline')
      ?.addEventListener('click', () => { void this.handleDecline(); });
    this.element.querySelector('#change-save-btn')
      ?.addEventListener('click', () => { void this.handleChangeSaveLocation(); });

    (this.element.querySelector('.incoming-dialog__accept') as HTMLElement)?.focus();
  }

  protected onUnmount(): void {
    if (this.countdownInterval) { clearInterval(this.countdownInterval); this.countdownInterval = null; }
  }

  private updateCountdown(): void {
    if (this.countdownEl) this.countdownEl.textContent = String(this.remaining);
    if (this.svgCircle) {
      const progress = this.remaining / this.timeoutSeconds;
      const offset = this.circumference * (1 - progress);
      this.svgCircle.style.setProperty('--ring-dashoffset', String(offset));
    }
  }

  private async handleChangeSaveLocation(): Promise<void> {
    // Pause the countdown while the picker is open
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    try {
      const result = await AppBridge.pickFolder();
      if (result) {
        this.customSavePath = result.path;
        const label = this.element?.querySelector('#save-path-label');
        if (label) {
          const parts = result.path.split('/').filter(Boolean);
          label.textContent = parts.slice(-2).join('/') || result.path;
        }
      }
    } catch (_) {
      // User cancelled — keep existing path
    }

    // Resume countdown
    this.countdownInterval = setInterval(() => {
      this.remaining--;
      this.updateCountdown();
      if (this.remaining <= 0) void this.handleDecline();
    }, 1000);
  }

  private async handleAccept(): Promise<void> {
    this.cleanup();
    await AppBridge.respondToIncoming({
      transferId: this.request.transferId,
      accepted: true,
      ...(this.customSavePath ? { savePath: this.customSavePath } : {}),
    });
    this.unmount();
  }

  private async handleDecline(): Promise<void> {
    this.cleanup();
    await AppBridge.respondToIncoming({ transferId: this.request.transferId, accepted: false });
    this.unmount();
  }

  private cleanup(): void {
    if (this.countdownInterval) { clearInterval(this.countdownInterval); this.countdownInterval = null; }
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
