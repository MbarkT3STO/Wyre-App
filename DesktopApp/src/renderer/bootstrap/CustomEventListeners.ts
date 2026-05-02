/**
 * CustomEventListeners.ts
 * Wires all custom DOM events dispatched by renderer components (filedrop:*).
 */

import { IpcClient } from '../core/IpcClient';
import { StateManager } from '../core/StateManager';
import type { ToastContainer } from '../components/ToastContainer';
import type { UiScale } from '../../shared/models/AppSettings';
import { ThemeEngine } from '../theme/ThemeEngine';
import { ScaleEngine } from '../theme/ScaleEngine';

const themeEngine = new ThemeEngine();
const scaleEngine = new ScaleEngine();

/**
 * Registers all filedrop:* custom event listeners. Call once during bootstrap.
 */
export function wireCustomEvents(toasts: ToastContainer): void {
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

  window.addEventListener('filedrop:retry-transfer', (e) => {
    const { filePath, peerId } = (e as CustomEvent<{ filePath: string; peerId: string; peerName: string }>).detail;
    const device = StateManager.get('devices').find(d => d.id === peerId);
    if (!device) {
      toasts.error('Device is no longer online — cannot retry');
      return;
    }
    IpcClient.sendFile({ deviceId: peerId, filePath })
      .then(() => toasts.success('Retrying transfer…'))
      .catch((err: unknown) => {
        toasts.error(`Retry failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  });

  window.addEventListener('filedrop:theme-change', (e) => {
    const theme = (e as CustomEvent<{ theme: 'dark' | 'light' | 'system' }>).detail.theme;
    themeEngine.apply(theme);
  });

  window.addEventListener('filedrop:scale-change', (e) => {
    const scale = (e as CustomEvent<{ scale: UiScale }>).detail.scale;
    scaleEngine.apply(scale);
  });

  window.addEventListener('filedrop:resume-transfer', (e) => {
    const { transferId } = (e as CustomEvent<{ transferId: string }>).detail;
    IpcClient.resumeTransfer({ transferId })
      .then(() => toasts.info('Resuming transfer…'))
      .catch((err: unknown) => {
        toasts.error(`Resume failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  });
}
