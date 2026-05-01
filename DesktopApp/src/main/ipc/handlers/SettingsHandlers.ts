/**
 * SettingsHandlers.ts
 * IPC handlers for settings read/write, window controls, and shell actions.
 */

import { IpcMain, BrowserWindow, shell, dialog } from 'electron';
import { IpcChannels } from '../../../shared/ipc/IpcContracts';
import type { SettingsStore } from '../../store/SettingsStore';
import type { AppSettings } from '../../../shared/models/AppSettings';
import {
  validateSettingsSetPayload,
  validateShellPathPayload,
} from '../validators/IpcPayloadValidator';

export function registerSettingsHandlers(
  ipcMain: IpcMain,
  settingsStore: SettingsStore,
  getMainWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle(IpcChannels.SETTINGS_GET, (): AppSettings => {
    return settingsStore.get();
  });

  ipcMain.handle(IpcChannels.SETTINGS_SET, (_event, payload: unknown): void => {
    // Validate it's a plain object before passing to the store
    const validated = validateSettingsSetPayload(payload);
    // Only pass keys that are known AppSettings fields to prevent prototype pollution
    const allowed: (keyof AppSettings)[] = [
      'deviceName', 'transferPort', 'saveDirectory', 'theme',
      'autoAccept', 'trustedDeviceIds', 'trustedDeviceNames', 'autoDeclineTimeout', 'showNotifications', 'uiScale',
    ];
    const safe: Partial<AppSettings> = {};
    for (const key of allowed) {
      if (key in validated) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (safe as any)[key] = validated[key];
      }
    }
    settingsStore.set(safe);
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

  ipcMain.handle(IpcChannels.SHELL_OPEN_FILE, (_event, payload: unknown): void => {
    const { path } = validateShellPathPayload(payload);
    void shell.openPath(path);
  });

  ipcMain.handle(IpcChannels.SHELL_SHOW_IN_FOLDER, (_event, payload: unknown): void => {
    const { path } = validateShellPathPayload(payload);
    shell.showItemInFolder(path);
  });

  // Native directory picker — uses Electron's dialog API so the user selects
  // a folder directly rather than a file inside it (the webkitdirectory hack).
  ipcMain.handle(IpcChannels.DIALOG_OPEN_DIRECTORY, async (): Promise<string | null> => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win ?? new BrowserWindow({ show: false }), {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Save Location',
    });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0] ?? null;
  });
}
