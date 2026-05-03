/**
 * DeviceList.ts — Android version.
 * Feature 3: multi-device selection via selectedDeviceIds.
 * Patches cards in-place to avoid re-render loops.
 */

import { Component } from './base/Component';
import { DeviceCard } from './DeviceCard';
import { StateManager } from '../core/StateManager';
import type { Device } from '../../shared/models/Device';

export interface DeviceListOptions {
  onSelectionChanged: (selectedIds: string[]) => void;
  onChat?: (device: Device) => void;
}

export class DeviceList extends Component {
  private options: DeviceListOptions;
  private cards: Map<string, DeviceCard> = new Map();
  private gridEl: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;

  constructor(options: DeviceListOptions) {
    super();
    this.options = options;
  }

  render(): HTMLElement {
    const wrapper = this.el('div', 'device-list');

    const headingRow = this.el('div', 'device-list__heading-row');
    headingRow.innerHTML = `
      <span class="device-list__heading">Nearby Devices</span>
      <span class="device-list__selection-badge" id="device-selection-badge" style="display:none"></span>
    `;

    this.gridEl = this.el('div', 'device-list__grid');
    wrapper.appendChild(headingRow);
    wrapper.appendChild(this.gridEl);
    return wrapper;
  }

  protected onMount(): void {
    this.badgeEl = this.element?.querySelector('#device-selection-badge') ?? null;

    const unsub = StateManager.subscribe('devices', (devices) => this.syncDevices(devices));
    this.addCleanup(unsub);

    // Patch selected state in-place — never call super.update() from here
    const unsub2 = StateManager.subscribe('selectedDeviceIds', () => {
      this.refreshSelectedState();
      this.updateBadge();
    });
    this.addCleanup(unsub2);

    this.syncDevices(StateManager.get('devices'));
  }

  private syncDevices(devices: Device[]): void {
    if (!this.gridEl) return;
    const selectedIds = StateManager.get('selectedDeviceIds');

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
      this.cards.forEach(card => card.unmount()); this.cards.clear();
      return;
    }

    const deviceIds = new Set(devices.map(d => d.id));
    for (const [id, card] of this.cards) {
      if (!deviceIds.has(id)) { card.unmount(); this.cards.delete(id); }
    }

    const emptyEl = this.gridEl.querySelector('.device-list__empty');
    if (emptyEl) emptyEl.remove();

    for (const device of devices) {
      const isSelected = selectedIds.includes(device.id);
      const existing = this.cards.get(device.id);
      if (existing) {
        existing.updateOptions({ device, selected: isSelected });
      } else {
        const card = new DeviceCard({
          device,
          selected: isSelected,
          onClick: (d) => this.handleCardClick(d),
          ...(this.options.onChat ? { onChat: (d: Device) => this.options.onChat!(d) } : {}),
        });
        card.mount(this.gridEl);
        this.cards.set(device.id, card);
      }
    }
  }

  private handleCardClick(device: Device): void {
    const current = StateManager.get('selectedDeviceIds');
    let next: string[];
    if (current.includes(device.id)) {
      next = current.filter(id => id !== device.id);
    } else {
      next = [...current, device.id];
    }
    StateManager.setState('selectedDeviceIds', next);
    this.options.onSelectionChanged(next);
  }

  private refreshSelectedState(): void {
    const selectedIds = StateManager.get('selectedDeviceIds');
    const devices = StateManager.get('devices');
    for (const device of devices) {
      const card = this.cards.get(device.id);
      if (card) card.updateOptions({ selected: selectedIds.includes(device.id) });
    }
  }

  private updateBadge(): void {
    if (!this.badgeEl) return;
    const count = StateManager.get('selectedDeviceIds').length;
    if (count > 1) {
      this.badgeEl.textContent = `${count} selected`;
      this.badgeEl.style.display = 'inline-flex';
    } else {
      this.badgeEl.style.display = 'none';
    }
  }

  protected onUnmount(): void {
    for (const card of this.cards.values()) card.unmount();
    this.cards.clear();
  }
}
