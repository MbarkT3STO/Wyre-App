/**
 * Toast.ts
 * Individual notification toast component.
 */

import { Component } from './base/Component';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastOptions {
  type: ToastType;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  duration?: number; // ms, default 4000
}

const ICONS: Record<ToastType, string> = {
  success: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>`,
  error: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/></svg>`,
  info: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm6.5-.25A.75.75 0 017.25 7h1a.75.75 0 01.75.75v2.75h.25a.75.75 0 010 1.5h-2a.75.75 0 010-1.5h.25v-2h-.25a.75.75 0 01-.75-.75zM8 6a1 1 0 110-2 1 1 0 010 2z"/></svg>`,
  warning: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8.22 1.754a.25.25 0 00-.44 0L1.698 13.132a.25.25 0 00.22.368h12.164a.25.25 0 00.22-.368L8.22 1.754zm-1.763-.707c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0114.082 15H1.918a1.75 1.75 0 01-1.543-2.575L6.457 1.047zM9 11a1 1 0 11-2 0 1 1 0 012 0zm-.25-5.25a.75.75 0 00-1.5 0v2.5a.75.75 0 001.5 0v-2.5z"/></svg>`,
};

export class Toast extends Component {
  private options: ToastOptions;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;
  onDismiss: (() => void) | null = null;

  constructor(options: ToastOptions) {
    super();
    this.options = options;
  }

  render(): HTMLElement {
    const { type, message, actionLabel } = this.options;

    const toast = this.el('div', `toast toast--${type}`);
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');

    toast.innerHTML = `
      <span class="toast__icon toast__icon--${type}">${ICONS[type]}</span>
      <span class="toast__message">${escapeHtml(message)}</span>
      ${actionLabel ? `<button class="toast__action btn btn--ghost btn--sm">${escapeHtml(actionLabel)}</button>` : ''}
      <button class="toast__close" aria-label="Dismiss">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/></svg>
      </button>
    `;

    return toast;
  }

  protected onMount(): void {
    if (!this.element) return;

    const duration = this.options.duration ?? 4000;

    // Auto-dismiss
    this.dismissTimer = setTimeout(() => this.dismiss(), duration);

    // Close button
    const closeBtn = this.element.querySelector('.toast__close');
    closeBtn?.addEventListener('click', () => this.dismiss());

    // Action button
    const actionBtn = this.element.querySelector('.toast__action');
    if (actionBtn && this.options.onAction) {
      const action = this.options.onAction;
      actionBtn.addEventListener('click', () => {
        action();
        this.dismiss();
      });
    }

    // Pause auto-dismiss on hover
    this.element.addEventListener('mouseenter', () => {
      if (this.dismissTimer) {
        clearTimeout(this.dismissTimer);
        this.dismissTimer = null;
      }
    });

    this.element.addEventListener('mouseleave', () => {
      this.dismissTimer = setTimeout(() => this.dismiss(), 2000);
    });
  }

  dismiss(): void {
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
    if (this.element) {
      this.element.classList.add('toast--exit');
      setTimeout(() => {
        this.unmount();
        this.onDismiss?.();
      }, 300);
    }
  }

  protected onUnmount(): void {
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
    }
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
