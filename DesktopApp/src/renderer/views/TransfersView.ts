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

    const header = this.el('div', 'view__header');
    header.innerHTML = `
      <div class="view__header-left">
        <h1 class="view__title">Transfers</h1>
        <p class="view__subtitle">Active and completed file transfers</p>
      </div>
    `;

    const content = this.el('div', 'view__content');
    const listMount = this.el('div', 'transfers-view__list-mount');
    content.appendChild(listMount);

    view.appendChild(header);
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
