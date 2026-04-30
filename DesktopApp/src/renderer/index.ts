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
import { ToastContainer } from './components/ToastContainer';
import { IncomingDialog } from './components/IncomingDialog';
import { HomeView } from './views/HomeView';
import { TransfersView } from './views/TransfersView';
import { SettingsView } from './views/SettingsView';
import type { Transfer } from '../shared/models/Transfer';
import { TransferStatus } from '../shared/models/Transfer';

const themeEngine = new ThemeEngine();
const toasts = new ToastContainer();
const router = new Router();

async function bootstrap(): Promise<void> {
  // Load initial settings
  const settings = await IpcClient.getSettings();
  StateManager.setState('settings', settings);
  themeEngine.apply(settings.theme);

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
    <div class="titlebar" id="titlebar">
      ${isMac ? `<div class="titlebar__macos-spacer"></div>` : ''}
      <div class="titlebar__spacer"></div>
      ${!isMac ? `
        <div class="titlebar__controls">
          <button class="titlebar__btn" id="btn-minimize" aria-label="Minimize">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 8a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H2.75A.75.75 0 012 8z"/></svg>
          </button>
          <button class="titlebar__btn" id="btn-maximize" aria-label="Maximize">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2.75 2h10.5c.414 0 .75.336.75.75v10.5a.75.75 0 01-.75.75H2.75a.75.75 0 01-.75-.75V2.75A.75.75 0 012.75 2zm.75 1.5v9h9v-9h-9z"/></svg>
          </button>
          <button class="titlebar__btn titlebar__btn--close" id="btn-close" aria-label="Close">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/></svg>
          </button>
        </div>
      ` : ''}
    </div>
    <div class="app-body">
      <nav class="sidebar" role="navigation" aria-label="Main navigation">
        <div class="sidebar__brand">
          <div class="sidebar__brand-icon">
            <img src="${appIconUrl}" alt="Wyre" draggable="false" />
          </div>
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
        <div class="sidebar__nav">
          <span class="sidebar__nav-label">Menu</span>
          <a href="#/home" class="sidebar__nav-item sidebar__nav-item--active" data-route="/home" role="menuitem">
            <svg class="sidebar__nav-item-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z"/>
            </svg>
            <span class="sidebar__nav-item-label">Home</span>
          </a>
          <a href="#/transfers" class="sidebar__nav-item" data-route="/transfers" role="menuitem">
            <svg class="sidebar__nav-item-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M8 5a1 1 0 100 2h5.586l-1.293 1.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L13.586 5H8zM12 15a1 1 0 100-2H6.414l1.293-1.293a1 1 0 10-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L6.414 15H12z"/>
            </svg>
            <span class="sidebar__nav-item-label">Transfers</span>
          </a>
          <a href="#/settings" class="sidebar__nav-item" data-route="/settings" role="menuitem">
            <svg class="sidebar__nav-item-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/>
            </svg>
            <span class="sidebar__nav-item-label">Settings</span>
          </a>
        </div>
        <div class="sidebar__footer">
          <div class="sidebar__version">v1.0.0</div>
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

  // Transfer started — seeds the renderer state so progress events can land
  const unsubStarted = IpcClient.onTransferStarted((payload) => {
    const existing = StateManager.get('activeTransfers').get(payload.transferId);
    if (!existing) {
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
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Bootstrap
bootstrap().catch((err: unknown) => {
  console.error('Renderer bootstrap failed:', err);
});
