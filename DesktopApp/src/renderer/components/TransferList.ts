/**
 * TransferList.ts
 * Container for all active and past transfers.
 * Manages TransferItem lifecycle.
 */

import { Component } from './base/Component';
import { TransferItem } from './TransferItem';
import { StateManager } from '../core/StateManager';
import { IpcClient } from '../core/IpcClient';
import type { Transfer, TransferRecord } from '../../shared/models/Transfer';
import { TransferStatus } from '../../shared/models/Transfer';

export interface TransferListOptions {
  /** When true, only the active transfers section is rendered (no history). */
  activeOnly?: boolean;
}

export class TransferList extends Component {
  private activeItems: Map<string, TransferItem> = new Map();
  private historyItems: Map<string, TransferItem> = new Map();
  private activeSection: HTMLElement | null = null;
  private historySection: HTMLElement | null = null;
  private readonly activeOnly: boolean;

  constructor(options: TransferListOptions = {}) {
    super();
    this.activeOnly = options.activeOnly ?? false;
  }

  render(): HTMLElement {
    const wrapper = this.el('div', 'transfer-list');

    this.activeSection = this.el('div', 'transfer-list__section');
    if (!this.activeOnly) {
      this.activeSection.innerHTML = `<h3 class="transfer-list__section-title">Active Transfers</h3>`;
    }
    const activeContainer = this.el('div', 'transfer-list__items');
    this.activeSection.appendChild(activeContainer);
    wrapper.appendChild(this.activeSection);

    if (!this.activeOnly) {
      this.historySection = this.el('div', 'transfer-list__section');
      const historyHeader = this.el('div', 'transfer-list__history-header');
      historyHeader.innerHTML = `
        <h3 class="transfer-list__section-title">History</h3>
        <button class="btn btn--ghost btn--sm transfer-list__clear-btn">Clear history</button>
      `;
      const historyContainer = this.el('div', 'transfer-list__items');
      this.historySection.appendChild(historyHeader);
      this.historySection.appendChild(historyContainer);
      wrapper.appendChild(this.historySection);
    }

    return wrapper;
  }

  protected onMount(): void {
    const unsub1 = StateManager.subscribe('activeTransfers', (transfers) => {
      this.syncActive(transfers);
    });
    this.addCleanup(unsub1);

    if (!this.activeOnly) {
      const unsub2 = StateManager.subscribe('transferHistory', (history) => {
        this.syncHistory(history);
      });
      this.addCleanup(unsub2);

      // Clear history button
      const clearBtn = this.element?.querySelector('.transfer-list__clear-btn');
      if (clearBtn) {
        clearBtn.addEventListener('click', async () => {
          await IpcClient.clearHistory();
          StateManager.setState('transferHistory', []);
        });
      }

      this.syncHistory(StateManager.get('transferHistory'));
    }

    // Initial render
    this.syncActive(StateManager.get('activeTransfers'));
  }

  private syncActive(transfers: Map<string, Transfer>): void {
    const container = this.activeSection?.querySelector('.transfer-list__items');
    if (!container) return;

    const activeStatuses = new Set([
      TransferStatus.Active,
      TransferStatus.Connecting,
      TransferStatus.Pending,
    ]);

    const activeTransfers = Array.from(transfers.values()).filter(t => activeStatuses.has(t.status));

    // Remove items no longer active
    for (const [id, item] of this.activeItems) {
      if (!transfers.has(id) || !activeStatuses.has(transfers.get(id)!.status)) {
        item.unmount();
        this.activeItems.delete(id);
      }
    }

    if (activeTransfers.length === 0) {
      if (!container.querySelector('.transfer-list__empty')) {
        container.innerHTML = `<p class="transfer-list__empty">No active transfers</p>`;
      }
      return;
    }

    // Clear empty state
    const emptyEl = container.querySelector('.transfer-list__empty');
    if (emptyEl) emptyEl.remove();

    for (const transfer of activeTransfers) {
      const existing = this.activeItems.get(transfer.id);
      if (existing) {
        existing.updateData(transfer);
      } else {
        const item = new TransferItem(transfer);
        const wrapper = this.el('div');
        container.appendChild(wrapper);
        item.mount(wrapper);
        this.activeItems.set(transfer.id, item);
      }
    }
  }

  private syncHistory(history: TransferRecord[]): void {
    const container = this.historySection?.querySelector('.transfer-list__items');
    if (!container) return;

    // Fix 3: Keyed diff — avoid unmounting unchanged items.
    const newIds = new Set(history.map(r => r.id));

    // (a) Remove items whose IDs are no longer in the new history array
    for (const [id, item] of this.historyItems) {
      if (!newIds.has(id)) {
        item.unmount();
        this.historyItems.delete(id);
      }
    }

    if (history.length === 0) {
      if (!container.querySelector('.transfer-list__empty')) {
        container.innerHTML = `<p class="transfer-list__empty">No transfer history</p>`;
      }
      return;
    }

    // Clear empty state placeholder if present
    const emptyEl = container.querySelector('.transfer-list__empty');
    if (emptyEl) emptyEl.remove();

    // (b) Update existing items; (c) prepend new items to the top
    for (const record of history) {
      const existing = this.historyItems.get(record.id);
      if (existing) {
        // Update in-place if anything changed
        existing.updateData(record);
      } else {
        // New item — prepend to top of container
        const item = new TransferItem(record);
        const wrapper = this.el('div');
        container.insertBefore(wrapper, container.firstChild);
        item.mount(wrapper);
        this.historyItems.set(record.id, item);
      }
    }
  }

  protected onUnmount(): void {
    for (const item of this.activeItems.values()) item.unmount();
    for (const item of this.historyItems.values()) item.unmount();
    this.activeItems.clear();
    this.historyItems.clear();
  }
}
