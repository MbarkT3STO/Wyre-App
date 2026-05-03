/**
 * ChatInviteDialog.ts — Android version.
 * Full-screen modal with countdown ring, matching the desktop design.
 */

import { Component } from './base/Component';
import { AppBridge } from '../../bridge/AppBridge';
import { StateManager } from '../core/StateManager';
import type { Router } from '../core/Router';

const TIMEOUT_SECONDS = 30;
const RING_CIRCUMFERENCE = 2 * Math.PI * 44;

export class ChatInviteDialog extends Component {
  private payload: { sessionId: string; peerId: string; peerName: string };
  private router: Router;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;
  private secondsLeft = TIMEOUT_SECONDS;

  constructor(payload: { sessionId: string; peerId: string; peerName: string }, router: Router) {
    super();
    this.payload = payload;
    this.router = router;
  }

  render(): HTMLElement {
    const { peerName } = this.payload;
    const initial = peerName.charAt(0).toUpperCase();

    const backdrop = this.el('div', 'chat-invite-backdrop');
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-label', `Chat invite from ${escapeHtml(peerName)}`);

    backdrop.innerHTML = `
      <div class="chat-invite-modal" role="document">
        <div class="chat-invite-modal__avatar-wrap" aria-hidden="true">
          <svg class="chat-invite-modal__ring" viewBox="0 0 100 100" aria-hidden="true">
            <defs>
              <linearGradient id="inviteRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="hsl(258,85%,65%)" />
                <stop offset="100%" stop-color="hsl(298,85%,65%)" />
              </linearGradient>
            </defs>
            <circle class="chat-invite-modal__ring-track" cx="50" cy="50" r="44" />
            <circle class="chat-invite-modal__ring-fill" cx="50" cy="50" r="44"
              stroke-dasharray="${RING_CIRCUMFERENCE}"
              stroke-dashoffset="0"
              id="chat-invite-ring-fill"
            />
          </svg>
          <div class="chat-invite-modal__avatar">${escapeHtml(initial)}</div>
          <div class="chat-invite-modal__countdown" id="chat-invite-countdown">${TIMEOUT_SECONDS}</div>
        </div>

        <div class="chat-invite-modal__content">
          <h2 class="chat-invite-modal__heading">Incoming Chat Request</h2>
          <p class="chat-invite-modal__peer"><strong>${escapeHtml(peerName)}</strong></p>
          <p class="chat-invite-modal__subtext">wants to start a temporary chat session with you</p>
          <p class="chat-invite-modal__note">
            <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
            Messages are not stored after the session ends
          </p>
        </div>

        <div class="chat-invite-modal__actions">
          <button class="chat-invite-modal__btn chat-invite-modal__btn--decline" id="chat-invite-decline" aria-label="Decline">
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            <span>Decline</span>
          </button>
          <button class="chat-invite-modal__btn chat-invite-modal__btn--accept" id="chat-invite-accept" aria-label="Accept">
            <i class="fa-solid fa-comment-dots" aria-hidden="true"></i>
            <span>Accept</span>
          </button>
        </div>
      </div>
    `;

    return backdrop;
  }

  protected onMount(): void {
    const acceptBtn = this.element?.querySelector('#chat-invite-accept') as HTMLButtonElement | null;
    const declineBtn = this.element?.querySelector('#chat-invite-decline') as HTMLButtonElement | null;

    acceptBtn?.addEventListener('click', () => { void this.handleAccept(); });
    declineBtn?.addEventListener('click', () => { void this.handleDecline(); });

    this.element?.addEventListener('click', (e) => {
      if (e.target === this.element) void this.handleDecline();
    });

    this.startCountdown();
  }

  private startCountdown(): void {
    const ringEl = this.element?.querySelector('#chat-invite-ring-fill') as SVGCircleElement | null;
    const countdownEl = this.element?.querySelector('#chat-invite-countdown') as HTMLElement | null;
    this.secondsLeft = TIMEOUT_SECONDS;

    this.countdownInterval = setInterval(() => {
      this.secondsLeft--;
      if (countdownEl) countdownEl.textContent = String(this.secondsLeft);
      if (ringEl) {
        const offset = RING_CIRCUMFERENCE * (1 - this.secondsLeft / TIMEOUT_SECONDS);
        ringEl.style.strokeDashoffset = String(offset);
      }
      if (this.secondsLeft <= 10) {
        ringEl?.classList.add('chat-invite-modal__ring-fill--urgent');
        countdownEl?.classList.add('chat-invite-modal__countdown--urgent');
      }
      if (this.secondsLeft <= 0) {
        this.clearCountdown();
        void this.handleDecline();
      }
    }, 1000);

    this.addCleanup(() => this.clearCountdown());
  }

  private clearCountdown(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  private async handleAccept(): Promise<void> {
    this.clearCountdown();
    const { sessionId } = this.payload;
    try {
      await AppBridge.chatAcceptInvite({ sessionId });
      StateManager.setState('activeChatSessionId', sessionId);
      this.router.navigate('/chat');
    } catch { /* non-fatal */ }
    this.dismiss();
  }

  private async handleDecline(): Promise<void> {
    this.clearCountdown();
    const { sessionId } = this.payload;
    try {
      await AppBridge.chatDeclineInvite({ sessionId });
    } catch { /* non-fatal */ }
    const invites = StateManager.get('pendingChatInvites');
    StateManager.setState('pendingChatInvites', invites.filter(i => i.sessionId !== sessionId));
    this.dismiss();
  }

  private dismiss(): void {
    const modal = this.element?.querySelector('.chat-invite-modal') as HTMLElement | null;
    if (modal) {
      modal.classList.add('chat-invite-modal--exit');
      setTimeout(() => this.unmount(), 260);
    } else {
      this.unmount();
    }
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
