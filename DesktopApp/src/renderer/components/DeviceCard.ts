/**
 * DeviceCard.ts
 * Displays a single discovered peer device.
 * Shows avatar, name, IP, platform badge, and online indicator.
 */

import { Component } from './base/Component';
import type { Device } from '../../shared/models/Device';

export interface DeviceCardOptions {
  device: Device;
  selected: boolean;
  onClick: (device: Device) => void;
}

const PLATFORM_ICONS: Record<string, string> = {
  windows: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M0 0h7.5v7.5H0zm8.5 0H16v7.5H8.5zM0 8.5h7.5V16H0zm8.5 0H16V16H8.5z"/></svg>`,
  macos: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M11.182 3.236C10.256 2.178 9.07 1.5 7.5 1.5c-1.57 0-2.756.678-3.682 1.736C2.89 4.294 2.5 5.7 2.5 7c0 1.3.39 2.706 1.318 3.764C4.744 11.822 5.93 12.5 7.5 12.5c1.57 0 2.756-.678 3.682-1.736C12.11 9.706 12.5 8.3 12.5 7c0-1.3-.39-2.706-1.318-3.764zM7.5 0C9.5 0 11 .9 12.2 2.3 13.4 3.7 14 5.3 14 7s-.6 3.3-1.8 4.7C11 13.1 9.5 14 7.5 14s-3.5-.9-4.7-2.3C1.6 10.3 1 8.7 1 7s.6-3.3 1.8-4.7C4 .9 5.5 0 7.5 0z"/></svg>`,
  linux: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 100 16A8 8 0 008 0zm0 2a6 6 0 110 12A6 6 0 018 2z"/></svg>`,
};

const PLATFORM_COLORS: Record<string, string> = {
  windows: '#4FC3F7',
  macos: '#A8A5FF',
  linux: '#81C784',
  unknown: '#8A90A4',
};

export class DeviceCard extends Component {
  private options: DeviceCardOptions;

  constructor(options: DeviceCardOptions) {
    super();
    this.options = options;
  }

  updateOptions(options: Partial<DeviceCardOptions>): void {
    this.options = { ...this.options, ...options };
    super.update();
  }

  render(): HTMLElement {
    const { device, selected, onClick } = this.options;
    const initial = device.name.charAt(0).toUpperCase();
    const platformIcon = PLATFORM_ICONS[device.platform] ?? PLATFORM_ICONS['linux'];
    const platformColor = PLATFORM_COLORS[device.platform] ?? PLATFORM_COLORS['unknown'];

    const card = this.el('div', `device-card${selected ? ' device-card--selected' : ''}`);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `${device.name} — ${device.platform}`);
    card.setAttribute('aria-pressed', String(selected));

    card.innerHTML = `
      <div class="device-card__avatar">
        <span class="device-card__initial">${initial}</span>
        <span class="device-card__platform-icon" style="color: ${platformColor}" title="${device.platform}">
          ${platformIcon}
        </span>
        <span class="device-card__online-dot" aria-label="Online"></span>
      </div>
      <div class="device-card__info">
        <span class="device-card__name">${escapeHtml(device.name)}</span>
        <span class="device-card__ip">${escapeHtml(device.ip)}</span>
        <span class="device-card__platform-badge" style="color: ${platformColor}">
          ${capitalize(device.platform)}
        </span>
      </div>
      ${selected ? `<span class="device-card__check" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>
      </span>` : ''}
    `;

    card.addEventListener('click', () => onClick(device));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick(device);
      }
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
