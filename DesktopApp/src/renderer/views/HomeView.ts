/**
 * HomeView.ts
 * Main screen: device list + file send UI.
 */

import { Component } from '../components/base/Component';
import { DeviceList } from '../components/DeviceList';
import { FileDropZone } from '../components/FileDropZone';
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
  private selectedFile: { path: string; name: string; size: number } | null = null;
  private sendBtn: HTMLButtonElement | null = null;

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
            <span class="home-view__section-title">Send a File</span>
            <span class="home-view__section-hint">Drop a file or click to browse, then hit Send</span>
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
                <svg viewBox="0 0 16 16" fill="currentColor" class="btn__icon">
                  <path d="M1.5 1.75a.75.75 0 011.28-.53l10.5 6.25a.75.75 0 010 1.06l-10.5 6.25A.75.75 0 011.5 14.25V1.75z"/>
                </svg>
                Send File
              </button>
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

    // Mount FileDropZone
    const dropZoneMount = this.element.querySelector('#file-drop-zone-mount') as HTMLElement;
    this.fileDropZone = new FileDropZone({
      onFileSelected: (path, name, size) => {
        this.selectedFile = { path, name, size };
        this.updateSendButton();
      },
    });
    this.fileDropZone.mount(dropZoneMount);

    // Mount TransferList (active transfers only — history lives in the Transfers tab)
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

    // Send button
    this.sendBtn = this.element.querySelector('#send-btn') as HTMLButtonElement;
    this.sendBtn?.addEventListener('click', () => this.handleSend());

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
    const hasFile = this.selectedFile !== null;
    this.sendBtn.disabled = !(hasDevice && hasFile);
  }

  private async handleSend(): Promise<void> {
    const deviceId = StateManager.get('selectedDeviceId');
    const file = this.selectedFile;

    if (!deviceId || !file) return;

    try {
      this.sendBtn!.disabled = true;
      this.sendBtn!.textContent = 'Sending…';

      await IpcClient.sendFile({
        deviceId,
        filePath: file.path,
      });

      this.toasts.success(`Sending ${file.name}…`);
      this.fileDropZone?.clearSelection();
      this.selectedFile = null;

      // Reset button before navigating away so it's correct when the user returns
      this.resetSendButton();

      // Navigate to transfers view so TransferList is mounted and subscribed
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
    this.sendBtn.innerHTML = `
      <svg viewBox="0 0 16 16" fill="currentColor" class="btn__icon">
        <path d="M1.5 1.75a.75.75 0 011.28-.53l10.5 6.25a.75.75 0 010 1.06l-10.5 6.25A.75.75 0 011.5 14.25V1.75z"/>
      </svg>
      Send File
    `;
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
