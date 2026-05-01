/**
 * Renderer entry point.
 * Bootstraps the app: loads settings, wires IPC listeners,
 * mounts the shell, and starts the router.
 */

import './styles/base.css';
import './styles/components.css';
import './styles/animations.css';

// Import the app icon so Vite bundles it and gives us a correct asset URL
// that works in both dev and production (file:// protocol).
import appIconUrl from '../../assets/icons/icon.png';

import { IpcClient } from './core/IpcClient';
import { StateManager } from './core/StateManager';
import { Router } from './core/Router';
import { ThemeEngine } from './theme/ThemeEngine';
import { ScaleEngine } from './theme/ScaleEngine';
import { ToastContainer } from './components/ToastContainer';
import { IncomingDialog } from './components/IncomingDialog';
import { HomeView } from './views/HomeView';
import { TransfersView } from './views/TransfersView';
import { SettingsView } from './views/SettingsView';
import { AboutModal } from './components/AboutModal';
import type { Transfer } from '../shared/models/Transfer';
import { TransferStatus } from '../shared/models/Transfer';

const themeEngine = new ThemeEngine();
const scaleEngine = new ScaleEngine();
const toasts = new ToastContainer();
const router = new Router();

async function bootstrap(): Promise<void> {
  // Load initial settings
  const settings = await IpcClient.getSettings();
  StateManager.setState('settings', settings);
  themeEngine.apply(settings.theme);
  scaleEngine.apply(settings.uiScale ?? 1.0);

  // Load initial devices
  const devices = await IpcClient.getDevices();
  StateManager.setState('devices', devices);

  // Load transfer history
  const history = await IpcClient.getHistory();
  StateManager.setState('transferHistory', history);

  // Build the app shell
  const app = document.getElementById('app');
  if (!app) throw new Error('#app element not found');

  app.innerHTML = buildShell(settings.deviceName, IpcClient.getPlatform());

  // Mount toast container
  const toastMount = document.getElementById('toast-mount');
  if (toastMount) toasts.mount(toastMount);

  // Wire title bar controls
  wireTitleBar();

  // Wire sidebar toggle
  wireSidebar();

  // Wire about modal
  wireAbout();

  // Wire IPC listeners
  wireIpcListeners();

  // Wire custom events
  wireCustomEvents();

  // Mount router
  const outlet = document.getElementById('router-outlet');
  if (!outlet) throw new Error('#router-outlet not found');

  router
    .register({ path: '/home', title: 'Home', factory: () => {
      const v = new HomeView(toasts);
      const wrapper = document.createElement('div');
      wrapper.className = 'view-wrapper';
      v.mount(wrapper);
      return wrapper;
    }})
    .register({ path: '/transfers', title: 'Transfers', factory: () => {
      const v = new TransfersView();
      const wrapper = document.createElement('div');
      wrapper.className = 'view-wrapper';
      v.mount(wrapper);
      return wrapper;
    }})
    .register({ path: '/settings', title: 'Settings', factory: () => {
      const v = new SettingsView(toasts);
      const wrapper = document.createElement('div');
      wrapper.className = 'view-wrapper';
      v.mount(wrapper);
      return wrapper;
    }});

  router.mount(outlet as HTMLElement);

  // Wire nav
  wireNav();

  // Update device info in sidebar
  StateManager.subscribe('settings', (s) => {
    if (s) {
      const nameEl = document.getElementById('sidebar-device-name');
      if (nameEl) nameEl.textContent = s.deviceName;
    }
  });
}

function buildShell(deviceName: string, platform: NodeJS.Platform): string {
  const isMac = platform === 'darwin';
  const initial = deviceName.charAt(0).toUpperCase();

  return `
    ${!isMac ? `
    <div class="titlebar" id="titlebar">
      <div class="titlebar__spacer"></div>
      <div class="titlebar__controls">
        <button class="titlebar__btn" id="btn-minimize" aria-label="Minimize">
          <i class="fa-solid fa-minus"></i>
        </button>
        <button class="titlebar__btn" id="btn-maximize" aria-label="Maximize">
          <i class="fa-regular fa-square"></i>
        </button>
        <button class="titlebar__btn titlebar__btn--close" id="btn-close" aria-label="Close">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    </div>
    ` : ''}
    <div class="app-body">
      <nav class="sidebar${isMac ? ' sidebar--macos' : ''}" role="navigation" aria-label="Main navigation">
        <div class="sidebar__brand sidebar__brand--draggable">
          <button class="sidebar__brand-icon" id="about-logo-btn" aria-label="About Wyre">
            <img src="${appIconUrl}" alt="Wyre" draggable="false" />
          </button>
          <span class="sidebar__brand-name">Wyre</span>
        </div>

        <div class="sidebar__header">
          <div class="sidebar__device-card">
            <div class="sidebar__device-avatar">${escapeHtml(initial)}</div>
            <div class="sidebar__device-info">
              <div class="sidebar__device-name" id="sidebar-device-name">${escapeHtml(deviceName)}</div>
              <div class="sidebar__device-status">
                <span class="sidebar__status-dot"></span>
                <span class="sidebar__device-ip" id="sidebar-device-ip">Online</span>
              </div>
            </div>
          </div>
        </div>

        <span class="sidebar__nav-label">Navigation</span>

        <div class="sidebar__nav" role="menubar">
          <a href="#/home" class="sidebar__nav-item sidebar__nav-item--active" data-route="/home" data-tooltip="Home" role="menuitem">
            <i class="fa-solid fa-house sidebar__nav-item-icon" aria-hidden="true"></i>
            <span class="sidebar__nav-item-label">Home</span>
          </a>
          <a href="#/transfers" class="sidebar__nav-item" data-route="/transfers" data-tooltip="Transfers" role="menuitem">
            <i class="fa-solid fa-arrow-right-arrow-left sidebar__nav-item-icon" aria-hidden="true"></i>
            <span class="sidebar__nav-item-label">Transfers</span>
          </a>
          <a href="#/settings" class="sidebar__nav-item" data-route="/settings" data-tooltip="Settings" role="menuitem">
            <i class="fa-solid fa-gear sidebar__nav-item-icon" aria-hidden="true"></i>
            <span class="sidebar__nav-item-label">Settings</span>
          </a>
        </div>

        <div class="sidebar__footer">
          <button class="sidebar__toggle" id="sidebar-toggle" aria-label="Toggle sidebar">
            <i class="fa-solid fa-chevron-left sidebar__toggle-icon"></i>
          </button>
          <span class="sidebar__version">v1.0.0</span>
        </div>
      </nav>
      <main class="main-content" id="router-outlet" role="main"></main>
    </div>
    <div id="toast-mount"></div>
    <div id="dialog-mount"></div>
  `;
}

function wireTitleBar(): void {
  document.getElementById('btn-minimize')?.addEventListener('click', () => IpcClient.minimizeWindow());
  document.getElementById('btn-maximize')?.addEventListener('click', () => IpcClient.maximizeWindow());
  document.getElementById('btn-close')?.addEventListener('click', () => IpcClient.closeWindow());
}

function wireSidebar(): void {
  const sidebar = document.querySelector('.sidebar') as HTMLElement | null;
  const toggleBtn = document.getElementById('sidebar-toggle');
  if (!sidebar || !toggleBtn) return;

  const STORAGE_KEY = 'wyre-sidebar-collapsed';
  const isCollapsed = localStorage.getItem(STORAGE_KEY) === 'true';
  if (isCollapsed) sidebar.classList.add('sidebar--collapsed');

  toggleBtn.addEventListener('click', () => {
    const collapsed = sidebar.classList.toggle('sidebar--collapsed');
    localStorage.setItem(STORAGE_KEY, String(collapsed));
  });
}

function wireAbout(): void {
  const logoBtn = document.getElementById('about-logo-btn');
  const dialogMount = document.getElementById('dialog-mount');
  if (!logoBtn || !dialogMount) return;

  let modal: import('./components/AboutModal').AboutModal | null = null;

  logoBtn.addEventListener('click', () => {
    if (modal) return; // already open
    modal = new AboutModal(() => { modal = null; });
    modal.mount(dialogMount);
  });
}

function wireNav(): void {
  const navItems = document.querySelectorAll('.sidebar__nav-item');

  const updateActive = (route: string) => {
    navItems.forEach(item => {
      const itemRoute = (item as HTMLElement).dataset['route'];
      item.classList.toggle('sidebar__nav-item--active', itemRoute === route);
    });
  };

  StateManager.subscribe('currentRoute', (route) => updateActive(route));
  updateActive(StateManager.get('currentRoute'));
}

function wireIpcListeners(): void {
  // Device updates
  const unsubDevices = IpcClient.onDevicesUpdated(({ devices }) => {
    StateManager.setState('devices', devices);
  });

  // Transfer started — seeds the renderer state so progress events can land.
  // Also fires when a transfer transitions to Active, acting as a re-seed
  // to ensure the sender's entry is always present before progress events arrive.
  const unsubStarted = IpcClient.onTransferStarted((payload) => {
    const existing = StateManager.get('activeTransfers').get(payload.transferId);
    if (!existing) {
      // New transfer — create the entry
      StateManager.updateTransfer({
        id: payload.transferId,
        direction: payload.direction,
        status: payload.status,
        peerId: payload.peerId,
        peerName: payload.peerName,
        fileName: payload.fileName,
        fileSize: payload.fileSize,
        filePath: '',
        bytesTransferred: 0,
        progress: 0,
        speed: 0,
        eta: 0,
        startedAt: Date.now(),
        checksum: '',
      });
    } else {
      // Re-seed: update status and metadata in case it changed (e.g. Connecting → Active)
      StateManager.updateTransfer({
        ...existing,
        status: payload.status,
        peerName: payload.peerName,
        fileName: payload.fileName,
        fileSize: payload.fileSize,
      });
    }
  });

  // Transfer progress
  const unsubProgress = IpcClient.onTransferProgress((payload) => {
    const existing = StateManager.get('activeTransfers').get(payload.transferId);
    if (existing) {
      StateManager.updateTransfer({
        ...existing,
        status: TransferStatus.Active,
        bytesTransferred: payload.bytesTransferred,
        progress: payload.progress,
        speed: payload.speed,
        eta: payload.eta,
      });
    }
    // If existing is not found, the TRANSFER_STARTED re-seed (sent just before
    // this event by IpcBridge) will arrive momentarily and create the entry.
  });

  // Transfer complete
  const unsubComplete = IpcClient.onTransferComplete((payload) => {
    const existing = StateManager.get('activeTransfers').get(payload.transferId);
    if (existing) {
      const completed: Transfer = {
        ...existing,
        status: TransferStatus.Completed,
        progress: 100,
        completedAt: Date.now(),
        savedPath: payload.savedPath,
      };
      StateManager.updateTransfer(completed);
      toasts.success(
        `${existing.fileName} transferred`,
        existing.direction === 'receive' ? 'Show in folder' : undefined,
        existing.direction === 'receive' && payload.savedPath
          ? () => window.dispatchEvent(new CustomEvent('filedrop:show-in-folder', { detail: { path: payload.savedPath } }))
          : undefined,
      );
    }
    // Refresh history
    IpcClient.getHistory().then(h => StateManager.setState('transferHistory', h));
  });

  // Transfer error
  const unsubError = IpcClient.onTransferError((payload) => {
    const existing = StateManager.get('activeTransfers').get(payload.transferId);
    if (existing) {
      StateManager.updateTransfer({
        ...existing,
        status: TransferStatus.Failed,
        completedAt: Date.now(),
        errorMessage: payload.error,
        errorCode: payload.code,
      });
    }
    if (payload.code !== 'CANCELLED' && payload.code !== 'DECLINED') {
      toasts.error(`Transfer failed: ${payload.error}`);
    }
    IpcClient.getHistory().then(h => StateManager.setState('transferHistory', h));
  });

  // Incoming request
  const unsubIncoming = IpcClient.onIncomingRequest((payload) => {
    StateManager.setState('pendingIncoming', payload);
    showIncomingDialog(payload);
  });

  // Cleanup on unload
  window.addEventListener('unload', () => {
    unsubDevices();
    unsubStarted();
    unsubProgress();
    unsubComplete();
    unsubError();
    unsubIncoming();
  });
}

function showIncomingDialog(payload: import('../shared/ipc/IpcContracts').IncomingRequestPayload): void {
  const dialogMount = document.getElementById('dialog-mount');
  if (!dialogMount) return;

  const settings = StateManager.get('settings');
  const timeout = settings?.autoDeclineTimeout ?? 30;

  const dialog = new IncomingDialog(payload, timeout);
  dialog.mount(dialogMount);

  // Remove dialog when pending incoming is cleared
  const unsub = StateManager.subscribe('pendingIncoming', (pending) => {
    if (!pending) {
      dialog.unmount();
      unsub();
    }
  });
}

function wireCustomEvents(): void {
  // These events are dispatched by TransferItem buttons
  window.addEventListener('filedrop:open-file', (e) => {
    const path = (e as CustomEvent<{ path: string }>).detail.path;
    IpcClient.openFile(path).catch((err: unknown) => {
      toasts.error(`Could not open file: ${err instanceof Error ? err.message : String(err)}`);
    });
  });

  window.addEventListener('filedrop:show-in-folder', (e) => {
    const path = (e as CustomEvent<{ path: string }>).detail.path;
    IpcClient.showInFolder(path).catch((err: unknown) => {
      toasts.error(`Could not reveal file: ${err instanceof Error ? err.message : String(err)}`);
    });
  });

  window.addEventListener('filedrop:theme-change', (e) => {
    const theme = (e as CustomEvent<{ theme: 'dark' | 'light' | 'system' }>).detail.theme;
    themeEngine.apply(theme);
  });

  window.addEventListener('filedrop:scale-change', (e) => {
    const scale = (e as CustomEvent<{ scale: import('../shared/models/AppSettings').UiScale }>).detail.scale;
    scaleEngine.apply(scale);
  });
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Bootstrap
bootstrap().catch((err: unknown) => {
  console.error('Renderer bootstrap failed:', err);
});
