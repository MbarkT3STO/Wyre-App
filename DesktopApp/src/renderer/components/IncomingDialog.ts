/**
 * IncomingDialog.ts
 * Accept/Reject modal for incoming file transfer requests.
 * Shows sender info, file details, and a 30-second countdown ring.
 */

import { Component } from './base/Component';
import { IpcClient } from '../core/IpcClient';
import { StateManager } from '../core/StateManager';
import { formatFileSize } from '../../shared/utils/formatters';
import type { IncomingRequestPayload } from '../../shared/ipc/IpcContracts';

export class IncomingDialog extends Component {
  private request: IncomingRequestPayload;
  private timeoutSeconds: number;
  private remaining: number;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;
  private svgCircle: SVGCircleElement | null = null;
  private countdownEl: HTMLElement | null = null;
  // circumference = 2πr where r=44 (matches the SVG circle)
  private readonly circumference = 2 * Math.PI * 44;

  constructor(request: IncomingRequestPayload, timeoutSeconds = 30) {
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
          <div class="incoming-dialog__avatar">
            <span class="incoming-dialog__initial">${escapeHtml(initial)}</span>
          </div>
          <span class="incoming-dialog__countdown" aria-live="polite">${this.remaining}</span>
        </div>

        <div class="incoming-dialog__body">
          <h2 class="incoming-dialog__title">
            <span>${escapeHtml(senderName)}</span> wants to send you a file
          </h2>

          <div class="incoming-dialog__file-row">
            <div class="incoming-dialog__file-icon">
              <i class="fa-solid fa-file-lines incoming-dialog__accept-icon"></i>
            </div>
            <div class="incoming-dialog__file-info">
              <span class="incoming-dialog__file-name" title="${escapeHtml(fileName)}">${escapeHtml(fileName)}</span>
              <span class="incoming-dialog__file-size">${formatFileSize(fileSize)}</span>
            </div>
          </div>
        </div>

        <div class="incoming-dialog__actions">
          <button class="incoming-dialog__decline" type="button">Decline</button>
          <button class="incoming-dialog__accept" type="button">
            <i class="fa-solid fa-check incoming-dialog__accept-icon"></i>
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

    // Start countdown
    this.countdownInterval = setInterval(() => {
      this.remaining--;
      this.updateCountdown();
      if (this.remaining <= 0) {
        this.handleDecline();
      }
    }, 1000);

    // Button handlers
    const acceptBtn = this.element.querySelector('.incoming-dialog__accept');
    const declineBtn = this.element.querySelector('.incoming-dialog__decline');

    acceptBtn?.addEventListener('click', () => this.handleAccept());
    declineBtn?.addEventListener('click', () => this.handleDecline());

    // Keyboard: Escape to decline
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.handleDecline();
      if (e.key === 'Enter') this.handleAccept();
    };
    document.addEventListener('keydown', onKeyDown);
    this.addCleanup(() => document.removeEventListener('keydown', onKeyDown));

    // Focus the accept button
    (acceptBtn as HTMLElement)?.focus();
  }

  protected onUnmount(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  private updateCountdown(): void {
    if (this.countdownEl) {
      this.countdownEl.textContent = String(this.remaining);
    }
    if (this.svgCircle) {
      const progress = this.remaining / this.timeoutSeconds;
      const offset = this.circumference * (1 - progress);
      // Use CSS custom property — avoids a blocked inline style assignment
      this.svgCircle.style.setProperty('--ring-dashoffset', String(offset));
    }
  }

  private async handleAccept(): Promise<void> {
    this.cleanup();
    await IpcClient.respondToIncoming({ transferId: this.request.transferId, accepted: true });
    StateManager.setState('pendingIncoming', null);
  }

  private async handleDecline(): Promise<void> {
    this.cleanup();
    await IpcClient.respondToIncoming({ transferId: this.request.transferId, accepted: false });
    StateManager.setState('pendingIncoming', null);
  }

  private cleanup(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
