/**
 * HomeView.ts — Android version.
 * Uses AppBridge.pickFile() instead of drag-and-drop (not available on Android).
 */

import { Component } from '../components/base/Component';
import { DeviceList } from '../components/DeviceList';
import { TransferList } from '../components/TransferList';
import { StateManager } from '../core/StateManager';
import { AppBridge } from '../../bridge/AppBridge';
import type { Device } from '../../shared/models/Device';
import type { ToastContainer } from '../components/ToastContainer';
import { TransferStatus } from '../../shared/models/Transfer';
import { formatFileSize } from '../../shared/utils/formatters';

interface SelectedFile {
  path: string;
  name: string;
  size: number;
}

export class HomeView extends Component {
  private deviceList: DeviceList | null = null;
  private transferList: TransferList | null = null;
  private toasts: ToastContainer;
  private selectedFiles: SelectedFile[] = [];
  private sendBtn: HTMLButtonElement | null = null;
  private queueIndicator: HTMLElement | null = null;
  private mainQueueCount = 0;

  constructor(toasts: ToastContainer) {
    super();
    this.toasts = toasts;
  }

  render(): HTMLElement {
    const view = this.el('div', 'view home-view');

    view.innerHTML = `
      <div class="home-view__scroll">

        <div class="home-view__devices-section">
          <div class="home-view__section-header">
            <span class="home-view__section-title">Nearby Devices</span>
            <span class="home-view__section-hint">Tap a device to select it</span>
          </div>
          <div id="device-list-mount" class="home-view__devices-mount"></div>
        </div>

        <div class="home-view__send-section">
          <div class="home-view__section-header">
            <span class="home-view__section-title">Send Files</span>
            <span class="home-view__section-hint">Pick files, then tap Send</span>
          </div>
          <div class="home-view__send-body">
            <div class="home-view__target-row">
              <span class="home-view__target-label">To</span>
              <div id="selected-device-info" class="home-view__target-info">
                <div class="home-view__no-device">No device selected — tap one above</div>
              </div>
            </div>

            <!-- Android file picker area (replaces drag-and-drop) -->
            <div class="android-file-picker" id="file-picker-area">
              <div class="android-file-picker__empty" id="file-picker-empty">
                <i class="fa-solid fa-folder-open android-file-picker__icon"></i>
                <p class="android-file-picker__label">Tap to pick files</p>
                <span class="android-file-picker__hint">Any file type · multiple files allowed</span>
              </div>
              <div class="android-file-picker__list" id="file-picker-list" style="display:none"></div>
              <button class="android-file-picker__btn" id="pick-file-btn" aria-label="Pick files">
                <i class="fa-solid fa-folder-open"></i>
                <span id="pick-btn-label">Pick Files</span>
              </button>
            </div>

            <div class="home-view__send-footer">
              <button class="btn btn--primary home-view__send-btn" id="send-btn" disabled>
                <i class="fa-solid fa-paper-plane btn__icon"></i>
                <span id="send-btn-label">Send</span>
              </button>
              <div class="home-view__queue-indicator" id="queue-indicator" style="display:none">
                <i class="fa-solid fa-layer-group"></i>
                <span id="queue-count-label"></span>
              </div>
            </div>
          </div>
        </div>

        <div class="home-view__transfers-section home-view__transfers-section--hidden" id="transfers-section">
          <div id="transfer-list-mount"></div>
        </div>

      </div>
    `;

    return view;
  }

  protected onMount(): void {
    if (!this.element) return;

    // Mount DeviceList
    const deviceListMount = this.element.querySelector('#device-list-mount') as HTMLElement;
    this.deviceList = new DeviceList({ onDeviceSelect: (device) => this.handleDeviceSelect(device) });
    this.deviceList.mount(deviceListMount);

    // Mount TransferList (active only)
    const transferListMount = this.element.querySelector('#transfer-list-mount') as HTMLElement;
    this.transferList = new TransferList({ activeOnly: true });
    this.transferList.mount(transferListMount);

    // Show/hide transfers section
    const transfersSection = this.element.querySelector('#transfers-section') as HTMLElement;
    const updateTransfersVisibility = (transfers: Map<string, import('../../shared/models/Transfer').Transfer>) => {
      const activeStatuses = new Set([TransferStatus.Active, TransferStatus.Connecting, TransferStatus.Pending]);
      const hasActive = Array.from(transfers.values()).some(t => activeStatuses.has(t.status));
      transfersSection?.classList.toggle('home-view__transfers-section--hidden', !hasActive);
    };
    const unsubTransfers = StateManager.subscribe('activeTransfers', updateTransfersVisibility);
    this.addCleanup(unsubTransfers);
    updateTransfersVisibility(StateManager.get('activeTransfers'));

    // Buttons
    this.sendBtn = this.element.querySelector('#send-btn') as HTMLButtonElement;
    this.queueIndicator = this.element.querySelector('#queue-indicator') as HTMLElement;
    this.sendBtn?.addEventListener('click', () => { void this.handleSend(); });

    // File picker button
    const pickBtn = this.element.querySelector('#pick-file-btn') as HTMLButtonElement;
    pickBtn?.addEventListener('click', () => { void this.handlePickFile(); });

    // Also make the empty state area tappable
    const emptyArea = this.element.querySelector('#file-picker-empty') as HTMLElement;
    emptyArea?.addEventListener('click', () => { void this.handlePickFile(); });

    // Queue updates
    void AppBridge.onTransferQueueUpdated((payload) => {
      this.mainQueueCount = payload.queue.length;
      this.updateQueueIndicator();
    }).then(unsub => this.addCleanup(unsub));

    // Selected device changes
    const unsub = StateManager.subscribe('selectedDeviceId', (id) => {
      this.updateSelectedDeviceInfo(id);
      this.updateSendButton();
    });
    this.addCleanup(unsub);

    this.updateSelectedDeviceInfo(StateManager.get('selectedDeviceId'));
  }

  private handleDeviceSelect(device: Device): void {
    const current = StateManager.get('selectedDeviceId');
    StateManager.setState('selectedDeviceId', current === device.id ? null : device.id);
  }

  private async handlePickFile(): Promise<void> {
    const files = await AppBridge.pickFiles();
    if (!files || files.length === 0) return;

    for (const file of files) {
      // Deduplicate by path
      if (!this.selectedFiles.find(f => f.path === file.path)) {
        this.selectedFiles.push(file);
      }
    }

    this.renderFileList();
    this.updateSendButton();
  }

  private renderFileList(): void {
    if (!this.element) return;
    const emptyEl = this.element.querySelector('#file-picker-empty') as HTMLElement;
    const listEl = this.element.querySelector('#file-picker-list') as HTMLElement;
    const pickBtnLabel = this.element.querySelector('#pick-btn-label');

    if (this.selectedFiles.length === 0) {
      emptyEl.style.display = '';
      listEl.style.display = 'none';
      if (pickBtnLabel) pickBtnLabel.textContent = 'Pick Files';
      return;
    }

    emptyEl.style.display = 'none';
    listEl.style.display = '';
    if (pickBtnLabel) pickBtnLabel.textContent = 'Add More';

    listEl.innerHTML = this.selectedFiles.map((f, idx) => `
      <div class="android-file-picker__item">
        <i class="fa-solid fa-file-lines android-file-picker__item-icon"></i>
        <div class="android-file-picker__item-info">
          <span class="android-file-picker__item-name">${escapeHtml(f.name)}</span>
          <span class="android-file-picker__item-size">${formatFileSize(f.size)}</span>
        </div>
        <button class="android-file-picker__item-remove" data-idx="${idx}" aria-label="Remove ${escapeHtml(f.name)}">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    `).join('');

    listEl.querySelectorAll('.android-file-picker__item-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt((btn as HTMLElement).dataset['idx'] ?? '0', 10);
        this.selectedFiles.splice(idx, 1);
        this.renderFileList();
        this.updateSendButton();
      });
    });
  }

  private updateSelectedDeviceInfo(deviceId: string | null): void {
    const infoEl = this.element?.querySelector('#selected-device-info');
    if (!infoEl) return;

    if (!deviceId) {
      infoEl.innerHTML = `<div class="home-view__no-device">No device selected — tap one above</div>`;
      return;
    }

    const device = StateManager.get('devices').find(d => d.id === deviceId);
    if (!device) {
      infoEl.innerHTML = `<div class="home-view__no-device">Device not found</div>`;
      return;
    }

    const initial = device.name.charAt(0).toUpperCase();
    infoEl.innerHTML = `
      <div class="home-view__device-chip">
        <div class="home-view__device-chip-avatar">${escapeHtml(initial)}</div>
        <div class="home-view__device-chip-info">
          <div class="home-view__device-chip-name">${escapeHtml(device.name)}</div>
          <div class="home-view__device-chip-ip">${escapeHtml(device.ip)}</div>
        </div>
        <span class="home-view__device-chip-dot"></span>
      </div>
    `;
  }

  private updateSendButton(): void {
    if (!this.sendBtn) return;
    const hasDevice = StateManager.get('selectedDeviceId') !== null;
    const hasFiles = this.selectedFiles.length > 0;
    this.sendBtn.disabled = !(hasDevice && hasFiles);

    const label = this.element?.querySelector('#send-btn-label');
    if (label) {
      label.textContent = this.selectedFiles.length > 1
        ? `Send ${this.selectedFiles.length} Files`
        : 'Send';
    }
  }

  private updateQueueIndicator(): void {
    if (!this.queueIndicator) return;
    const label = this.queueIndicator.querySelector('#queue-count-label');
    if (this.mainQueueCount > 0) {
      this.queueIndicator.style.display = 'flex';
      if (label) label.textContent = `${this.mainQueueCount} more file${this.mainQueueCount === 1 ? '' : 's'} queued`;
    } else {
      this.queueIndicator.style.display = 'none';
    }
  }

  private async handleSend(): Promise<void> {
    const deviceId = StateManager.get('selectedDeviceId');
    const files = [...this.selectedFiles];
    if (!deviceId || files.length === 0 || !this.sendBtn) return;

    try {
      this.sendBtn.disabled = true;
      const label = this.element?.querySelector('#send-btn-label');
      if (label) label.textContent = 'Sending…';

      for (const file of files) {
        await AppBridge.sendFile({
          deviceId,
          filePath: file.path,
          fileName: file.name,
          fileSize: file.size,
        });
      }

      const firstFile = files[0];
      const displayLabel = files.length === 1 && firstFile ? firstFile.name : `${files.length} files`;
      this.toasts.success(`Sending ${displayLabel}…`);
      this.selectedFiles = [];
      this.renderFileList();
      this.updateSendButton();

      window.location.hash = '/transfers';
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send file';
      this.toasts.error(message);
      this.updateSendButton();
    }
  }

  protected onUnmount(): void {
    this.deviceList?.unmount();
    this.transferList?.unmount();
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
