/**
 * DiagnosticsHandlers.ts
 * IPC handlers for diagnostics: log retrieval and local IP detection.
 */

import { IpcMain } from 'electron';
import { networkInterfaces } from 'os';
import { IpcChannels } from '../../../shared/ipc/IpcContracts';
import { Logger } from '../../logging/Logger';

export function registerDiagnosticsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IpcChannels.LOGS_GET, () => {
    try {
      const lines = Logger.getInstance().readLastLines(200);
      return { lines };
    } catch {
      return { lines: [] };
    }
  });

  ipcMain.handle(IpcChannels.LOCAL_IP_GET, () => {
    const nets = networkInterfaces();
    for (const ifaces of Object.values(nets)) {
      if (!ifaces) continue;
      for (const iface of ifaces) {
        if (iface.family === 'IPv4' && !iface.internal) return iface.address;
      }
    }
    return '—';
  });
}
