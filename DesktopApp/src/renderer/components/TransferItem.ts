/**
 * TransferItem.ts
 * Individual transfer row with progress bar, speed, ETA, and action buttons.
 */

import { Component } from './base/Component';
import { IpcClient } from '../core/IpcClient';
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
    this.data = data;
    super.update();
    // Re-attach action listeners — super.update() replaces the DOM element
    // so the previous listeners are gone with the old element
    this.attachActions();
    this.applyProgressWidth();
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
      ? `<svg viewBox="0 0 16 16" fill="currentColor" class="transfer-item__dir-icon">
           <path d="M8 1.5a.75.75 0 01.75.75v8.69l2.97-2.97a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L3.22 9.03a.75.75 0 111.06-1.06L7.25 10.94V2.25A.75.75 0 018 1.5z" transform="rotate(180 8 8)"/>
         </svg>`
      : `<svg viewBox="0 0 16 16" fill="currentColor" class="transfer-item__dir-icon">
           <path d="M8 1.5a.75.75 0 01.75.75v8.69l2.97-2.97a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L3.22 9.03a.75.75 0 111.06-1.06L7.25 10.94V2.25A.75.75 0 018 1.5z"/>
         </svg>`;

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
            <svg viewBox="0 0 12 12" fill="currentColor" class="transfer-item__peer-icon">
              <path d="M6 0a3 3 0 100 6 3 3 0 000-6zM2 9a4 4 0 018 0v1a1 1 0 01-1 1H3a1 1 0 01-1-1V9z"/>
            </svg>
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
            <div class="transfer-item__progress-fill${t.status === TransferStatus.Active ? ' transfer-item__progress-fill--active' : ''}" data-progress="${progress}"></div>
          </div>
          <div class="transfer-item__progress-stats">
            <span class="transfer-item__progress-pct">${progress}%</span>
            ${speed > 0 ? `<span class="transfer-item__size">${formatSpeed(speed)} · ${formatEta(eta)} left</span>` : ''}
          </div>
        </div>
      ` : ''}
      ${t.status === TransferStatus.Failed && t.errorMessage ? `
        <div class="transfer-item__error">${escapeHtml(t.errorMessage)}</div>
      ` : ''}
      <div class="transfer-item__actions">
        ${isActive ? `<button class="btn btn--danger btn--sm transfer-item__cancel" data-id="${t.id}">
          <svg viewBox="0 0 12 12" fill="currentColor" class="btn__icon transfer-item__btn-icon">
            <path d="M2.22 2.22a.75.75 0 011.06 0L6 4.94l2.72-2.72a.75.75 0 111.06 1.06L7.06 6l2.72 2.72a.75.75 0 11-1.06 1.06L6 7.06 3.28 9.78a.75.75 0 01-1.06-1.06L4.94 6 2.22 3.28a.75.75 0 010-1.06z"/>
          </svg>
          Cancel
        </button>` : ''}
        ${t.status === TransferStatus.Completed && savedPath ? `
          <button class="btn btn--ghost btn--sm transfer-item__open-file" data-path="${escapeHtml(savedPath)}">
            <svg viewBox="0 0 12 12" fill="currentColor" class="btn__icon transfer-item__btn-icon">
              <path d="M1.5 1.5h4.25a.75.75 0 010 1.5H3.06l6.22 6.22V6.25a.75.75 0 011.5 0v4.25a.75.75 0 01-.75.75H5.75a.75.75 0 010-1.5h2.97L2.5 3.53v2.72a.75.75 0 01-1.5 0V2.25a.75.75 0 01.75-.75z"/>
            </svg>
            Open
          </button>
          <button class="btn btn--ghost btn--sm transfer-item__open-folder" data-path="${escapeHtml(savedPath)}">
            <svg viewBox="0 0 12 12" fill="currentColor" class="btn__icon transfer-item__btn-icon">
              <path d="M1 2.5A1.5 1.5 0 012.5 1h2.379a1.5 1.5 0 011.06.44l.622.621A.5.5 0 007.207 2.5H9.5A1.5 1.5 0 0111 4v5.5A1.5 1.5 0 019.5 11h-7A1.5 1.5 0 011 9.5v-7z"/>
            </svg>
            Folder
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

  protected onUnmount(): void {}

  /** Set progress bar width via CSS custom property — avoids unsafe-inline style */
  private applyProgressWidth(): void {
    if (!this.element) return;
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
        if (id) IpcClient.cancelTransfer({ transferId: id });
      });
    }

    const openFileBtn = this.element.querySelector('.transfer-item__open-file');
    if (openFileBtn) {
      openFileBtn.addEventListener('click', () => {
        // Use shell.openPath via a custom event (handled in renderer bootstrap)
        const path = (openFileBtn as HTMLElement).dataset['path'];
        if (path) window.dispatchEvent(new CustomEvent('filedrop:open-file', { detail: { path } }));
      });
    }

    const openFolderBtn = this.element.querySelector('.transfer-item__open-folder');
    if (openFolderBtn) {
      openFolderBtn.addEventListener('click', () => {
        const path = (openFolderBtn as HTMLElement).dataset['path'];
        if (path) window.dispatchEvent(new CustomEvent('filedrop:show-in-folder', { detail: { path } }));
      });
    }
  }

  private renderStatusBadge(status: TransferStatus): string {
    const labels: Record<TransferStatus, string> = {
      [TransferStatus.Pending]: 'Waiting',
      [TransferStatus.Connecting]: 'Connecting',
      [TransferStatus.Active]: 'Transferring',
      [TransferStatus.Completed]: 'Done',
      [TransferStatus.Failed]: 'Failed',
      [TransferStatus.Cancelled]: 'Cancelled',
      [TransferStatus.Declined]: 'Declined',
    };
    return `<span class="transfer-item__badge transfer-item__badge--${status}">${labels[status] ?? status}</span>`;
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
