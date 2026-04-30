/**
 * validators.test.ts
 * Unit tests for all validator utility functions.
 */

import { describe, it, expect } from 'vitest';
import {
  validateDeviceName,
  validatePort,
  validateTimeout,
  isValidUuid,
  isValidIpv4,
} from '../src/shared/utils/validators';

describe('validateDeviceName', () => {
  it('accepts valid names', () => {
    expect(validateDeviceName('My MacBook').valid).toBe(true);
    expect(validateDeviceName('PC-001').valid).toBe(true);
    expect(validateDeviceName('a').valid).toBe(true);
    expect(validateDeviceName('a'.repeat(64)).valid).toBe(true);
  });

  it('rejects empty names', () => {
    const result = validateDeviceName('');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects names that are too long', () => {
    const result = validateDeviceName('a'.repeat(65));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('64');
  });

  it('rejects names with leading whitespace', () => {
    const result = validateDeviceName(' MyDevice');
    expect(result.valid).toBe(false);
  });

  it('rejects names with trailing whitespace', () => {
    const result = validateDeviceName('MyDevice ');
    expect(result.valid).toBe(false);
  });

  it('rejects names with control characters', () => {
    const result = validateDeviceName('My\x00Device');
    expect(result.valid).toBe(false);
  });
});

describe('validatePort', () => {
  it('accepts valid ports', () => {
    expect(validatePort(1).valid).toBe(true);
    expect(validatePort(80).valid).toBe(true);
    expect(validatePort(8080).valid).toBe(true);
    expect(validatePort(65535).valid).toBe(true);
  });

  it('rejects port 0', () => {
    expect(validatePort(0).valid).toBe(false);
  });

  it('rejects ports above 65535', () => {
    expect(validatePort(65536).valid).toBe(false);
  });

  it('rejects negative ports', () => {
    expect(validatePort(-1).valid).toBe(false);
  });

  it('rejects non-integer ports', () => {
    expect(validatePort(80.5).valid).toBe(false);
  });
});

describe('validateTimeout', () => {
  it('accepts valid timeouts', () => {
    expect(validateTimeout(10).valid).toBe(true);
    expect(validateTimeout(30).valid).toBe(true);
    expect(validateTimeout(120).valid).toBe(true);
  });

  it('rejects timeout below 10', () => {
    expect(validateTimeout(9).valid).toBe(false);
  });

  it('rejects timeout above 120', () => {
    expect(validateTimeout(121).valid).toBe(false);
  });

  it('rejects non-integer timeouts', () => {
    expect(validateTimeout(30.5).valid).toBe(false);
  });
});

describe('isValidUuid', () => {
  it('accepts valid UUID v4', () => {
    expect(isValidUuid('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(true);  // v4
    expect(isValidUuid('00000000-0000-4000-8000-000000000000')).toBe(true);  // v4 min
    expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);  // v4 (variant 4=0100)
  });

  it('rejects invalid UUIDs', () => {
    expect(isValidUuid('')).toBe(false);
    expect(isValidUuid('not-a-uuid')).toBe(false);
    expect(isValidUuid('550e8400-e29b-41d4-a716')).toBe(false);
    expect(isValidUuid('550e8400-e29b-31d4-a716-446655440000')).toBe(false); // v3
  });
});

describe('isValidIpv4', () => {
  it('accepts valid IPv4 addresses', () => {
    expect(isValidIpv4('192.168.1.1')).toBe(true);
    expect(isValidIpv4('0.0.0.0')).toBe(true);
    expect(isValidIpv4('255.255.255.255')).toBe(true);
    expect(isValidIpv4('10.0.0.1')).toBe(true);
  });

  it('rejects invalid IPv4 addresses', () => {
    expect(isValidIpv4('256.0.0.1')).toBe(false);
    expect(isValidIpv4('192.168.1')).toBe(false);
    expect(isValidIpv4('192.168.1.1.1')).toBe(false);
    expect(isValidIpv4('not.an.ip.addr')).toBe(false);
    expect(isValidIpv4('')).toBe(false);
    expect(isValidIpv4('192.168.01.1')).toBe(false); // leading zero
  });
});
