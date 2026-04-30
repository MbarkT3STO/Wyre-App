/**
 * IpcPayloadValidator.ts
 * Runtime validation for all IPC payloads received from the renderer.
 * TypeScript types are erased at runtime — this is the enforcement layer.
 * Throws a descriptive Error on any invalid input so handlers can reject safely.
 */

import { isValidUuid } from '../../../shared/utils/validators';

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`IPC validation: "${field}" must be a string`);
  return value;
}

function assertBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`IPC validation: "${field}" must be a boolean`);
  return value;
}

function assertNonEmptyString(value: unknown, field: string): string {
  const s = assertString(value, field);
  if (s.trim().length === 0) throw new Error(`IPC validation: "${field}" must not be empty`);
  return s;
}

function assertUuid(value: unknown, field: string): string {
  const s = assertNonEmptyString(value, field);
  if (!isValidUuid(s)) throw new Error(`IPC validation: "${field}" must be a valid UUID`);
  return s;
}

function assertAbsolutePath(value: unknown, field: string): string {
  const s = assertNonEmptyString(value, field);
  // Must be absolute: starts with / on Unix/macOS/Linux, or a drive letter on Windows
  if (!/^(?:[a-zA-Z]:[/\\]|\/)/.test(s)) {
    throw new Error(`IPC validation: "${field}" must be an absolute path`);
  }
  return s;
}

function assertObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`IPC validation: "${field}" must be an object`);
  }
  return value as Record<string, unknown>;
}

// ─── Per-channel validators ───────────────────────────────────────────────────

export function validateTransferSendPayload(payload: unknown): { deviceId: string; filePath: string } {
  const p = assertObject(payload, 'TransferSendPayload');
  return {
    deviceId: assertUuid(p['deviceId'], 'deviceId'),
    filePath: assertAbsolutePath(p['filePath'], 'filePath'),
  };
}

export function validateTransferCancelPayload(payload: unknown): { transferId: string } {
  const p = assertObject(payload, 'TransferCancelPayload');
  return { transferId: assertUuid(p['transferId'], 'transferId') };
}

export function validateIncomingResponsePayload(payload: unknown): { transferId: string; accepted: boolean } {
  const p = assertObject(payload, 'IncomingResponsePayload');
  return {
    transferId: assertUuid(p['transferId'], 'transferId'),
    accepted: assertBoolean(p['accepted'], 'accepted'),
  };
}

export function validateSettingsSetPayload(payload: unknown): Record<string, unknown> {
  // Settings is a partial object — just ensure it's an object, not an array or primitive
  return assertObject(payload, 'SettingsSetPayload');
}

export function validateShellPathPayload(payload: unknown): { path: string } {
  const p = assertObject(payload, 'ShellPathPayload');
  return { path: assertAbsolutePath(p['path'], 'path') };
}
