/**
 * HomeView.ts — Android version.
 * Feature 1: Folder send via AppBridge.sendFolder().
 * Feature 2: ClipboardSendBar below the file picker.
 * Feature 3: Multi-device selection (selectedDeviceIds).
 */

import { Component } from '../components/base/Component';
import { DeviceList } from '../components/DeviceList';
import { TransferList } from '../components/TransferList';
import { ClipboardSendBar } from '../components/ClipboardSendBar';
import { StateManager } from '../core/StateManager';
import { AppBridge } from '../../bridge/AppBridge';
import type { ToastContainer } from '../components/ToastContainer';
import { TransferStatus } from '../../shared/models/Transfer';
import { formatFileSize } from '../../shared/utils/formatters';
import type { Device } from '../../shared/models/Device';

interface SelectedFile {
  path: string;
  name: string;
  size: number;
  type: 'file' | 'folder';
}

export class HomeView extends Component {
  private deviceList: DeviceList | null = null;
  private transferList: TransferList | null = null;
  private clipboardBar: ClipboardSendBar | null = null;
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
            <span class="home-view__section-hint">Tap to select — tap again to deselect</span>
          </div>
          <div id="device-list-mount" class="home-view__devices-mount"></div>
        </div>

        <div class="home-view__send-section">
          <div class="home-view__section-header">
            <span class="home-view__section-title">Send Files</span>
            <span class="home-view__section-hint">Pick files or a folder, then tap Send</span>
          </div>
          <div class="home-view__send-body">
            <div class="home-view__target-row">
              <span class="home-view__target-label">To</span>
              <div id="selected-device-info" class="home-view__target-info">
                <div class="home-view__no-device">Select one or more devices above</div>
              </div>
            </div>

            <!-- Android file/folder picker area -->
            <div class="android-file-picker" id="file-picker-area">
              <div class="android-file-picker__empty" id="file-picker-empty">
                <i class="fa-solid fa-folder-open android-file-picker__icon"></i>
                <p class="android-file-picker__label">Tap to pick files</p>
                <span class="android-file-picker__hint">Any file type · folders · multiple files allowed</span>
              </div>
              <div class="android-file-picker__list" id="file-picker-list" style="display:none"></div>
              <div class="android-file-picker__btn-row">
                <button class="android-file-picker__btn" id="pick-file-btn" aria-label="Pick files">
                  <i class="fa-solid fa-file-lines"></i>
                  <span id="pick-btn-label">Pick Files</span>
                </button>
                <button class="android-file-picker__btn android-file-picker__btn--folder" id="pick-folder-btn" aria-label="Pick folder">
                  <i class="fa-solid fa-folder-open"></i>
                  <span>Pick Folder</span>
                </button>
              </div>
            </div>

            <!-- Clipboard send bar (Feature 2) -->
            <div id="clipboard-bar-mount"></div>

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

    // Mount DeviceList (multi-select)
    const deviceListMount = this.element.querySelector('#device-list-mount') as HTMLElement;
    this.deviceList = new DeviceList({
      onSelectionChanged: (ids) => {
        this.updateSelectedDeviceInfo(ids);
        this.updateSendButton();
      },
      onChat: (device) => { void this.handleChatWithDevice(device); },
    });
    this.deviceList.mount(deviceListMount);

    // Pull-to-refresh on the main scroll container
    const scrollContainer = this.element.querySelector('.home-view__scroll') as HTMLElement;
    if (scrollContainer) this.wirePullToRefresh(scrollContainer);

    // Mount TransferList (active only)
    const transferListMount = this.element.querySelector('#transfer-list-mount') as HTMLElement;
    this.transferList = new TransferList({ activeOnly: true });
    this.transferList.mount(transferListMount);

    // Mount ClipboardSendBar (Feature 2)
    const clipboardMount = this.element.querySelector('#clipboard-bar-mount') as HTMLElement;
    this.clipboardBar = new ClipboardSendBar(this.toasts);
    this.clipboardBar.mount(clipboardMount);

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

    // File picker
    const pickFileBtn = this.element.querySelector('#pick-file-btn') as HTMLButtonElement;
    pickFileBtn?.addEventListener('click', () => { void this.handlePickFile(); });

    // Folder picker (Feature 1)
    const pickFolderBtn = this.element.querySelector('#pick-folder-btn') as HTMLButtonElement;
    pickFolderBtn?.addEventListener('click', () => { void this.handlePickFolder(); });

    // Tapping the empty area also opens file picker
    const emptyArea = this.element.querySelector('#file-picker-empty') as HTMLElement;
    emptyArea?.addEventListener('click', () => { void this.handlePickFile(); });

    // Queue updates
    void AppBridge.onTransferQueueUpdated((payload) => {
      this.mainQueueCount = payload.queue.length;
      this.updateQueueIndicator();
    }).then(unsub => this.addCleanup(unsub));

    // Initialise queue indicator from current state
    const initialQueue = StateManager.get('sendQueue');
    this.mainQueueCount = initialQueue.length;
    this.updateQueueIndicator();

    // Selected device changes
    const unsub = StateManager.subscribe('selectedDeviceIds', (ids) => {
      this.updateSelectedDeviceInfo(ids);
      this.updateSendButton();
    });
    this.addCleanup(unsub);

    this.updateSelectedDeviceInfo(StateManager.get('selectedDeviceIds'));
  }

  // ── Device info ────────────────────────────────────────────────────────────

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

  // ── File / folder picking ──────────────────────────────────────────────────

  private async handlePickFile(): Promise<void> {
    const files = await AppBridge.pickFiles();
    if (!files || files.length === 0) return;
    for (const file of files) {
      if (!this.selectedFiles.find(f => f.path === file.path)) {
        this.selectedFiles.push({ ...file, type: 'file' });
      }
    }
    this.renderFileList();
    this.updateSendButton();
  }

  private async handlePickFolder(): Promise<void> {
    const result = await AppBridge.pickFolder();
    if (!result) return;
    const { path, uri } = result;
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
    const folderName = parts[parts.length - 1] ?? path;
    // Store the URI for sending — path is only used for display
    if (!this.selectedFiles.find(f => f.path === uri)) {
      this.selectedFiles.push({ path: uri, name: folderName, size: 0, type: 'folder' });
    }
    this.renderFileList();
    this.updateSendButton();
  }

  private renderFileList(): void {
    if (!this.element) return;
    const emptyEl  = this.element.querySelector('#file-picker-empty') as HTMLElement;
    const listEl   = this.element.querySelector('#file-picker-list') as HTMLElement;
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

    listEl.innerHTML = this.selectedFiles.map((f, idx) => {
      const isFolder = f.type === 'folder';
      const icon = isFolder
        ? `<i class="fa-solid fa-folder android-file-picker__item-icon android-file-picker__item-icon--folder"></i>`
        : `<i class="fa-solid fa-file-lines android-file-picker__item-icon"></i>`;
      return `
        <div class="android-file-picker__item">
          ${icon}
          <div class="android-file-picker__item-info">
            <span class="android-file-picker__item-name">${escapeHtml(f.name)}</span>
            <span class="android-file-picker__item-size">${isFolder ? 'Folder' : formatFileSize(f.size)}</span>
          </div>
          <button class="android-file-picker__item-remove" data-idx="${idx}" aria-label="Remove ${escapeHtml(f.name)}">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      `;
    }).join('');

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

  // ── Send button ────────────────────────────────────────────────────────────

  private updateSendButton(): void {
    if (!this.sendBtn) return;
    const deviceIds = StateManager.get('selectedDeviceIds');
    const hasDevice = deviceIds.length > 0;
    const hasFiles  = this.selectedFiles.length > 0;
    this.sendBtn.disabled = !(hasDevice && hasFiles);

    const label = this.element?.querySelector('#send-btn-label');
    if (!label) return;

    const fileCount   = this.selectedFiles.length;
    const deviceCount = deviceIds.length;
    const total       = fileCount * deviceCount;

    if (deviceCount > 1 && fileCount > 0) {
      label.textContent = `Send to ${deviceCount} devices (${fileCount} item${fileCount > 1 ? 's' : ''} = ${total} transfers)`;
    } else if (fileCount > 1) {
      label.textContent = `Send ${fileCount} Files`;
    } else {
      label.textContent = 'Send';
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

  // ── Send ───────────────────────────────────────────────────────────────────

  private async handleSend(): Promise<void> {
    const deviceIds = StateManager.get('selectedDeviceIds');
    const files = [...this.selectedFiles];
    if (deviceIds.length === 0 || files.length === 0 || !this.sendBtn) return;

    try {
      this.sendBtn.disabled = true;
      const label = this.element?.querySelector('#send-btn-label');
      if (label) label.textContent = 'Sending…';

      // Fan out: each device × each file/folder
      for (const deviceId of deviceIds) {
        for (const file of files) {
          if (file.type === 'folder') {
            await AppBridge.sendFolder({ deviceId, folderUri: file.path, folderName: file.name });
          } else {
            await AppBridge.sendFile({ deviceId, filePath: file.path, fileName: file.name, fileSize: file.size });
          }
        }
      }

      const fileLabel   = files.length === 1 && files[0] ? files[0].name : `${files.length} items`;
      const deviceLabel = deviceIds.length === 1 ? '1 device' : `${deviceIds.length} devices`;
      this.toasts.success(`Sending ${fileLabel} to ${deviceLabel}…`);
      this.selectedFiles = [];
      this.renderFileList();
      this.updateSendButton();
      window.location.hash = '/transfers';
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send';
      this.toasts.error(message);
      this.updateSendButton();
    }
  }

  private async handleChatWithDevice(device: Device): Promise<void> {
    try {
      const session = await AppBridge.chatOpenSession({ deviceId: device.id });
      StateManager.updateChatSession(session);
      StateManager.setState('activeChatSessionId', session.id);
      window.location.hash = '/chat';
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      // Native chat plugin not yet implemented on Android — show a friendly notice
      if (msg.toLowerCase().includes('not implemented')) {
        this.toasts.info('Chat is coming soon for Android');
      } else {
        this.toasts.error(msg || 'Could not start chat');
      }
    }
  }

  private wirePullToRefresh(scrollEl: HTMLElement): void {    let startY = 0;
    let pulling = false;
    let indicator: HTMLElement | null = null;

    scrollEl.addEventListener('touchstart', (e) => {
      if (scrollEl.scrollTop === 0) {
        startY = e.touches[0]!.clientY;
        pulling = true;
      }
    }, { passive: true });

    scrollEl.addEventListener('touchmove', (e) => {
      if (!pulling) return;
      const dy = e.touches[0]!.clientY - startY;
      if (dy > 60) {
        if (!indicator) {
          indicator = document.createElement('div');
          indicator.className = 'pull-refresh-indicator';
          indicator.innerHTML = '<i class="fa-solid fa-arrow-rotate-right"></i>';
          scrollEl.prepend(indicator);
        }
      }
    }, { passive: true });

    scrollEl.addEventListener('touchend', async () => {
      if (!pulling) return;
      pulling = false;
      if (indicator) {
        indicator.classList.add('pull-refresh-indicator--spinning');
        try {
          const devices = await AppBridge.getDevices();
          StateManager.setState('devices', devices);
        } finally {
          indicator.remove();
          indicator = null;
        }
      }
    });
  }

  protected onUnmount(): void {
    this.deviceList?.unmount();
    this.transferList?.unmount();
    this.clipboardBar?.unmount();
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
