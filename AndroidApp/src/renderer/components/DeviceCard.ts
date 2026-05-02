/**
 * DeviceCard.ts — adapted for Android (adds android platform icon).
 */

import { Component } from './base/Component';
import type { Device } from '../../shared/models/Device';

export interface DeviceCardOptions {
  device: Device;
  selected: boolean;
  onClick: (device: Device) => void;
}

const PLATFORM_ICONS: Record<string, string> = {
  windows: `<i class="fa-brands fa-windows"></i>`,
  macos:   `<i class="fa-brands fa-apple"></i>`,
  linux:   `<i class="fa-brands fa-linux"></i>`,
  android: `<i class="fa-brands fa-android"></i>`,
  unknown: `<i class="fa-solid fa-desktop"></i>`,
};

export class DeviceCard extends Component {
  private options: DeviceCardOptions;

  constructor(options: DeviceCardOptions) {
    super();
    this.options = options;
  }

  updateOptions(options: Partial<DeviceCardOptions>): void {
    const prevSelected = this.options.selected;
    this.options = { ...this.options, ...options };

    // Always patch in-place — never do a full re-render from an external call.
    // A full replaceChild re-attaches click listeners which causes re-entrant
    // setState calls and freezes the UI.
    if (!this.element) return;

    const selectedChanged = options.selected !== undefined && options.selected !== prevSelected;
    if (selectedChanged) {
      this.element.classList.toggle('device-card--selected', this.options.selected);
      this.element.setAttribute('aria-pressed', String(this.options.selected));

      const existingCheck = this.element.querySelector('.device-card__check');
      if (this.options.selected && !existingCheck) {
        const check = document.createElement('span');
        check.className = 'device-card__check';
        check.setAttribute('aria-hidden', 'true');
        check.innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>`;
        this.element.appendChild(check);
      } else if (!this.options.selected && existingCheck) {
        existingCheck.remove();
      }
    }
  }

  render(): HTMLElement {
    const { device, selected, onClick } = this.options;
    const initial = device.name.charAt(0).toUpperCase();
    const platformIcon = PLATFORM_ICONS[device.platform] ?? PLATFORM_ICONS['unknown'];

    const card = this.el('div', `device-card${selected ? ' device-card--selected' : ''}`);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `${device.name} — ${device.platform}`);
    card.setAttribute('aria-pressed', String(selected));

    card.innerHTML = `
      <div class="device-card__avatar">
        <span class="device-card__initial">${initial}</span>
        <span class="device-card__platform-icon device-card__platform-icon--${device.platform}" title="${device.platform}">
          ${platformIcon}
        </span>
        <span class="device-card__online-dot" aria-label="Online"></span>
      </div>
      <div class="device-card__info">
        <span class="device-card__name">${escapeHtml(device.name)}</span>
        <span class="device-card__ip">${escapeHtml(device.ip)}</span>
        <span class="device-card__platform-badge device-card__platform-badge--${device.platform}">
          ${capitalize(device.platform)}
        </span>
      </div>
      ${selected ? `<span class="device-card__check" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>
      </span>` : ''}
    `;

    card.addEventListener('click', () => onClick(device));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(device); }
    });

    return card;
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
