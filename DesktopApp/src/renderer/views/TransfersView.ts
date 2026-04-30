/**
 * TransfersView.ts
 * Active and history transfers view.
 */

import { Component } from '../components/base/Component';
import { TransferList } from '../components/TransferList';

export class TransfersView extends Component {
  private transferList: TransferList | null = null;

  render(): HTMLElement {
    const view = this.el('div', 'view transfers-view');

    const content = this.el('div', 'view__content');

    const pageTitle = document.createElement('div');
    pageTitle.className = 'view-page-title';
    pageTitle.innerHTML = `
      <h1 class="view-page-title__heading">Transfers</h1>
      <p class="view-page-title__sub">Active and completed file transfers</p>
    `;

    const listMount = this.el('div', 'transfers-view__list-mount');
    content.appendChild(pageTitle);
    content.appendChild(listMount);

    view.appendChild(content);

    return view;
  }

  protected onMount(): void {
    const listMount = this.element?.querySelector('.transfers-view__list-mount') as HTMLElement;
    if (!listMount) return;

    this.transferList = new TransferList();
    this.transferList.mount(listMount);
  }

  protected onUnmount(): void {
    this.transferList?.unmount();
  }
}
