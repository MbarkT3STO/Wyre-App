/**
 * Renderer entry point — Android version.
 * Bootstraps the app using AppBridge (Capacitor) instead of Electron IPC.
 */

import './styles/base.css';
import './styles/components.css';
import './styles/animations.css';
import './styles/android.css';

import { AppBridge } from '../bridge/AppBridge';
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
import type { IncomingRequestEvent } from '../bridge/WyrePlugin';

const themeEngine = new ThemeEngine();
const toasts = new ToastContainer();
const router = new Router();

async function bootstrap(): Promise<void> {
  // Load initial settings
  const settings = await AppBridge.getSettings();
  StateManager.setState('settings', settings);
  themeEngine.apply(settings.theme);

  // Load initial devices
  const devices = await AppBridge.getDevices();
  StateManager.setState('devices', devices);

  // Load transfer history
  const history = await AppBridge.getHistory();
  StateManager.setState('transferHistory', history);

  // Build the app shell
  const app = document.getElementById('app');
  if (!app) throw new Error('#app element not found');

  app.innerHTML = buildShell(settings.deviceName);

  // Mount toast container
  const toastMount = document.getElementById('toast-mount');
  if (toastMount) toasts.mount(toastMount);

  // Wire bottom nav
  wireNav();

  // Wire IPC listeners
  await wireEventListeners();

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

  // Update device name in header
  StateManager.subscribe('settings', (s) => {
    if (s) {
      const nameEl = document.getElementById('header-device-name');
      if (nameEl) nameEl.textContent = s.deviceName;
    }
  });
}

function buildShell(deviceName: string): string {
  const initial = deviceName.charAt(0).toUpperCase();

  return `
    <!-- Android status bar spacer (env safe area) -->
    <div class="android-status-bar"></div>

    <!-- Top header bar -->
    <header class="android-header" role="banner">
      <div class="android-header__brand">
        <div class="android-header__logo">
          <img src="icons/icon.png" alt="Wyre" draggable="false" />
        </div>
        <span class="android-header__title">Wyre</span>
      </div>
      <div class="android-header__device">
        <div class="android-header__avatar">${escapeHtml(initial)}</div>
        <span class="android-header__device-name" id="header-device-name">${escapeHtml(deviceName)}</span>
      </div>
    </header>

    <!-- Main content area -->
    <main class="android-content" id="router-outlet" role="main"></main>

    <!-- Bottom navigation bar -->
    <nav class="android-bottom-nav" role="navigation" aria-label="Main navigation">
      <a href="#/home" class="android-bottom-nav__item android-bottom-nav__item--active"
         data-route="/home" role="menuitem" aria-label="Home">
        <i class="fa-solid fa-house android-bottom-nav__icon"></i>
        <span class="android-bottom-nav__label">Home</span>
      </a>
      <a href="#/transfers" class="android-bottom-nav__item"
         data-route="/transfers" role="menuitem" aria-label="Transfers">
        <i class="fa-solid fa-arrow-right-arrow-left android-bottom-nav__icon"></i>
        <span class="android-bottom-nav__label">Transfers</span>
      </a>
      <a href="#/settings" class="android-bottom-nav__item"
         data-route="/settings" role="menuitem" aria-label="Settings">
        <i class="fa-solid fa-gear android-bottom-nav__icon"></i>
        <span class="android-bottom-nav__label">Settings</span>
      </a>
    </nav>

    <div id="toast-mount"></div>
    <div id="dialog-mount"></div>
  `;
}

function wireNav(): void {
  const navItems = document.querySelectorAll('.android-bottom-nav__item');

  const updateActive = (route: string) => {
    navItems.forEach(item => {
      const itemRoute = (item as HTMLElement).dataset['route'];
      item.classList.toggle('android-bottom-nav__item--active', itemRoute === route);
    });
  };

  StateManager.subscribe('currentRoute', (route) => updateActive(route));
  updateActive(StateManager.get('currentRoute'));
}

async function wireEventListeners(): Promise<void> {
  // Device updates
  const unsubDevices = await AppBridge.onDevicesUpdated(({ devices }) => {
    StateManager.setState('devices', devices);
  });

  // Transfer started
  const unsubStarted = await AppBridge.onTransferStarted((payload) => {
    const existing = StateManager.get('activeTransfers').get(payload.transferId);
    if (!existing) {
      StateManager.updateTransfer({
        id: payload.transferId,
        direction: payload.direction,
        status: payload.status as TransferStatus,
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
      StateManager.updateTransfer({
        ...existing,
        status: payload.status as TransferStatus,
        peerName: payload.peerName,
        fileName: payload.fileName,
        fileSize: payload.fileSize,
      });
    }
  });

  // Transfer progress
  const unsubProgress = await AppBridge.onTransferProgress((payload) => {
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
    } else {
      StateManager.updateTransfer({
        id: payload.transferId,
        direction: 'send',
        status: TransferStatus.Active,
        peerId: '',
        peerName: '',
        fileName: '',
        fileSize: payload.totalBytes,
        filePath: '',
        bytesTransferred: payload.bytesTransferred,
        progress: payload.progress,
        speed: payload.speed,
        eta: payload.eta,
        startedAt: Date.now(),
        checksum: '',
      });
    }
  });

  // Transfer complete
  const unsubComplete = await AppBridge.onTransferComplete((payload) => {
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
      if (existing.direction === 'receive') {
        toasts.success(`${existing.fileName} received`, 'Open Folder', () => {
          void AppBridge.showInFolder(payload.savedPath);
        });
      } else {
        toasts.success(`${existing.fileName} sent successfully`);
      }
    }
    void AppBridge.getHistory().then(h => StateManager.setState('transferHistory', h));
  });

  // Transfer error
  const unsubError = await AppBridge.onTransferError((payload) => {
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
    void AppBridge.getHistory().then(h => StateManager.setState('transferHistory', h));
  });

  // Incoming request
  const unsubIncoming = await AppBridge.onIncomingRequest((payload) => {
    const queue = StateManager.get('pendingIncomingQueue');
    StateManager.setState('pendingIncomingQueue', [...queue, payload]);
    if (queue.length === 0) showIncomingDialog(payload);
  });

  // Queue updates
  const unsubQueue = await AppBridge.onTransferQueueUpdated((payload) => {
    StateManager.setState('sendQueue', payload.queue);
  });

  // Cleanup on unload
  window.addEventListener('unload', () => {
    unsubDevices();
    unsubStarted();
    unsubProgress();
    unsubComplete();
    unsubError();
    unsubIncoming();
    unsubQueue();
  });
}

function showIncomingDialog(payload: IncomingRequestEvent): void {
  const dialogMount = document.getElementById('dialog-mount');
  if (!dialogMount) return;

  const settings = StateManager.get('settings');
  const timeout = settings?.autoDeclineTimeout ?? 30;

  const dialog = new IncomingDialog(payload, timeout);

  const originalUnmount = dialog.unmount.bind(dialog);
  dialog.unmount = () => {
    originalUnmount();
    showNextIncomingDialog();
  };

  dialog.mount(dialogMount);
}

function showNextIncomingDialog(): void {
  const queue = StateManager.get('pendingIncomingQueue');
  if (queue.length === 0) return;
  const [, ...remaining] = queue;
  StateManager.setState('pendingIncomingQueue', remaining);
  if (remaining.length > 0) showIncomingDialog(remaining[0]!);
}

function wireCustomEvents(): void {
  window.addEventListener('wyre:theme-change', (e) => {
    const theme = (e as CustomEvent<{ theme: 'dark' | 'light' | 'system' }>).detail.theme;
    themeEngine.apply(theme);
  });
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

bootstrap().catch((err: unknown) => {
  console.error('Renderer bootstrap failed:', err);
});
