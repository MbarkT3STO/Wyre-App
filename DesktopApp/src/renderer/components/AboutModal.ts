/**
 * AboutModal.ts
 * Beautiful "About Wyre" modal — shown when the user clicks the app logo.
 */

import { Component } from './base/Component';
import appIconUrl from '../../../assets/icons/icon.png';

export class AboutModal extends Component {
  private onClose: () => void;

  constructor(onClose: () => void) {
    super();
    this.onClose = onClose;
  }

  render(): HTMLElement {
    const backdrop = this.el('div', 'about-backdrop');
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-label', 'About Wyre');

    backdrop.innerHTML = `
      <div class="about-modal">

        <!-- Close button -->
        <button class="about-modal__close" aria-label="Close">
          <i class="fa-solid fa-xmark"></i>
        </button>

        <!-- Logo -->
        <div class="about-modal__logo-wrap">
          <div class="about-modal__logo-ring about-modal__logo-ring--1"></div>
          <div class="about-modal__logo-ring about-modal__logo-ring--2"></div>
          <div class="about-modal__logo">
            <img src="${appIconUrl}" alt="Wyre" draggable="false" />
          </div>
        </div>

        <!-- App name & version -->
        <div class="about-modal__identity">
          <h1 class="about-modal__name">Wyre</h1>
          <span class="about-modal__version">Version 1.0.0</span>
        </div>

        <!-- Tagline -->
        <p class="about-modal__tagline">
          Seamless peer-to-peer file transfer<br>for your local network.
        </p>

        <!-- Stats row -->
        <div class="about-modal__stats">
          <div class="about-modal__stat">
            <i class="fa-solid fa-bolt about-modal__stat-icon"></i>
            <span class="about-modal__stat-label">Lightning Fast</span>
          </div>
          <div class="about-modal__stat-divider"></div>
          <div class="about-modal__stat">
            <i class="fa-solid fa-shield-halved about-modal__stat-icon"></i>
            <span class="about-modal__stat-label">Secure</span>
          </div>
          <div class="about-modal__stat-divider"></div>
          <div class="about-modal__stat">
            <i class="fa-solid fa-wifi about-modal__stat-icon"></i>
            <span class="about-modal__stat-label">Local Network</span>
          </div>
        </div>

        <!-- Developer -->
        <div class="about-modal__developer">
          <div class="about-modal__dev-avatar">
            <i class="fa-solid fa-code"></i>
          </div>
          <div class="about-modal__dev-info">
            <span class="about-modal__dev-name">MBVRK</span>
            <span class="about-modal__dev-role">Lead Developer &amp; Designer</span>
          </div>
        </div>

        <!-- Footer -->
        <div class="about-modal__footer">
          <span class="about-modal__copyright">© 2026 Wyre. All rights reserved.</span>
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

    // Focus trap — focus the close button
    (this.element.querySelector('.about-modal__close') as HTMLElement)?.focus();
  }

  private dismiss(): void {
    // Play exit animation then unmount
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
