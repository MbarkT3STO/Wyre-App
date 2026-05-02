/**
 * TransferCrypto.ts
 * ECDH P-256 key exchange + AES-256-GCM chunk encryption/decryption.
 * Uses Node.js built-in 'crypto' module only — no third-party dependencies.
 */

import {
  generateKeyPairSync,
  createECDH,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  hkdfSync,
} from 'crypto';

export interface KeyPair {
  publicKeyDer: Buffer;  // DER SubjectPublicKeyInfo — safe to send over wire
  privateKey: Buffer;    // raw private key bytes — never leave this process
}

export interface EncryptedChunk {
  iv: Buffer;         // 12 bytes
  ciphertext: Buffer; // encrypted data
  tag: Buffer;        // 16 bytes GCM auth tag
}

export class TransferCrypto {
  /** Generate an ephemeral ECDH P-256 key pair for one transfer. */
  static generateKeyPair(): KeyPair {
    const { publicKey, privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding:  { type: 'spki',  format: 'der' },
      privateKeyEncoding: { type: 'sec1',  format: 'der' },
    });

    return {
      publicKeyDer: publicKey as unknown as Buffer,
      privateKey:   privateKey as unknown as Buffer,
    };
  }

  /**
   * Derive a 256-bit AES-GCM key from two ECDH public keys using HKDF-SHA-256.
   * Both sides must call this with the same inputs (order: sender then receiver)
   * to arrive at the same key.
   */
  static deriveKey(
    ownPrivateKey: Buffer,
    peerPublicKeyDer: Buffer,
    senderPublicKeyDer: Buffer,
    receiverPublicKeyDer: Buffer,
  ): Buffer {
    // Perform ECDH key agreement
    const ecdh = createECDH('prime256v1');

    // Import our private key from DER (sec1 format)
    // Node's createECDH accepts the raw private key scalar as a Buffer
    // We need to extract the raw private key from the SEC1 DER encoding.
    // SEC1 DER structure: SEQUENCE { INTEGER version, OCTET STRING privateKey, ... }
    // The private key bytes start at offset 7 in a standard P-256 SEC1 DER.
    const rawPrivKey = extractRawPrivateKeyFromSec1Der(ownPrivateKey);
    ecdh.setPrivateKey(rawPrivKey);

    // Import peer's public key from DER (SPKI format)
    // Extract the raw uncompressed public key point (65 bytes) from SPKI DER.
    const rawPeerPubKey = extractRawPublicKeyFromSpkiDer(peerPublicKeyDer);
    const sharedSecret = ecdh.computeSecret(rawPeerPubKey);

    // HKDF-SHA-256: salt = 32 zero bytes, info = "wyre-transfer-v1"
    const salt = Buffer.alloc(32, 0);
    const info = Buffer.from('wyre-transfer-v1');

    // Deterministic salt derived from both public keys so both sides agree
    // (the salt is the concatenation of sender + receiver public keys hashed)
    const combinedSalt = Buffer.concat([senderPublicKeyDer, receiverPublicKeyDer]);
    const hkdfSalt = Buffer.concat([salt, combinedSalt]);

    const derived = hkdfSync('sha256', sharedSecret, hkdfSalt, info, 32);
    return Buffer.from(derived);
  }

  /** Encrypt one chunk. Returns IV + ciphertext + GCM tag as separate Buffers. */
  static encryptChunk(key: Buffer, plaintext: Buffer): EncryptedChunk {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { iv, ciphertext, tag };
  }

  /** Decrypt one chunk. Verifies GCM tag — throws if authentication fails. */
  static decryptChunk(key: Buffer, iv: Buffer, ciphertext: Buffer, tag: Buffer): Buffer {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  /**
   * Encode an encrypted chunk to wire format:
   * [4-byte length][12-byte IV][ciphertext][16-byte tag]
   */
  static encodeChunk(chunk: EncryptedChunk): Buffer {
    const payloadLength = chunk.iv.length + chunk.ciphertext.length + chunk.tag.length;
    const lengthBuf = Buffer.allocUnsafe(4);
    lengthBuf.writeUInt32BE(payloadLength, 0);
    return Buffer.concat([lengthBuf, chunk.iv, chunk.ciphertext, chunk.tag]);
  }

  /**
   * Read one encrypted chunk from a Buffer at a given offset.
   * Returns { iv, ciphertext, tag, bytesConsumed }.
   */
  static decodeChunk(
    buf: Buffer,
    offset: number,
  ): { iv: Buffer; ciphertext: Buffer; tag: Buffer; bytesConsumed: number } {
    if (buf.length - offset < 4) {
      throw new Error('Buffer too small to read chunk length');
    }
    const payloadLength = buf.readUInt32BE(offset);
    const totalNeeded = 4 + payloadLength;
    if (buf.length - offset < totalNeeded) {
      throw new Error('Buffer too small to read full chunk');
    }

    const ivStart = offset + 4;
    const iv = buf.slice(ivStart, ivStart + 12);
    const tagStart = offset + 4 + payloadLength - 16;
    const tag = buf.slice(tagStart, tagStart + 16);
    const ciphertext = buf.slice(ivStart + 12, tagStart);

    return { iv, ciphertext, tag, bytesConsumed: totalNeeded };
  }
}

// ─── DER parsing helpers ──────────────────────────────────────────────────────

/**
 * Extract the raw 32-byte private key scalar from a SEC1 DER-encoded P-256 key.
 *
 * SEC1 DER structure for P-256:
 *   30 77                    SEQUENCE
 *     02 01 01               INTEGER version = 1
 *     04 20 <32 bytes>       OCTET STRING (private key)
 *     ...
 *
 * The private key octet string starts after: 30 xx 02 01 01 04 20
 * That is: tag(1) + len(1) + tag(1) + len(1) + val(1) + tag(1) + len(1) = 7 bytes
 */
function extractRawPrivateKeyFromSec1Der(der: Buffer): Buffer {
  // Walk the DER to find the OCTET STRING containing the private key
  // SEQUENCE tag = 0x30, INTEGER tag = 0x02, OCTET STRING tag = 0x04
  let pos = 0;

  // Skip outer SEQUENCE
  if (der[pos] !== 0x30) throw new Error('Expected SEQUENCE in SEC1 DER');
  pos++;
  pos += derLengthBytes(der, pos); // skip length field

  // Skip INTEGER (version = 1)
  if (der[pos] !== 0x02) throw new Error('Expected INTEGER in SEC1 DER');
  pos++;
  const intLen = derReadLength(der, pos);
  pos += derLengthBytes(der, pos);
  pos += intLen;

  // Read OCTET STRING (private key)
  if (der[pos] !== 0x04) throw new Error('Expected OCTET STRING in SEC1 DER');
  pos++;
  const keyLen = derReadLength(der, pos);
  pos += derLengthBytes(der, pos);

  return der.slice(pos, pos + keyLen);
}

/**
 * Extract the raw 65-byte uncompressed public key point from a SPKI DER-encoded P-256 key.
 *
 * SPKI DER structure:
 *   30 59                    SEQUENCE
 *     30 13                  SEQUENCE (AlgorithmIdentifier)
 *       06 07 ...            OID (ecPublicKey)
 *       06 08 ...            OID (prime256v1)
 *     03 42 00 <65 bytes>    BIT STRING (public key point, uncompressed)
 */
function extractRawPublicKeyFromSpkiDer(der: Buffer): Buffer {
  let pos = 0;

  // Skip outer SEQUENCE
  if (der[pos] !== 0x30) throw new Error('Expected SEQUENCE in SPKI DER');
  pos++;
  pos += derLengthBytes(der, pos);

  // Skip AlgorithmIdentifier SEQUENCE
  if (der[pos] !== 0x30) throw new Error('Expected AlgorithmIdentifier SEQUENCE in SPKI DER');
  pos++;
  const algLen = derReadLength(der, pos);
  pos += derLengthBytes(der, pos);
  pos += algLen;

  // Read BIT STRING
  if (der[pos] !== 0x03) throw new Error('Expected BIT STRING in SPKI DER');
  pos++;
  const bitLen = derReadLength(der, pos);
  pos += derLengthBytes(der, pos);

  // BIT STRING has a leading "unused bits" byte (always 0x00 for EC keys)
  pos++; // skip unused-bits byte
  const keyLen = bitLen - 1;

  return der.slice(pos, pos + keyLen);
}

/** Read a DER length value at the given position. */
function derReadLength(buf: Buffer, pos: number): number {
  const first = buf[pos]!;
  if (first < 0x80) return first;
  const numBytes = first & 0x7f;
  let len = 0;
  for (let i = 0; i < numBytes; i++) {
    len = (len << 8) | buf[pos + 1 + i]!;
  }
  return len;
}

/** Return the number of bytes the DER length field occupies at the given position. */
function derLengthBytes(buf: Buffer, pos: number): number {
  const first = buf[pos]!;
  if (first < 0x80) return 1;
  return 1 + (first & 0x7f);
}
