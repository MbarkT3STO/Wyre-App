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

export class TransferList extends Component {
  private activeItems: Map<string, TransferItem> = new Map();
  private historyItems: Map<string, TransferItem> = new Map();
  private activeSection: HTMLElement | null = null;
  private historySection: HTMLElement | null = null;

  render(): HTMLElement {
    const wrapper = this.el('div', 'transfer-list');

    this.activeSection = this.el('div', 'transfer-list__section');
    this.activeSection.innerHTML = `<h3 class="transfer-list__section-title">Active Transfers</h3>`;
    const activeContainer = this.el('div', 'transfer-list__items');
    this.activeSection.appendChild(activeContainer);

    this.historySection = this.el('div', 'transfer-list__section');
    const historyHeader = this.el('div', 'transfer-list__history-header');
    historyHeader.innerHTML = `
      <h3 class="transfer-list__section-title">History</h3>
      <button class="btn btn--ghost btn--sm transfer-list__clear-btn">Clear history</button>
    `;
    const historyContainer = this.el('div', 'transfer-list__items');
    this.historySection.appendChild(historyHeader);
    this.historySection.appendChild(historyContainer);

    wrapper.appendChild(this.activeSection);
    wrapper.appendChild(this.historySection);

    return wrapper;
  }

  protected onMount(): void {
    const unsub1 = StateManager.subscribe('activeTransfers', (transfers) => {
      this.syncActive(transfers);
    });
    this.addCleanup(unsub1);

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

    // Initial render
    this.syncActive(StateManager.get('activeTransfers'));
    this.syncHistory(StateManager.get('transferHistory'));
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

    // Unmount all and re-render (history is append-only from top)
    for (const item of this.historyItems.values()) {
      item.unmount();
    }
    this.historyItems.clear();
    container.innerHTML = '';

    if (history.length === 0) {
      container.innerHTML = `<p class="transfer-list__empty">No transfer history</p>`;
      return;
    }

    for (const record of history) {
      const item = new TransferItem(record);
      const wrapper = this.el('div');
      container.appendChild(wrapper);
      item.mount(wrapper);
      this.historyItems.set(record.id, item);
    }
  }

  protected onUnmount(): void {
    for (const item of this.activeItems.values()) item.unmount();
    for (const item of this.historyItems.values()) item.unmount();
    this.activeItems.clear();
    this.historyItems.clear();
  }
}
