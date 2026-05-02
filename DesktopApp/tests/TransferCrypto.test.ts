/**
 * TransferCrypto.test.ts
 * Unit tests for TransferCrypto — ECDH key exchange + AES-256-GCM encryption.
 */

import { describe, it, expect } from 'vitest';
import { TransferCrypto } from '../src/main/crypto/TransferCrypto';

describe('TransferCrypto.generateKeyPair', () => {
  it('produces a public key buffer of expected DER SPKI length for P-256', () => {
    const kp = TransferCrypto.generateKeyPair();
    // P-256 SPKI DER is always 91 bytes:
    //   30 59 (SEQUENCE, 89 bytes)
    //     30 13 (AlgorithmIdentifier)
    //       06 07 2a 86 48 ce 3d 02 01  (OID ecPublicKey)
    //       06 08 2a 86 48 ce 3d 03 01 07 (OID prime256v1)
    //     03 42 00 04 <64 bytes>  (BIT STRING, uncompressed point)
    expect(kp.publicKeyDer).toBeInstanceOf(Buffer);
    expect(kp.publicKeyDer.length).toBe(91);
  });

  it('produces a private key buffer', () => {
    const kp = TransferCrypto.generateKeyPair();
    expect(kp.privateKey).toBeInstanceOf(Buffer);
    expect(kp.privateKey.length).toBeGreaterThan(0);
  });

  it('generates unique key pairs on each call', () => {
    const kp1 = TransferCrypto.generateKeyPair();
    const kp2 = TransferCrypto.generateKeyPair();
    expect(kp1.publicKeyDer.equals(kp2.publicKeyDer)).toBe(false);
    expect(kp1.privateKey.equals(kp2.privateKey)).toBe(false);
  });
});

describe('TransferCrypto.deriveKey', () => {
  it('both sides derive the same 32-byte key', () => {
    const sender   = TransferCrypto.generateKeyPair();
    const receiver = TransferCrypto.generateKeyPair();

    const senderKey = TransferCrypto.deriveKey(
      sender.privateKey,
      receiver.publicKeyDer,
      sender.publicKeyDer,
      receiver.publicKeyDer,
    );

    const receiverKey = TransferCrypto.deriveKey(
      receiver.privateKey,
      sender.publicKeyDer,
      sender.publicKeyDer,
      receiver.publicKeyDer,
    );

    expect(senderKey).toBeInstanceOf(Buffer);
    expect(senderKey.length).toBe(32);
    expect(receiverKey.length).toBe(32);
    expect(senderKey.equals(receiverKey)).toBe(true);
  });

  it('different transfers produce different keys', () => {
    const s1 = TransferCrypto.generateKeyPair();
    const r1 = TransferCrypto.generateKeyPair();
    const s2 = TransferCrypto.generateKeyPair();
    const r2 = TransferCrypto.generateKeyPair();

    const key1 = TransferCrypto.deriveKey(s1.privateKey, r1.publicKeyDer, s1.publicKeyDer, r1.publicKeyDer);
    const key2 = TransferCrypto.deriveKey(s2.privateKey, r2.publicKeyDer, s2.publicKeyDer, r2.publicKeyDer);

    expect(key1.equals(key2)).toBe(false);
  });
});

describe('TransferCrypto.encryptChunk / decryptChunk', () => {
  it('round-trips a 1024-byte buffer correctly', () => {
    const { privateKey, publicKeyDer } = TransferCrypto.generateKeyPair();
    const peer = TransferCrypto.generateKeyPair();
    const key = TransferCrypto.deriveKey(privateKey, peer.publicKeyDer, publicKeyDer, peer.publicKeyDer);

    const plaintext = Buffer.alloc(1024);
    for (let i = 0; i < 1024; i++) plaintext[i] = i & 0xff;

    const encrypted = TransferCrypto.encryptChunk(key, plaintext);
    const decrypted = TransferCrypto.decryptChunk(key, encrypted.iv, encrypted.ciphertext, encrypted.tag);

    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const kp = TransferCrypto.generateKeyPair();
    const peer = TransferCrypto.generateKeyPair();
    const key = TransferCrypto.deriveKey(kp.privateKey, peer.publicKeyDer, kp.publicKeyDer, peer.publicKeyDer);

    const plaintext = Buffer.from('hello world');
    const enc1 = TransferCrypto.encryptChunk(key, plaintext);
    const enc2 = TransferCrypto.encryptChunk(key, plaintext);

    // IVs should differ (random per chunk)
    expect(enc1.iv.equals(enc2.iv)).toBe(false);
  });

  it('throws when the GCM tag is tampered', () => {
    const kp = TransferCrypto.generateKeyPair();
    const peer = TransferCrypto.generateKeyPair();
    const key = TransferCrypto.deriveKey(kp.privateKey, peer.publicKeyDer, kp.publicKeyDer, peer.publicKeyDer);

    const plaintext = Buffer.from('sensitive data');
    const encrypted = TransferCrypto.encryptChunk(key, plaintext);

    // Flip one byte of the tag
    const tamperedTag = Buffer.from(encrypted.tag);
    tamperedTag[0] ^= 0xff;

    expect(() =>
      TransferCrypto.decryptChunk(key, encrypted.iv, encrypted.ciphertext, tamperedTag),
    ).toThrow();
  });

  it('throws when the ciphertext is tampered', () => {
    const kp = TransferCrypto.generateKeyPair();
    const peer = TransferCrypto.generateKeyPair();
    const key = TransferCrypto.deriveKey(kp.privateKey, peer.publicKeyDer, kp.publicKeyDer, peer.publicKeyDer);

    const plaintext = Buffer.from('sensitive data');
    const encrypted = TransferCrypto.encryptChunk(key, plaintext);

    const tamperedCiphertext = Buffer.from(encrypted.ciphertext);
    tamperedCiphertext[0] ^= 0x01;

    expect(() =>
      TransferCrypto.decryptChunk(key, encrypted.iv, tamperedCiphertext, encrypted.tag),
    ).toThrow();
  });
});

describe('TransferCrypto.encodeChunk / decodeChunk', () => {
  it('round-trips IV, ciphertext, and tag correctly', () => {
    const kp = TransferCrypto.generateKeyPair();
    const peer = TransferCrypto.generateKeyPair();
    const key = TransferCrypto.deriveKey(kp.privateKey, peer.publicKeyDer, kp.publicKeyDer, peer.publicKeyDer);

    const plaintext = Buffer.from('test chunk data for encode/decode round-trip');
    const encrypted = TransferCrypto.encryptChunk(key, plaintext);
    const encoded = TransferCrypto.encodeChunk(encrypted);

    const decoded = TransferCrypto.decodeChunk(encoded, 0);

    expect(decoded.iv.equals(encrypted.iv)).toBe(true);
    expect(decoded.ciphertext.equals(encrypted.ciphertext)).toBe(true);
    expect(decoded.tag.equals(encrypted.tag)).toBe(true);
  });

  it('bytesConsumed equals the full encoded buffer length', () => {
    const kp = TransferCrypto.generateKeyPair();
    const peer = TransferCrypto.generateKeyPair();
    const key = TransferCrypto.deriveKey(kp.privateKey, peer.publicKeyDer, kp.publicKeyDer, peer.publicKeyDer);

    const plaintext = Buffer.alloc(256, 0xab);
    const encrypted = TransferCrypto.encryptChunk(key, plaintext);
    const encoded = TransferCrypto.encodeChunk(encrypted);

    const decoded = TransferCrypto.decodeChunk(encoded, 0);
    expect(decoded.bytesConsumed).toBe(encoded.length);
  });

  it('correctly decodes a chunk at a non-zero offset', () => {
    const kp = TransferCrypto.generateKeyPair();
    const peer = TransferCrypto.generateKeyPair();
    const key = TransferCrypto.deriveKey(kp.privateKey, peer.publicKeyDer, kp.publicKeyDer, peer.publicKeyDer);

    const plaintext = Buffer.from('offset test');
    const encrypted = TransferCrypto.encryptChunk(key, plaintext);
    const encoded = TransferCrypto.encodeChunk(encrypted);

    // Prepend 8 bytes of garbage to simulate a buffer with an offset
    const prefix = Buffer.alloc(8, 0xff);
    const combined = Buffer.concat([prefix, encoded]);

    const decoded = TransferCrypto.decodeChunk(combined, 8);
    expect(decoded.iv.equals(encrypted.iv)).toBe(true);
    expect(decoded.ciphertext.equals(encrypted.ciphertext)).toBe(true);
    expect(decoded.tag.equals(encrypted.tag)).toBe(true);
  });

  it('wire format: first 4 bytes are big-endian payload length', () => {
    const kp = TransferCrypto.generateKeyPair();
    const peer = TransferCrypto.generateKeyPair();
    const key = TransferCrypto.deriveKey(kp.privateKey, peer.publicKeyDer, kp.publicKeyDer, peer.publicKeyDer);

    const plaintext = Buffer.alloc(100, 0x42);
    const encrypted = TransferCrypto.encryptChunk(key, plaintext);
    const encoded = TransferCrypto.encodeChunk(encrypted);

    const payloadLength = encoded.readUInt32BE(0);
    // payload = 12 (IV) + ciphertext.length + 16 (tag)
    expect(payloadLength).toBe(12 + encrypted.ciphertext.length + 16);
    expect(encoded.length).toBe(4 + payloadLength);
  });

  it('full encrypt → encode → decode → decrypt round-trip', () => {
    const sender   = TransferCrypto.generateKeyPair();
    const receiver = TransferCrypto.generateKeyPair();
    const key = TransferCrypto.deriveKey(
      sender.privateKey,
      receiver.publicKeyDer,
      sender.publicKeyDer,
      receiver.publicKeyDer,
    );

    const original = Buffer.alloc(1024 * 1024); // 1 MB
    for (let i = 0; i < original.length; i++) original[i] = i & 0xff;

    const encrypted = TransferCrypto.encryptChunk(key, original);
    const encoded   = TransferCrypto.encodeChunk(encrypted);
    const decoded   = TransferCrypto.decodeChunk(encoded, 0);
    const decrypted = TransferCrypto.decryptChunk(key, decoded.iv, decoded.ciphertext, decoded.tag);

    expect(decrypted.equals(original)).toBe(true);
  });
});
