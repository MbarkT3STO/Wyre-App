/**
 * TransferItem.ts — adapted for Android (uses AppBridge, no shell.openPath).
 */

import { Component } from './base/Component';
import { AppBridge } from '../../bridge/AppBridge';
import { formatFileSize, formatSpeed, formatEta, formatTimestamp, truncateFilename } from '../../shared/utils/formatters';
import type { Transfer, TransferRecord } from '../../shared/models/Transfer';
import { TransferStatus } from '../../shared/models/Transfer';

export type TransferItemData = Transfer | TransferRecord;

function isActiveTransfer(t: TransferItemData): t is Transfer {
  return 'progress' in t;
}

export class TransferItem extends Component {
  private data: TransferItemData;

  constructor(data: TransferItemData) {
    super();
    this.data = data;
  }

  updateData(data: TransferItemData): void {
    const oldStatus = this.data.status;
    const newStatus = data.status;
    this.data = data;

    const bothActive =
      oldStatus === TransferStatus.Active && newStatus === TransferStatus.Active;

    if (bothActive) {
      this.patchProgress(data);
    } else {
      super.update();
      this.attachActions();
      this.applyProgressWidth();
    }
  }

  private patchProgress(data: TransferItemData): void {
    if (!this.element || !isActiveTransfer(data)) return;
    const { progress, speed, eta } = data;

    const fill = this.element.querySelector<HTMLElement>('.transfer-item__progress-fill');
    if (fill) fill.style.setProperty('--progress-width', `${progress}%`);

    const bar = this.element.querySelector<HTMLElement>('.transfer-item__progress-bar');
    if (bar) bar.setAttribute('aria-valuenow', String(progress));

    const pct = this.element.querySelector<HTMLElement>('.transfer-item__progress-pct');
    if (pct) pct.textContent = `${progress}%`;

    const speedEl = this.element.querySelector<HTMLElement>('.transfer-item__speed');
    if (speedEl && speed > 0) speedEl.textContent = formatSpeed(speed);

    const etaEl = this.element.querySelector<HTMLElement>('.transfer-item__eta');
    if (etaEl && eta > 0) etaEl.textContent = formatEta(eta);
  }

  render(): HTMLElement {
    const t = this.data;
    const isActive = isActiveTransfer(t) && (
      t.status === TransferStatus.Active ||
      t.status === TransferStatus.Connecting ||
      t.status === TransferStatus.Pending
    );

    const row = this.el('div', `transfer-item transfer-item--${t.status}`);
    row.setAttribute('data-transfer-id', t.id);

    const isSend = t.direction === 'send';
    const dirIcon = isSend
      ? `<i class="fa-solid fa-arrow-up transfer-item__dir-icon"></i>`
      : `<i class="fa-solid fa-arrow-down transfer-item__dir-icon"></i>`;

    const statusBadge = this.renderStatusBadge(t.status);
    const progress = isActiveTransfer(t) ? t.progress : (t.status === TransferStatus.Completed ? 100 : 0);
    const speed = isActiveTransfer(t) ? t.speed : 0;
    const eta = isActiveTransfer(t) ? t.eta : 0;
    const savedPath = 'savedPath' in t ? t.savedPath : undefined;

    row.innerHTML = `
      <div class="transfer-item__header">
        <div class="transfer-item__dir-wrap transfer-item__dir-wrap--${isSend ? 'send' : 'receive'}">
          ${dirIcon}
        </div>
        <div class="transfer-item__meta">
          <span class="transfer-item__filename" title="${escapeHtml(t.fileName)}">${escapeHtml(truncateFilename(t.fileName, 32))}</span>
          <span class="transfer-item__peer">
            <i class="fa-solid fa-user transfer-item__peer-icon" aria-hidden="true"></i>
            ${escapeHtml(t.peerName)}
          </span>
        </div>
        <div class="transfer-item__stats">
          <span class="transfer-item__size">${formatFileSize(t.fileSize)}</span>
          ${isActive && speed > 0 ? `<span class="transfer-item__speed">${formatSpeed(speed)}</span>` : ''}
          ${isActive && eta > 0 ? `<span class="transfer-item__eta">${formatEta(eta)}</span>` : ''}
          ${t.completedAt ? `<span class="transfer-item__time">${formatTimestamp(t.completedAt)}</span>` : ''}
        </div>
        ${statusBadge}
      </div>
      ${isActive ? `
        <div class="transfer-item__progress-wrap">
          <div class="transfer-item__progress-bar" role="progressbar" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100">
            <div class="transfer-item__progress-fill${
              t.status === TransferStatus.Active ? ' transfer-item__progress-fill--active'
              : t.status === TransferStatus.Connecting ? ' transfer-item__progress-fill--connecting' : ''
            }" data-progress="${progress}"></div>
          </div>
          <div class="transfer-item__progress-stats">
            <span class="transfer-item__progress-pct">${t.status === TransferStatus.Connecting ? '—' : `${progress}%`}</span>
          </div>
        </div>
      ` : ''}
      ${t.status === TransferStatus.Failed && t.errorMessage ? `
        <div class="transfer-item__error">${escapeHtml(t.errorMessage)}</div>
      ` : ''}
      <div class="transfer-item__actions">
        ${isActive ? `<button class="btn btn--danger btn--sm transfer-item__cancel" data-id="${t.id}">
          <i class="fa-solid fa-xmark btn__icon"></i> Cancel
        </button>` : ''}
        ${t.status === TransferStatus.Completed && savedPath ? `
          <button class="btn btn--ghost btn--sm transfer-item__open-file" data-path="${escapeHtml(savedPath)}">
            <i class="fa-solid fa-arrow-up-right-from-square btn__icon"></i> Open
          </button>
        ` : ''}
      </div>
    `;

    return row;
  }

  protected onMount(): void {
    this.attachActions();
    this.applyProgressWidth();
  }

  private applyProgressWidth(): void {
    if (!this.element) return;
    if (isActiveTransfer(this.data) && this.data.status === TransferStatus.Connecting) return;
    const fill = this.element.querySelector<HTMLElement>('.transfer-item__progress-fill');
    if (!fill) return;
    const progress = isActiveTransfer(this.data) ? this.data.progress : (this.data.status === TransferStatus.Completed ? 100 : 0);
    fill.style.setProperty('--progress-width', `${progress}%`);
  }

  private attachActions(): void {
    if (!this.element) return;

    const cancelBtn = this.element.querySelector('.transfer-item__cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        const id = (cancelBtn as HTMLElement).dataset['id'];
        if (id) void AppBridge.cancelTransfer({ transferId: id });
      });
    }

    const openFileBtn = this.element.querySelector('.transfer-item__open-file');
    if (openFileBtn) {
      openFileBtn.addEventListener('click', () => {
        const path = (openFileBtn as HTMLElement).dataset['path'];
        if (path) void AppBridge.openFile(path);
      });
    }
  }

  private renderStatusBadge(status: TransferStatus): string {
    const isSend = this.data.direction === 'send';
    const labels: Record<TransferStatus, string> = {
      [TransferStatus.Pending]:    'Waiting',
      [TransferStatus.Connecting]: isSend ? 'Awaiting acceptance' : 'Connecting',
      [TransferStatus.Active]:     'Transferring',
      [TransferStatus.Completed]:  'Done',
      [TransferStatus.Failed]:     'Failed',
      [TransferStatus.Cancelled]:  'Cancelled',
      [TransferStatus.Declined]:   'Declined',
    };
    return `<span class="transfer-item__badge transfer-item__badge--${status}">${labels[status] ?? status}</span>`;
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
