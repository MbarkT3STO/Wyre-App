/**
 * Main process entry point.
 * Bootstraps the application and handles single-instance lock.
 */

import { app } from 'electron';
import { AppBootstrapper } from './app/AppBootstrapper';

// Enforce single instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  const bootstrapper = new AppBootstrapper();

  bootstrapper.bootstrap().catch((err: unknown) => {
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
