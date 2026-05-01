/**
 * ToastContainer.ts — identical to desktop version.
 */

import { Component } from './base/Component';
import { Toast } from './Toast';
import type { ToastOptions } from './Toast';

const MAX_TOASTS = 3;

export class ToastContainer extends Component {
  private toasts: Toast[] = [];

  render(): HTMLElement {
    const container = this.el('div', 'toast-container');
    container.setAttribute('aria-label', 'Notifications');
    container.setAttribute('aria-live', 'polite');
    return container;
  }

  show(options: ToastOptions): Toast {
    if (this.toasts.length >= MAX_TOASTS) this.toasts[0]?.dismiss();
    const toast = new Toast(options);
    toast.onDismiss = () => {
      const idx = this.toasts.indexOf(toast);
      if (idx >= 0) this.toasts.splice(idx, 1);
    };
    if (this.element) {
      toast.mount(this.element);
      requestAnimationFrame(() => { toast['element']?.classList.add('toast--enter'); });
    }
    this.toasts.push(toast);
    return toast;
  }

  success(message: string, actionLabel?: string, onAction?: () => void): Toast {
    const opts: ToastOptions = { type: 'success', message };
    if (actionLabel !== undefined) opts.actionLabel = actionLabel;
    if (onAction !== undefined) opts.onAction = onAction;
    return this.show(opts);
  }

  error(message: string): Toast { return this.show({ type: 'error', message }); }
  info(message: string): Toast  { return this.show({ type: 'info',  message }); }
  warning(message: string): Toast { return this.show({ type: 'warning', message }); }

  protected onUnmount(): void {
    for (const toast of this.toasts) toast.unmount();
    this.toasts = [];
  }
}
