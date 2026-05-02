/**
 * Main process entry point.
 * Bootstraps the application and handles single-instance lock.
 */

import { app } from 'electron';
import { join } from 'path';
import { AppBootstrapper } from './app/AppBootstrapper';
import { Logger } from './logging/Logger';

// Enforce single instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // Initialise logger as early as possible so bootstrap errors are captured.
  // app.getPath('userData') is available before app.whenReady().
  app.whenReady().then(() => {
    Logger.init(join(app.getPath('userData'), 'wyre.log')).info('Wyre starting', { version: app.getVersion() });
  }).catch(() => { /* non-fatal */ });

  const bootstrapper = new AppBootstrapper();

  bootstrapper.bootstrap().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    try { Logger.getInstance().error('Fatal bootstrap error', { message }); } catch { /* logger not ready */ }
    console.error('Fatal error during bootstrap:', err);
    app.quit();
  });

  // Quit when all windows are closed (except macOS)
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
