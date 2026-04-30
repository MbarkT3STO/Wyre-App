/**
 * SettingsHandlers.ts
 * IPC handlers for settings read/write, window controls, and shell actions.
 */

import { IpcMain, BrowserWindow, shell } from 'electron';
import { IpcChannels } from '../../../shared/ipc/IpcContracts';
import type { SettingsStore } from '../../store/SettingsStore';
import type { SettingsSetPayload } from '../../../shared/ipc/IpcContracts';
import type { AppSettings } from '../../../shared/models/AppSettings';

export function registerSettingsHandlers(
  ipcMain: IpcMain,
  settingsStore: SettingsStore,
  getMainWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle(IpcChannels.SETTINGS_GET, (): AppSettings => {
    return settingsStore.get();
  });

  ipcMain.handle(IpcChannels.SETTINGS_SET, (_event, payload: SettingsSetPayload): void => {
    settingsStore.set(payload);
  });

  ipcMain.handle(IpcChannels.WINDOW_MINIMIZE, (): void => {
    getMainWindow()?.minimize();
  });

  ipcMain.handle(IpcChannels.WINDOW_MAXIMIZE, (): void => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  ipcMain.handle(IpcChannels.WINDOW_CLOSE, (): void => {
    getMainWindow()?.close();
  });

  ipcMain.handle(IpcChannels.WINDOW_IS_MAXIMIZED, (): boolean => {
    return getMainWindow()?.isMaximized() ?? false;
  });

  ipcMain.handle(IpcChannels.SHELL_OPEN_FILE, (_event, payload: { path: string }): void => {
    void shell.openPath(payload.path);
  });

  ipcMain.handle(IpcChannels.SHELL_SHOW_IN_FOLDER, (_event, payload: { path: string }): void => {
    shell.showItemInFolder(payload.path);
  });
}
