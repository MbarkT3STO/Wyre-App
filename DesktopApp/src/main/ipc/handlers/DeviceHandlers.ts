/**
 * DeviceHandlers.ts
 * IPC handlers for device discovery operations.
 * Delegates to DiscoveryService — no business logic here.
 */

import { IpcMain } from 'electron';
import { IpcChannels } from '../../../shared/ipc/IpcContracts';
import type { DiscoveryService } from '../../discovery/DiscoveryService';
import type { Device } from '../../../shared/models/Device';

export function registerDeviceHandlers(
  ipcMain: IpcMain,
  discoveryService: DiscoveryService,
): void {
  ipcMain.handle(IpcChannels.DEVICES_LIST_GET, (): Device[] => {
    return discoveryService.getDevices();
  });
}
