/**
 * HomeView.ts
 * Main screen: device list + file send UI.
 * Feature 1: multi-file send queue support.
 */

import { Component } from '../components/base/Component';
import { DeviceList } from '../components/DeviceList';
import { FileDropZone } from '../components/FileDropZone';
import type { SelectedFile } from '../components/FileDropZone';
import { TransferList } from '../components/TransferList';
import { StateManager } from '../core/StateManager';
import { IpcClient } from '../core/IpcClient';
import type { Device } from '../../shared/models/Device';
import type { ToastContainer } from '../components/ToastContainer';
import { TransferStatus } from '../../shared/models/Transfer';

export class HomeView extends Component {
  private deviceList: DeviceList | null = null;
  private fileDropZone: FileDropZone | null = null;
  private transferList: TransferList | null = null;
  private toasts: ToastContainer;
  private selectedFiles: SelectedFile[] = [];
  private sendBtn: HTMLButtonElement | null = null;
  private queueIndicator: HTMLElement | null = null;
  /** Number of files queued on the main-process side (from queueUpdated events) */
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
            <span class="home-view__section-hint">Click a device to select it as the transfer target</span>
          </div>
          <div id="device-list-mount" class="home-view__devices-mount"></div>
        </div>

        <div class="home-view__send-section">
          <div class="home-view__section-header">
            <span class="home-view__section-title">Send Files</span>
            <span class="home-view__section-hint">Drop files or click to browse, then hit Send</span>
          </div>
          <div class="home-view__send-body">
            <div class="home-view__target-row">
              <span class="home-view__target-label">To</span>
              <div id="selected-device-info" class="home-view__target-info">
                <div class="home-view__no-device">No device selected — pick one above</div>
              </div>
            </div>
            <div id="file-drop-zone-mount"></div>
            <div class="home-view__send-footer">
              <button class="btn btn--primary home-view__send-btn" id="send-btn" disabled>
                <i class="fa-solid fa-paper-plane btn__icon"></i>
                Send
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
    this.deviceList = new DeviceList({
      onDeviceSelect: (device) => this.handleDeviceSelect(device),
    });
    this.deviceList.mount(deviceListMount);

    // Mount FileDropZone (multi-file)
    const dropZoneMount = this.element.querySelector('#file-drop-zone-mount') as HTMLElement;
    this.fileDropZone = new FileDropZone({
      onFilesSelected: (files) => {
        this.selectedFiles = files;
        this.updateSendButton();
      },
    });
    this.fileDropZone.mount(dropZoneMount);

    // Mount TransferList (active transfers only)
    const transferListMount = this.element.querySelector('#transfer-list-mount') as HTMLElement;
    this.transferList = new TransferList({ activeOnly: true });
    this.transferList.mount(transferListMount);

    // Show/hide the transfers section based on whether there are active transfers
    const transfersSection = this.element.querySelector('#transfers-section') as HTMLElement;
    const updateTransfersVisibility = (transfers: Map<string, import('../../shared/models/Transfer').Transfer>) => {
      const activeStatuses = new Set([TransferStatus.Active, TransferStatus.Connecting, TransferStatus.Pending]);
      const hasActive = Array.from(transfers.values()).some(t => activeStatuses.has(t.status));
      transfersSection?.classList.toggle('home-view__transfers-section--hidden', !hasActive);
    };
    const unsubTransfers = StateManager.subscribe('activeTransfers', updateTransfersVisibility);
    this.addCleanup(unsubTransfers);
    updateTransfersVisibility(StateManager.get('activeTransfers'));

    // Send button and queue indicator
    this.sendBtn = this.element.querySelector('#send-btn') as HTMLButtonElement;
    this.queueIndicator = this.element.querySelector('#queue-indicator') as HTMLElement;
    this.sendBtn?.addEventListener('click', () => { void this.handleSend(); });

    // Subscribe to main-process queue updates (Feature 1)
    const unsubQueue = IpcClient.onTransferQueueUpdated((payload) => {
      this.mainQueueCount = payload.queue.length;
      this.updateQueueIndicator();
    });
    this.addCleanup(unsubQueue);

    // Subscribe to selected device changes
    const unsub = StateManager.subscribe('selectedDeviceId', (id) => {
      this.updateSelectedDeviceInfo(id);
      this.updateSendButton();
    });
    this.addCleanup(unsub);

    // Initial state
    this.updateSelectedDeviceInfo(StateManager.get('selectedDeviceId'));
  }

  private handleDeviceSelect(device: Device): void {
    const current = StateManager.get('selectedDeviceId');
    StateManager.setState('selectedDeviceId', current === device.id ? null : device.id);
  }

  private updateSelectedDeviceInfo(deviceId: string | null): void {
    const infoEl = this.element?.querySelector('#selected-device-info');
    if (!infoEl) return;

    if (!deviceId) {
      infoEl.innerHTML = `<div class="home-view__no-device">No device selected — pick one above</div>`;
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

    // Update button label to reflect file count
    const count = this.selectedFiles.length;
    if (count > 1) {
      this.sendBtn.innerHTML = `<i class="fa-solid fa-paper-plane btn__icon"></i> Send ${count} Files`;
    } else {
      this.sendBtn.innerHTML = `<i class="fa-solid fa-paper-plane btn__icon"></i> Send`;
    }
  }

  private updateQueueIndicator(): void {
    if (!this.queueIndicator) return;
    const label = this.queueIndicator.querySelector('#queue-count-label');
    if (this.mainQueueCount > 0) {
      this.queueIndicator.style.display = 'flex';
      if (label) {
        label.textContent = `${this.mainQueueCount} more file${this.mainQueueCount === 1 ? '' : 's'} queued`;
      }
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
      this.sendBtn.innerHTML = `<i class="fa-solid fa-paper-plane btn__icon"></i> Sending…`;

      // Send files sequentially — each awaited before the next starts
      for (const file of files) {
        const transferId = await IpcClient.sendFile({
          deviceId,
          filePath: file.path,
        });

        // Seed StateManager immediately so TransfersView has the entry
        StateManager.updateTransfer({
          id: transferId,
          direction: 'send',
          status: TransferStatus.Connecting,
          peerId: deviceId,
          peerName: '',
          fileName: file.name,
          fileSize: file.size,
          filePath: file.path,
          bytesTransferred: 0,
          progress: 0,
          speed: 0,
          eta: 0,
          startedAt: Date.now(),
          checksum: '',
        });
      }

      const firstFile = files[0];
      const label = files.length === 1 && firstFile ? firstFile.name : `${files.length} files`;
      this.toasts.success(`Sending ${label}…`);
      this.fileDropZone?.clearSelection();
      this.selectedFiles = [];

      this.resetSendButton();

      // Navigate to transfers view
      window.location.hash = '/transfers';

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send file';
      this.toasts.error(message);
      this.resetSendButton();
      this.updateSendButton();
    }
  }

  private resetSendButton(): void {
    if (!this.sendBtn) return;
    this.sendBtn.innerHTML = `<i class="fa-solid fa-paper-plane btn__icon"></i> Send`;
  }

  protected onUnmount(): void {
    this.deviceList?.unmount();
    this.fileDropZone?.unmount();
    this.transferList?.unmount();
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
