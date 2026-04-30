/**
 * NotificationManager.ts
 * Abstracts OS native notifications via Electron's Notification API.
 * Single responsibility: show OS notifications only.
 */

import { Notification, shell } from 'electron';

export interface NotificationOptions {
  title: string;
  body: string;
  /** Optional file path to open when notification is clicked */
  openPath?: string;
}

export class NotificationManager {
  private enabled: boolean;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  show(options: NotificationOptions): void {
    if (!this.enabled) return;
    if (!Notification.isSupported()) return;

    const notification = new Notification({
      title: options.title,
      body: options.body,
      silent: false,
    });

    if (options.openPath) {
      const path = options.openPath;
      notification.on('click', () => {
        shell.showItemInFolder(path);
      });
    }

    notification.show();
  }

  notifyTransferComplete(fileName: string, savedPath: string): void {
    this.show({
      title: 'Transfer Complete',
      body: `${fileName} has been received successfully.`,
      openPath: savedPath,
    });
  }

  notifyTransferFailed(fileName: string, reason: string): void {
    this.show({
      title: 'Transfer Failed',
      body: `${fileName}: ${reason}`,
    });
  }

  notifyIncomingRequest(senderName: string, fileName: string): void {
    this.show({
      title: `Incoming file from ${senderName}`,
      body: fileName,
    });
  }
}
