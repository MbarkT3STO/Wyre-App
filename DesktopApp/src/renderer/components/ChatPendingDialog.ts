/**
 * ChatPendingDialog.ts
 * Shown on the SENDER side while waiting for the receiver to accept/decline.
 * Displays the target device name, a pulsing "waiting" indicator, and a
 * Cancel button. Dismisses automatically when the request is resolved.
 */

import { Component } from './base/Component';
import { IpcClient } from '../core/IpcClient';
import { StateManager } from '../core/StateManager';
import type { Router } from '../core/Router';

export class ChatPendingDialog extends Component {
  private sessionId: string;
  private peerName: string;
  private router: Router;
  private unsubResolved: (() => void) | null = null;

  constructor(sessionId: string, peerName: string, router: Router) {
    super();
    this.sessionId = sessionId;
    this.peerName = peerName;
    this.router = router;
  }

  render(): HTMLElement {
    const initial = this.peerName.charAt(0).toUpperCase();

    const backdrop = this.el('div', 'chat-invite-backdrop');
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-label', `Waiting for ${escapeHtml(this.peerName)} to accept`);
    backdrop.setAttribute('aria-live', 'polite');

    backdrop.innerHTML = `
      <div class="chat-invite-modal chat-pending-modal" role="document">

        <!-- Pulsing avatar (no countdown ring — sender doesn't have a timer) -->
        <div class="chat-pending-modal__avatar-wrap" aria-hidden="true">
          <div class="chat-pending-modal__pulse-ring chat-pending-modal__pulse-ring--1"></div>
          <div class="chat-pending-modal__pulse-ring chat-pending-modal__pulse-ring--2"></div>
          <div class="chat-pending-modal__avatar">${escapeHtml(initial)}</div>
        </div>

        <!-- Text content -->
        <div class="chat-invite-modal__content">
          <h2 class="chat-invite-modal__heading">Chat Request Sent</h2>
          <p class="chat-invite-modal__peer"><strong>${escapeHtml(this.peerName)}</strong></p>
          <p class="chat-invite-modal__subtext">Waiting for them to accept your request…</p>
          <p class="chat-invite-modal__note">
            <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
            Messages are not stored after the session ends
          </p>
        </div>

        <!-- Single action: cancel -->
        <div class="chat-invite-modal__actions">
          <button class="chat-invite-modal__btn chat-invite-modal__btn--decline chat-pending-modal__cancel-btn" id="chat-pending-cancel" aria-label="Cancel chat request">
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            <span>Cancel Request</span>
          </button>
        </div>

      </div>
    `;

    return backdrop;
  }

  protected onMount(): void {
    this.element?.querySelector('#chat-pending-cancel')?.addEventListener('click', () => {
      void this.handleCancel();
    });

    // Keyboard: Escape = cancel
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void this.handleCancel();
    };
    document.addEventListener('keydown', onKey);
    this.addCleanup(() => document.removeEventListener('keydown', onKey));

    // Listen for resolution from main process
    this.unsubResolved = IpcClient.onChatRequestResolved((payload) => {
      if (payload.sessionId !== this.sessionId) return;
      this.handleResolution(payload.outcome);
    });
    this.addCleanup(() => this.unsubResolved?.());
  }

  private handleResolution(outcome: 'accepted' | 'declined' | 'cancelled' | 'timeout'): void {
    if (outcome === 'accepted') {
      // Navigate to chat — session is now connected
      StateManager.setState('activeChatSessionId', this.sessionId);
      this.router.navigate('/chat');
      this.dismiss();
    } else {
      // Show brief status then dismiss
      this.showOutcome(outcome);
      setTimeout(() => this.dismiss(), 1800);
    }
  }

  private showOutcome(outcome: 'declined' | 'cancelled' | 'timeout'): void {
    const subtext = this.element?.querySelector('.chat-invite-modal__subtext');
    const cancelBtn = this.element?.querySelector('#chat-pending-cancel') as HTMLButtonElement | null;
    const avatarWrap = this.element?.querySelector('.chat-pending-modal__avatar-wrap') as HTMLElement | null;

    if (cancelBtn) cancelBtn.disabled = true;
    if (avatarWrap) avatarWrap.style.opacity = '0.5';

    const messages: Record<string, string> = {
      declined: 'Request was declined.',
      cancelled: 'Request cancelled.',
      timeout: 'No response — request timed out.',
    };

    if (subtext) subtext.textContent = messages[outcome] ?? 'Request ended.';
  }

  private async handleCancel(): Promise<void> {
    try {
      await IpcClient.chatCancelRequest({ sessionId: this.sessionId });
    } catch { /* non-fatal */ }
    this.dismiss();
  }

  private dismiss(): void {
    const modal = this.element?.querySelector('.chat-invite-modal') as HTMLElement | null;
    if (modal) {
      modal.classList.add('chat-invite-modal--exit');
      setTimeout(() => this.unmount(), 280);
    } else {
      this.unmount();
    }
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
