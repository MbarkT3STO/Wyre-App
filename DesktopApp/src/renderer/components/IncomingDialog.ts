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
  private circumference = 2 * Math.PI * 36; // r=36

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
          <svg class="incoming-dialog__countdown-ring" viewBox="0 0 80 80">
            <circle class="incoming-dialog__ring-track" cx="40" cy="40" r="36" fill="none" stroke-width="3"/>
            <circle class="incoming-dialog__ring-fill" cx="40" cy="40" r="36" fill="none" stroke-width="3"
              stroke-dasharray="${this.circumference}"
              stroke-dashoffset="0"
              transform="rotate(-90 40 40)"/>
          </svg>
          <div class="incoming-dialog__avatar">
            <span class="incoming-dialog__initial">${escapeHtml(initial)}</span>
          </div>
          <span class="incoming-dialog__countdown" aria-live="polite">${this.remaining}</span>
        </div>

        <div class="incoming-dialog__body">
          <h2 class="incoming-dialog__title">
            <strong>${escapeHtml(senderName)}</strong> wants to send you a file
          </h2>

          <div class="incoming-dialog__file-row">
            <svg class="incoming-dialog__file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            <div class="incoming-dialog__file-info">
              <span class="incoming-dialog__file-name" title="${escapeHtml(fileName)}">${escapeHtml(fileName)}</span>
              <span class="incoming-dialog__file-size">${formatFileSize(fileSize)}</span>
            </div>
          </div>
        </div>

        <div class="incoming-dialog__actions">
          <button class="btn btn--ghost incoming-dialog__decline" type="button">Decline</button>
          <button class="btn btn--primary incoming-dialog__accept" type="button">Accept</button>
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
      this.svgCircle.style.strokeDashoffset = String(offset);
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
