/**
 * Logger.ts
 * Singleton JSON-line logger with automatic log rotation.
 * Writes to <userData>/wyre.log; rotates to wyre.log.1 when file exceeds 2 MB.
 * Uses synchronous fs calls — acceptable for a low-frequency log.
 */

import * as fs from 'fs';
import * as path from 'path';

const MAX_LOG_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

type LogLevel = 'info' | 'warn' | 'error';

export class Logger {
  private static instance: Logger | null = null;
  private logPath: string;

  private constructor(logPath: string) {
    this.logPath = logPath;
  }

  /** Returns the singleton Logger instance. Must call Logger.init() first. */
  static getInstance(): Logger {
    if (!Logger.instance) {
      throw new Error('Logger has not been initialised — call Logger.init(logPath) first');
    }
    return Logger.instance;
  }

  /** Initialise (or return existing) singleton with the given log path. */
  static init(logPath: string): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(logPath);
    }
    return Logger.instance;
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.write('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.write('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.write('error', message, context);
  }

  /**
   * Read the last `n` lines from the log file.
   * Returns an empty array if the file does not exist.
   */
  readLastLines(n: number): string[] {
    try {
      if (!fs.existsSync(this.logPath)) return [];
      const content = fs.readFileSync(this.logPath, 'utf8');
      const lines = content.split('\n').filter(l => l.trim().length > 0);
      return lines.slice(-n);
    } catch {
      return [];
    }
  }

  private write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    try {
      this.rotateIfNeeded();
      const entry = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        message,
        ...context,
      });
      fs.appendFileSync(this.logPath, entry + '\n', 'utf8');
    } catch {
      // Never let logging crash the app
    }
  }

  private rotateIfNeeded(): void {
    try {
      if (!fs.existsSync(this.logPath)) return;
      const stat = fs.statSync(this.logPath);
      if (stat.size >= MAX_LOG_SIZE_BYTES) {
        const rotatedPath = this.logPath + '.1';
        fs.renameSync(this.logPath, rotatedPath);
      }
    } catch {
      // Rotation failure is non-fatal
    }
  }

  /** Derive the default log path from Electron's userData directory. */
  static defaultLogPath(): string {
    // Lazy import so this module can be loaded before app is ready if needed.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron') as typeof import('electron');
    return path.join(app.getPath('userData'), 'wyre.log');
  }
}
