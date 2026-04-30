/**
 * validators.ts
 * Input validation helpers. Pure functions, no side effects.
 */

/**
 * Validate a device name: 1–64 chars, printable, no leading/trailing whitespace.
 */
export function validateDeviceName(name: string): { valid: boolean; error?: string } {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { valid: false, error: 'Device name cannot be empty.' };
  if (trimmed.length > 64) return { valid: false, error: 'Device name must be 64 characters or fewer.' };
  if (trimmed !== name) return { valid: false, error: 'Device name cannot have leading or trailing spaces.' };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(name)) return { valid: false, error: 'Device name contains invalid characters.' };
  return { valid: true };
}

/**
 * Validate a TCP port number (1–65535).
 */
export function validatePort(port: number): { valid: boolean; error?: string } {
  if (!Number.isInteger(port)) return { valid: false, error: 'Port must be an integer.' };
  if (port < 1 || port > 65535) return { valid: false, error: 'Port must be between 1 and 65535.' };
  return { valid: true };
}

/**
 * Validate an auto-decline timeout (10–120 seconds).
 */
export function validateTimeout(seconds: number): { valid: boolean; error?: string } {
  if (!Number.isInteger(seconds)) return { valid: false, error: 'Timeout must be an integer.' };
  if (seconds < 10 || seconds > 120) return { valid: false, error: 'Timeout must be between 10 and 120 seconds.' };
  return { valid: true };
}

/**
 * Check if a string is a valid UUID v4.
 */
export function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Check if a string looks like a valid IPv4 address.
 */
export function isValidIpv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every(p => {
    const n = Number(p);
    return Number.isInteger(n) && n >= 0 && n <= 255 && p === String(n);
  });
}
