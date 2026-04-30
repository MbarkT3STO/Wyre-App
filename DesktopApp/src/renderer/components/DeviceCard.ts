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
  // Windows logo — four colored panes
  windows: `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/>
  </svg>`,
  // Apple logo
  macos: `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/>
  </svg>`,
  // Linux / Tux penguin
  linux: `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587.026 1.522.026 1.998-.134.322-.104.648-.257.926-.519l.215.115c.001 0 .001.001.002.001.27.136.57.26.94.333.37.073.82.073 1.33-.013.51-.085 1.09-.272 1.67-.619.58-.347 1.16-.863 1.54-1.567.38-.704.56-1.567.4-2.512-.16-.945-.7-1.93-1.6-2.836-.9-.906-2.1-1.73-3.4-2.43-.65-.35-1.3-.67-1.9-.97-.6-.3-1.15-.58-1.6-.87-.45-.29-.8-.59-1.0-.9-.2-.31-.3-.63-.3-.97 0-.34.1-.68.3-.99.2-.31.5-.6.9-.85.4-.25.9-.46 1.5-.62.6-.16 1.3-.27 2.1-.27.8 0 1.5.11 2.1.27.6.16 1.1.37 1.5.62.4.25.7.54.9.85.2.31.3.65.3.99 0 .34-.1.66-.3.97-.2.31-.55.61-1.0.9-.45.29-1.0.57-1.6.87-.6.3-1.25.62-1.9.97-1.3.7-2.5 1.524-3.4 2.43-.9.906-1.44 1.891-1.6 2.836-.16.945.02 1.808.4 2.512.38.704.96 1.22 1.54 1.567.58.347 1.16.534 1.67.619.51.086.96.086 1.33.013.37-.073.67-.197.94-.333l.215-.115c.278.262.604.415.926.519.476.16 1.411.16 1.998.134.238.482.682.83 1.208.946.75.2 1.69-.004 2.616-.47.864-.465 1.964-.4 2.774-.6.405-.131.766-.267.94-.601.174-.339.143-.804-.106-1.484-.076-.242-.018-.571.04-.97.028-.136.055-.337.055-.536a1.27 1.27 0 00-.132-.602c-.206-.411-.551-.544-.864-.68-.312-.133-.598-.201-.797-.4-.213-.239-.403-.571-.663-.839a.449.449 0 00-.11-.135c.123-.805-.009-1.657-.287-2.489-.589-1.771-1.831-3.47-2.716-4.521-.75-1.067-.974-1.928-1.05-3.02-.065-1.491 1.056-5.965-3.17-6.298-.165-.013-.325-.021-.48-.021zm0 1.201c.135 0 .27.006.405.018 2.76.217 2.46 3.36 2.46 5.481 0 .6.05 1.2.15 1.8.1.6.3 1.2.6 1.8.3.6.7 1.2 1.2 1.8.5.6 1.1 1.2 1.7 1.8.6.6 1.2 1.2 1.7 1.8.5.6.9 1.2 1.1 1.8.2.6.2 1.2 0 1.8-.2.6-.6 1.1-1.1 1.5-.5.4-1.1.7-1.7.9-.6.2-1.2.3-1.8.3-.6 0-1.2-.1-1.8-.3-.6-.2-1.2-.5-1.7-.9-.5-.4-.9-.9-1.1-1.5-.2-.6-.2-1.2 0-1.8.2-.6.6-1.2 1.1-1.8.5-.6 1.1-1.2 1.7-1.8.6-.6 1.2-1.2 1.7-1.8.5-.6.9-1.2 1.2-1.8.3-.6.5-1.2.6-1.8.1-.6.15-1.2.15-1.8 0-2.121-.3-5.264 2.46-5.481.135-.012.27-.018.405-.018z"/>
  </svg>`,
  // Generic device / unknown
  unknown: `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 6a2 2 0 012-2h12a2 2 0 012 2v7a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm2 9h12v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-1z"/>
  </svg>`,
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
