/**
 * Renderer entry point.
 * Bootstraps the app: loads settings, wires IPC listeners,
 * mounts the shell, and starts the router.
 */

import './styles/base.css';
import './styles/components.css';
import './styles/animations.css';
import './styles/chat.css';

import { IpcClient } from './core/IpcClient';
import { StateManager } from './core/StateManager';
import { appRouter } from './core/Router';
import { ThemeEngine } from './theme/ThemeEngine';
import { ScaleEngine } from './theme/ScaleEngine';
import { ToastContainer } from './components/ToastContainer';
import { HomeView } from './views/HomeView';
import { TransfersView } from './views/TransfersView';
import { SettingsView } from './views/SettingsView';
import { ChatView } from './views/ChatView';
import { mountShell } from './bootstrap/ShellBuilder';
import { wireIpcListeners } from './bootstrap/IpcListeners';
import { wireCustomEvents } from './bootstrap/CustomEventListeners';

const themeEngine = new ThemeEngine();
const scaleEngine = new ScaleEngine();
const toasts = new ToastContainer();
const router = appRouter;

async function bootstrap(): Promise<void> {
  // Load initial state
  const settings = await IpcClient.getSettings();
  StateManager.setState('settings', settings);
  themeEngine.apply(settings.theme);
  scaleEngine.apply(settings.uiScale ?? 1.0);

  const devices = await IpcClient.getDevices();
  StateManager.setState('devices', devices);

  const history = await IpcClient.getHistory();
  StateManager.setState('transferHistory', history);

  // Mount shell (HTML + DOM wiring)
  mountShell(settings, toasts, router);

  // Wire IPC and custom events
  wireIpcListeners(toasts, router);
  wireCustomEvents(toasts);

  // Register routes and mount router
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
    }})
    .register({ path: '/chat', title: 'Chat', factory: () => {
      const v = new ChatView(toasts);
      const wrapper = document.createElement('div');
      wrapper.className = 'view-wrapper';
      v.mount(wrapper);
      return wrapper;
    }});

  router.mount(outlet);
}

bootstrap().catch((err: unknown) => {
  console.error('Renderer bootstrap failed:', err);
});
