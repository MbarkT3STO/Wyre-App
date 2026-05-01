/**
 * TransfersView.ts
 * Active and history transfers view.
 */

import { Component } from '../components/base/Component';
import { TransferList } from '../components/TransferList';
import { StateManager } from '../core/StateManager';
import { formatFileSize } from '../../shared/utils/formatters';
import { TransferStatus } from '../../shared/models/Transfer';

export class TransfersView extends Component {
  private transferList: TransferList | null = null;
  private statsEl: HTMLElement | null = null;

  render(): HTMLElement {
    const view = this.el('div', 'view transfers-view');

    const scroll = this.el('div', 'transfers-view__scroll');
    const content = this.el('div', 'transfers-view__content');

    const pageTitle = document.createElement('div');
    pageTitle.className = 'view-page-title';
    pageTitle.innerHTML = `
      <h1 class="view-page-title__heading">Transfers</h1>
      <p class="view-page-title__sub">Active and completed file transfers</p>
    `;

    // Stats bar — shows aggregate totals from history
    this.statsEl = document.createElement('div');
    this.statsEl.className = 'transfers-view__stats';
    this.statsEl.setAttribute('aria-label', 'Transfer statistics');

    const listMount = this.el('div', 'transfers-view__list-mount');
    content.appendChild(pageTitle);
    content.appendChild(this.statsEl);
    content.appendChild(listMount);
    scroll.appendChild(content);
    view.appendChild(scroll);

    return view;
  }

  protected onMount(): void {
    const listMount = this.element?.querySelector('.transfers-view__list-mount') as HTMLElement;
    if (!listMount) return;

    this.transferList = new TransferList();
    this.transferList.mount(listMount);

    // Update stats whenever history changes
    const unsub = StateManager.subscribe('transferHistory', () => this.updateStats());
    this.addCleanup(unsub);
    this.updateStats();
  }

  private updateStats(): void {
    if (!this.statsEl) return;
    const history = StateManager.get('transferHistory');

    if (history.length === 0) {
      this.statsEl.innerHTML = '';
      this.statsEl.style.display = 'none';
      return;
    }

    const completed = history.filter(r => r.status === TransferStatus.Completed);
    const sent     = completed.filter(r => r.direction === 'send');
    const received = completed.filter(r => r.direction === 'receive');
    const totalBytes = completed.reduce((sum, r) => sum + r.fileSize, 0);

    this.statsEl.style.display = '';
    this.statsEl.innerHTML = `
      <div class="transfers-view__stat">
        <i class="fa-solid fa-arrow-up transfers-view__stat-icon transfers-view__stat-icon--send" aria-hidden="true"></i>
        <span class="transfers-view__stat-value">${sent.length}</span>
        <span class="transfers-view__stat-label">Sent</span>
      </div>
      <div class="transfers-view__stat-divider" aria-hidden="true"></div>
      <div class="transfers-view__stat">
        <i class="fa-solid fa-arrow-down transfers-view__stat-icon transfers-view__stat-icon--receive" aria-hidden="true"></i>
        <span class="transfers-view__stat-value">${received.length}</span>
        <span class="transfers-view__stat-label">Received</span>
      </div>
      <div class="transfers-view__stat-divider" aria-hidden="true"></div>
      <div class="transfers-view__stat">
        <i class="fa-solid fa-database transfers-view__stat-icon" aria-hidden="true"></i>
        <span class="transfers-view__stat-value">${formatFileSize(totalBytes)}</span>
        <span class="transfers-view__stat-label">Total</span>
      </div>
    `;
  }

  protected onUnmount(): void {
    this.transferList?.unmount();
  }
}
