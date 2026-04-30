/**
 * DeviceList.ts
 * Grid of DeviceCard components. Manages card lifecycle.
 */

import { Component } from './base/Component';
import { DeviceCard } from './DeviceCard';
import { StateManager } from '../core/StateManager';
import type { Device } from '../../shared/models/Device';

export interface DeviceListOptions {
  onDeviceSelect: (device: Device) => void;
}

export class DeviceList extends Component {
  private options: DeviceListOptions;
  private cards: Map<string, DeviceCard> = new Map();
  private gridEl: HTMLElement | null = null;

  constructor(options: DeviceListOptions) {
    super();
    this.options = options;
  }

  render(): HTMLElement {
    const wrapper = this.el('div', 'device-list');

    const heading = this.el('div', 'device-list__heading');
    heading.textContent = 'Nearby Devices';

    this.gridEl = this.el('div', 'device-list__grid');
    wrapper.appendChild(heading);
    wrapper.appendChild(this.gridEl);

    return wrapper;
  }

  protected onMount(): void {
    const unsub = StateManager.subscribe('devices', (devices) => {
      this.syncDevices(devices);
    });
    this.addCleanup(unsub);

    const unsub2 = StateManager.subscribe('selectedDeviceId', () => {
      this.refreshSelectedState();
    });
    this.addCleanup(unsub2);

    // Initial render
    this.syncDevices(StateManager.get('devices'));
  }

  private syncDevices(devices: Device[]): void {
    if (!this.gridEl) return;

    const selectedId = StateManager.get('selectedDeviceId');

    if (devices.length === 0) {
      this.gridEl.innerHTML = `
        <div class="device-list__empty">
          <div class="device-list__searching">
            <div class="device-list__radar-ring device-list__radar-ring--1"></div>
            <div class="device-list__radar-ring device-list__radar-ring--2"></div>
            <div class="device-list__radar-ring device-list__radar-ring--3"></div>
            <i class="fa-solid fa-tower-broadcast device-list__empty-icon"></i>
          </div>
          <p>Searching for devices…</p>
          <span>Make sure other devices are on the same network and have Wyre open.</span>
        </div>
      `;
      // Unmount removed cards
      for (const [id, card] of this.cards) {
        card.unmount();
        this.cards.delete(id);
      }
      return;
    }

    // Remove cards for devices no longer present
    const deviceIds = new Set(devices.map(d => d.id));
    for (const [id, card] of this.cards) {
      if (!deviceIds.has(id)) {
        card.unmount();
        this.cards.delete(id);
      }
    }

    // Clear empty state if present
    const emptyEl = this.gridEl.querySelector('.device-list__empty');
    if (emptyEl) emptyEl.remove();

    // Add or update cards
    for (const device of devices) {
      const existing = this.cards.get(device.id);
      if (existing) {
        existing.updateOptions({ device, selected: device.id === selectedId });
      } else {
        const card = new DeviceCard({
          device,
          selected: device.id === selectedId,
          onClick: (d) => this.options.onDeviceSelect(d),
        });
        card.mount(this.gridEl);
        this.cards.set(device.id, card);
      }
    }
  }

  private refreshSelectedState(): void {
    const selectedId = StateManager.get('selectedDeviceId');
    const devices = StateManager.get('devices');
    for (const device of devices) {
      const card = this.cards.get(device.id);
      if (card) {
        card.updateOptions({ selected: device.id === selectedId });
      }
    }
  }

  protected onUnmount(): void {
    for (const card of this.cards.values()) {
      card.unmount();
    }
    this.cards.clear();
  }
}
