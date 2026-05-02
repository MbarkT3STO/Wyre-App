/**
 * HomeView.ts
 * Main screen: device list + file send UI.
 * Feature 1 (Folder Send): sends folders as zips via FOLDER_ZIP_AND_SEND.
 * Feature 2 (Clipboard): mounts ClipboardSendBar below the drop zone.
 * Feature 3 (Multi-device): loops over all selectedDeviceIds on send.
 */

import { Component } from '../components/base/Component';
import { DeviceList } from '../components/DeviceList';
import { FileDropZone } from '../components/FileDropZone';
import type { SelectedFile } from '../components/FileDropZone';
import { TransferList } from '../components/TransferList';
import { ClipboardSendBar } from '../components/ClipboardSendBar';
import { StateManager } from '../core/StateManager';
import { IpcClient } from '../core/IpcClient';
import { appRouter } from '../core/Router';
import type { ToastContainer } from '../components/ToastContainer';
import { TransferStatus } from '../../shared/models/Transfer';

export class HomeView extends Component {
  private deviceList: DeviceList | null = null;
  private fileDropZone: FileDropZone | null = null;
  private transferList: TransferList | null = null;
  private clipboardBar: ClipboardSendBar | null = null;
  private toasts: ToastContainer;
  private selectedFiles: SelectedFile[] = [];
  private sendBtn: HTMLButtonElement | null = null;
  private queueIndicator: HTMLElement | null = null;
  private mainQueueCount = 0;
  private isSending = false;

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
            <span class="home-view__section-hint">Click to select — hold Ctrl/⌘ to pick multiple</span>
          </div>
          <div id="device-list-mount" class="home-view__devices-mount"></div>
        </div>

        <div class="home-view__send-section">
          <div class="home-view__section-header">
            <span class="home-view__section-title">Send Files</span>
            <span class="home-view__section-hint">Drop files or folders, then hit Send</span>
          </div>
          <div class="home-view__send-body">
            <div class="home-view__target-row">
              <span class="home-view__target-label">To</span>
              <div id="selected-device-info" class="home-view__target-info">
                <div class="home-view__no-device">Select one or more devices above</div>
              </div>
            </div>
            <div id="file-drop-zone-mount"></div>
            <div id="clipboard-bar-mount"></div>
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

    // Mount DeviceList (multi-select)
    const deviceListMount = this.element.querySelector('#device-list-mount') as HTMLElement;
    this.deviceList = new DeviceList({
      onSelectionChanged: (ids) => {
        this.updateSelectedDeviceInfo(ids);
        this.updateSendButton();
      },
    });
    this.deviceList.mount(deviceListMount);

    // Mount FileDropZone (multi-file + folder)
    const dropZoneMount = this.element.querySelector('#file-drop-zone-mount') as HTMLElement;
    this.fileDropZone = new FileDropZone({
      onFilesSelected: (files) => {
        this.selectedFiles = files;
        this.updateSendButton();
      },
    });
    this.fileDropZone.mount(dropZoneMount);

    // Mount ClipboardSendBar
    const clipboardMount = this.element.querySelector('#clipboard-bar-mount') as HTMLElement;
    this.clipboardBar = new ClipboardSendBar(this.toasts);
    this.clipboardBar.mount(clipboardMount);

    // Mount TransferList (active transfers only)
    const transferListMount = this.element.querySelector('#transfer-list-mount') as HTMLElement;
    this.transferList = new TransferList({ activeOnly: true });
    this.transferList.mount(transferListMount);

    // Show/hide the transfers section based on active transfers
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

    // Subscribe to main-process queue updates
    const unsubQueue = IpcClient.onTransferQueueUpdated((payload) => {
      this.mainQueueCount = payload.queue.length;
      this.updateQueueIndicator();
    });
    this.addCleanup(unsubQueue);

    // Initialise queue indicator from current state
    const initialQueue = StateManager.get('sendQueue');
    this.mainQueueCount = initialQueue.length;
    this.updateQueueIndicator();

    // Subscribe to selected device changes
    const unsub = StateManager.subscribe('selectedDeviceIds', (ids) => {
      this.updateSelectedDeviceInfo(ids);
      this.updateSendButton();
    });
    this.addCleanup(unsub);

    // Initial state
    this.updateSelectedDeviceInfo(StateManager.get('selectedDeviceIds'));

    // Warn if the user tries to navigate away mid-send
    appRouter.beforeEach((to, from) => {
      if (this.isSending && to !== from) {
        this.toasts.warning('A send is in progress — please wait.');
        return false; // cancel navigation
      }
      return true;
    });
  }

  private updateSelectedDeviceInfo(deviceIds: string[]): void {
    const infoEl = this.element?.querySelector('#selected-device-info');
    if (!infoEl) return;

    if (deviceIds.length === 0) {
      infoEl.innerHTML = `<div class="home-view__no-device">Select one or more devices above</div>`;
      return;
    }

    const devices = StateManager.get('devices');
    const selected = deviceIds
      .map(id => devices.find(d => d.id === id))
      .filter((d): d is NonNullable<typeof d> => d !== undefined);

    if (selected.length === 0) {
      infoEl.innerHTML = `<div class="home-view__no-device">Device not found</div>`;
      return;
    }

    if (selected.length === 1) {
      const device = selected[0]!;
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
    } else {
      // Multiple devices — show chips for each
      const chips = selected.map(device => {
        const initial = device.name.charAt(0).toUpperCase();
        return `
          <div class="home-view__device-chip home-view__device-chip--compact">
            <div class="home-view__device-chip-avatar">${escapeHtml(initial)}</div>
            <div class="home-view__device-chip-name">${escapeHtml(device.name)}</div>
          </div>
        `;
      }).join('');
      infoEl.innerHTML = `<div class="home-view__device-chips">${chips}</div>`;
    }
  }

  private updateSendButton(): void {
    if (!this.sendBtn) return;
    const deviceIds = StateManager.get('selectedDeviceIds');
    const hasDevice = deviceIds.length > 0;
    const hasFiles = this.selectedFiles.length > 0;
    this.sendBtn.disabled = !(hasDevice && hasFiles);

    const fileCount = this.selectedFiles.length;
    const deviceCount = deviceIds.length;
    const totalTransfers = fileCount * deviceCount;

    if (deviceCount > 1 && fileCount > 0) {
      this.sendBtn.innerHTML = `<i class="fa-solid fa-paper-plane btn__icon"></i> Send to ${deviceCount} devices (${fileCount} file${fileCount > 1 ? 's' : ''} = ${totalTransfers} transfers)`;
    } else if (fileCount > 1) {
      this.sendBtn.innerHTML = `<i class="fa-solid fa-paper-plane btn__icon"></i> Send ${fileCount} Files`;
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
    const deviceIds = StateManager.get('selectedDeviceIds');
    const files = [...this.selectedFiles];

    if (deviceIds.length === 0 || files.length === 0 || !this.sendBtn) return;

    this.isSending = true;
    try {
      this.sendBtn.disabled = true;
      this.sendBtn.innerHTML = `<i class="fa-solid fa-paper-plane btn__icon"></i> Sending…`;

      // Fan out: for each device × each file
      for (const deviceId of deviceIds) {
        for (const file of files) {
          if (file.type === 'folder') {
            // Folder: zip on the fly then send
            await IpcClient.folderZipAndSend({ folderPath: file.path, deviceId });
          } else {
            await IpcClient.sendFile({ deviceId, filePath: file.path });
          }
        }
      }

      const fileLabel = files.length === 1 && files[0] ? files[0].name : `${files.length} items`;
      const deviceLabel = deviceIds.length === 1 ? '1 device' : `${deviceIds.length} devices`;
      this.toasts.success(`Sending ${fileLabel} to ${deviceLabel}…`);
      this.fileDropZone?.clearSelection();
      this.selectedFiles = [];

      this.resetSendButton();
      window.location.hash = '/transfers';

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send';
      this.toasts.error(message);
      this.resetSendButton();
      this.updateSendButton();
    } finally {
      this.isSending = false;
    }
  }

  private resetSendButton(): void {
    if (!this.sendBtn) return;
    this.sendBtn.innerHTML = `<i class="fa-solid fa-paper-plane btn__icon"></i> Send`;
  }

  protected onUnmount(): void {
    this.deviceList?.unmount();
    this.fileDropZone?.unmount();
    this.clipboardBar?.unmount();
    this.transferList?.unmount();
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
