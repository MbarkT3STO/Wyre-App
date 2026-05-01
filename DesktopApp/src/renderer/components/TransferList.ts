/**
 * TransferList.ts
 * Container for active transfers, the outgoing send queue, and history.
 * Manages TransferItem lifecycle with keyed diffing.
 */

import { Component } from './base/Component';
import { TransferItem } from './TransferItem';
import { StateManager } from '../core/StateManager';
import { IpcClient } from '../core/IpcClient';
import { formatFileSize } from '../../shared/utils/formatters';
import type { Transfer, TransferRecord } from '../../shared/models/Transfer';
import type { TransferQueueUpdatedPayload } from '../../shared/ipc/IpcContracts';
import { TransferStatus } from '../../shared/models/Transfer';

export interface TransferListOptions {
  /** When true, only the active transfers section is rendered (no history). */
  activeOnly?: boolean;
}

type QueueItem = TransferQueueUpdatedPayload['queue'][number];

export class TransferList extends Component {
  private activeItems: Map<string, TransferItem> = new Map();
  private historyItems: Map<string, TransferItem> = new Map();
  private activeSection: HTMLElement | null = null;
  private queueSection: HTMLElement | null = null;
  private historySection: HTMLElement | null = null;
  private readonly activeOnly: boolean;

  constructor(options: TransferListOptions = {}) {
    super();
    this.activeOnly = options.activeOnly ?? false;
  }

  render(): HTMLElement {
    const wrapper = this.el('div', 'transfer-list');

    // ── Active transfers ──────────────────────────────────────────────────
    this.activeSection = this.el('div', 'transfer-list__section');
    if (!this.activeOnly) {
      this.activeSection.innerHTML = `<h3 class="transfer-list__section-title">Active Transfers</h3>`;
    }
    const activeContainer = this.el('div', 'transfer-list__items');
    this.activeSection.appendChild(activeContainer);
    wrapper.appendChild(this.activeSection);

    // ── Send queue (Up Next) ──────────────────────────────────────────────
    this.queueSection = this.el('div', 'transfer-list__section transfer-list__queue-section');
    this.queueSection.style.display = 'none'; // hidden until queue is non-empty
    this.queueSection.innerHTML = `
      <h3 class="transfer-list__section-title">
        <i class="fa-solid fa-layer-group transfer-list__queue-icon"></i>
        Up Next
      </h3>
      <div class="transfer-list__queue-items"></div>
    `;
    wrapper.appendChild(this.queueSection);

    // ── History ───────────────────────────────────────────────────────────
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
    // Active transfers
    const unsub1 = StateManager.subscribe('activeTransfers', (transfers) => {
      this.syncActive(transfers);
    });
    this.addCleanup(unsub1);

    // Send queue
    const unsubQueue = StateManager.subscribe('sendQueue', (queue) => {
      this.syncQueue(queue);
    });
    this.addCleanup(unsubQueue);

    if (!this.activeOnly) {
      const unsub2 = StateManager.subscribe('transferHistory', (history) => {
        this.syncHistory(history);
      });
      this.addCleanup(unsub2);

      // Clear history button
      const clearBtn = this.element?.querySelector('.transfer-list__clear-btn');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          void IpcClient.clearHistory().then(() => {
            StateManager.setState('transferHistory', []);
          });
        });
      }

      this.syncHistory(StateManager.get('transferHistory'));
    }

    // Initial renders
    this.syncActive(StateManager.get('activeTransfers'));
    this.syncQueue(StateManager.get('sendQueue'));
  }

  // ── Active transfers ────────────────────────────────────────────────────

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
      const current = transfers.get(id);
      if (!current || !activeStatuses.has(current.status)) {
        item.unmount();
        this.activeItems.delete(id);
      }
    }

    if (activeTransfers.length === 0) {
      if (!container.querySelector('.transfer-list__empty')) {
        container.innerHTML = `
          <div class="transfer-list__empty">
            <i class="fa-solid fa-arrow-right-arrow-left transfer-list__empty-icon" aria-hidden="true"></i>
            <p>No active transfers</p>
            <span>Files you send or receive will appear here.</span>
          </div>`;
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
        // New item — prepend so the most recent appears at the top
        const item = new TransferItem(transfer);
        const wrapper = this.el('div');
        container.insertBefore(wrapper, container.firstChild);
        item.mount(wrapper);
        this.activeItems.set(transfer.id, item);
      }
    }
  }

  // ── Send queue (Up Next) ────────────────────────────────────────────────

  private syncQueue(queue: QueueItem[]): void {
    if (!this.queueSection) return;
    const container = this.queueSection.querySelector('.transfer-list__queue-items');
    if (!container) return;

    if (queue.length === 0) {
      this.queueSection.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    this.queueSection.style.display = '';

    container.innerHTML = queue.map((item, idx) => `
      <div class="transfer-queue-item">
        <div class="transfer-queue-item__position">${idx + 1}</div>
        <div class="transfer-queue-item__icon">
          <i class="fa-solid fa-arrow-up"></i>
        </div>
        <div class="transfer-queue-item__meta">
          <span class="transfer-queue-item__name" title="${escapeHtml(item.fileName)}">${escapeHtml(truncate(item.fileName, 40))}</span>
          <span class="transfer-queue-item__size">${formatFileSize(item.fileSize)}</span>
        </div>
        <span class="transfer-queue-item__badge">Queued</span>
      </div>
    `).join('');
  }

  // ── History ─────────────────────────────────────────────────────────────

  private syncHistory(history: TransferRecord[]): void {
    const container = this.historySection?.querySelector('.transfer-list__items');
    if (!container) return;

    const newIds = new Set(history.map(r => r.id));

    // Remove items no longer in history
    for (const [id, item] of this.historyItems) {
      if (!newIds.has(id)) {
        item.unmount();
        this.historyItems.delete(id);
      }
    }

    if (history.length === 0) {
      if (!container.querySelector('.transfer-list__empty')) {
        container.innerHTML = `
          <div class="transfer-list__empty">
            <i class="fa-solid fa-clock-rotate-left transfer-list__empty-icon" aria-hidden="true"></i>
            <p>No transfer history</p>
            <span>Completed, failed, and cancelled transfers will appear here.</span>
          </div>`;
      }
      return;
    }

    const emptyEl = container.querySelector('.transfer-list__empty');
    if (emptyEl) emptyEl.remove();

    for (const record of history) {
      const existing = this.historyItems.get(record.id);
      if (existing) {
        existing.updateData(record);
      } else {
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

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  const ext = str.lastIndexOf('.');
  if (ext > 0 && str.length - ext <= 8) {
    const name = str.slice(0, ext);
    const extension = str.slice(ext);
    return name.slice(0, max - extension.length - 1) + '…' + extension;
  }
  return str.slice(0, max - 1) + '…';
}
