/**
 * ShellBuilder.ts
 * Builds and mounts the app shell HTML, then wires all DOM-level interactions:
 * nav highlighting, title bar buttons, sidebar toggle, and about modal.
 */

import appIconUrl from '../../../assets/icons/icon.png';
import { IpcClient } from '../core/IpcClient';
import { StateManager } from '../core/StateManager';
import { Router } from '../core/Router';
import type { ToastContainer } from '../components/ToastContainer';
import type { AboutModal } from '../components/AboutModal';
import type { AppSettings } from '../../shared/models/AppSettings';

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
          <a href="#/chat" class="sidebar__nav-item" data-route="/chat" data-tooltip="Chat" role="menuitem" id="nav-chat">
            <i class="fa-solid fa-comments sidebar__nav-item-icon" aria-hidden="true"></i>
            <span class="sidebar__nav-item-label">Chat</span>
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
  document.getElementById('btn-minimize')?.addEventListener('click', () => { void IpcClient.minimizeWindow(); });
  document.getElementById('btn-maximize')?.addEventListener('click', () => { void IpcClient.maximizeWindow(); });
  document.getElementById('btn-close')?.addEventListener('click', () => { void IpcClient.closeWindow(); });
}

function wireSidebar(): void {
  const sidebar = document.querySelector<HTMLElement>('.sidebar');
  const toggleBtn = document.getElementById('sidebar-toggle');
  if (!sidebar || !toggleBtn) return;

  const STORAGE_KEY = 'wyre-sidebar-collapsed';
  const isCollapsed = localStorage.getItem(STORAGE_KEY) === 'true';
  if (isCollapsed) sidebar.classList.add('sidebar--collapsed');

  toggleBtn.addEventListener('click', () => {
    const collapsed = sidebar.classList.toggle('sidebar--collapsed');
    localStorage.setItem(STORAGE_KEY, String(collapsed));
  });

  const tooltip = document.createElement('div');
  tooltip.className = 'sidebar-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.setAttribute('aria-hidden', 'true');
  document.body.appendChild(tooltip);

  let tooltipTimeout: ReturnType<typeof setTimeout> | null = null;

  const showTooltip = (item: HTMLElement): void => {
    const label = item.dataset['tooltip'];
    if (!label || !sidebar.classList.contains('sidebar--collapsed')) return;

    tooltip.textContent = label;
    tooltip.classList.add('sidebar-tooltip--visible');

    const rect = item.getBoundingClientRect();
    tooltip.style.top = `${rect.top + rect.height / 2}px`;
    tooltip.style.left = `${rect.right + 12}px`;
  };

  const hideTooltip = (): void => {
    tooltip.classList.remove('sidebar-tooltip--visible');
  };

  document.querySelectorAll<HTMLElement>('.sidebar__nav-item[data-tooltip]').forEach((item) => {
    item.addEventListener('mouseenter', () => {
      if (tooltipTimeout) clearTimeout(tooltipTimeout);
      tooltipTimeout = setTimeout(() => showTooltip(item), 80);
    });
    item.addEventListener('mouseleave', () => {
      if (tooltipTimeout) clearTimeout(tooltipTimeout);
      hideTooltip();
    });
    item.addEventListener('click', hideTooltip);
  });

  toggleBtn.addEventListener('click', hideTooltip);
}

function wireAbout(): void {
  const logoBtn = document.getElementById('about-logo-btn');
  const dialogMount = document.getElementById('dialog-mount');
  if (!logoBtn || !dialogMount) return;

  let modal: AboutModal | null = null;

  logoBtn.addEventListener('click', () => {
    if (modal) return;
    import('../components/AboutModal').then(({ AboutModal: AboutModalClass }) => {
      modal = new AboutModalClass(() => { modal = null; });
      modal.mount(dialogMount);
    }).catch(() => { /* non-fatal */ });
  });
}

function wireNav(router: Router): void {
  const navItems = document.querySelectorAll('.sidebar__nav-item');

  const updateActive = (route: string) => {
    navItems.forEach(item => {
      const itemRoute = (item as HTMLElement).dataset['route'];
      item.classList.toggle('sidebar__nav-item--active', itemRoute === route);
    });
  };

  StateManager.subscribe('currentRoute', (route) => updateActive(route));
  updateActive(StateManager.get('currentRoute'));

  // Suppress unused-variable warning — router is passed for future guard wiring
  void router;
}

/**
 * Builds the shell HTML, injects it into #app, mounts the toast container,
 * and wires all DOM-level interactions.
 */
export function mountShell(
  settings: AppSettings,
  toasts: ToastContainer,
  router: Router,
): void {
  const appEl = document.getElementById('app');
  if (!appEl) throw new Error('#app element not found');

  appEl.innerHTML = buildShell(settings.deviceName, IpcClient.getPlatform());

  // Mount toast container
  const toastMount = document.getElementById('toast-mount');
  if (toastMount) toasts.mount(toastMount);

  wireTitleBar();
  wireSidebar();
  wireAbout();
  wireNav(router);

  // Update device info in sidebar when settings change
  StateManager.subscribe('settings', (s) => {
    if (s) {
      const nameEl = document.getElementById('sidebar-device-name');
      if (nameEl) nameEl.textContent = s.deviceName;
    }
  });

  // Populate local IP in sidebar
  IpcClient.getLocalIp().then((ip) => {
    const ipEl = document.getElementById('sidebar-device-ip');
    if (ipEl) ipEl.textContent = ip;
  }).catch(() => { /* non-fatal */ });

  // Update chat unread badge in nav
  StateManager.subscribe('chatSessions', (sessions) => {
    const total = Array.from(sessions.values()).reduce((sum, s) => sum + s.unreadCount, 0);
    const navChat = document.getElementById('nav-chat');
    if (!navChat) return;
    let badge = navChat.querySelector('.nav-badge') as HTMLElement | null;
    if (total > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'nav-badge';
        navChat.appendChild(badge);
      }
      badge.textContent = total > 99 ? '99+' : String(total);
    } else {
      badge?.remove();
    }
  });
}
