/**
 * formatters.ts — identical to desktop version, fully portable.
 */

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return exponent === 0
    ? `${value} ${units[exponent]}`
    : `${value.toFixed(value < 10 ? 2 : 1)} ${units[exponent]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '—';
  return `${formatFileSize(bytesPerSec)}/s`;
}

export function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 1) return '< 1s';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function truncateFilename(name: string, maxLength = 30): string {
  if (name.length <= maxLength) return name;
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex === -1 || dotIndex === 0) return name.slice(0, maxLength - 1) + '…';
  const ext = name.slice(dotIndex);
  const base = name.slice(0, dotIndex);
  const allowedBase = maxLength - ext.length - 1;
  if (allowedBase <= 0) return name.slice(0, maxLength - 1) + '…';
  return base.slice(0, allowedBase) + '…' + ext;
}
