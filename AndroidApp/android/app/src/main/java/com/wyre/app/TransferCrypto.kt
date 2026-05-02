package com.wyre.app

import android.util.Base64
import java.io.InputStream
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.PublicKey
import java.security.SecureRandom
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * TransferCrypto.kt
 * ECDH P-256 key exchange + AES-256-GCM chunk encryption/decryption.
 * Uses Android's javax.crypto / java.security only — no third-party dependencies.
 *
 * Wire format per chunk:
 *   [4 bytes: payload length uint32 big-endian]
 *   [12 bytes: IV]
 *   [N bytes: AES-256-GCM ciphertext]
 *   [16 bytes: GCM authentication tag]
 */
object TransferCrypto {

    private const val IV_LENGTH = 12
    private const val TAG_LENGTH_BITS = 128
    private const val TAG_LENGTH_BYTES = 16
    private const val KEY_LENGTH_BYTES = 32

    // ── Key generation ────────────────────────────────────────────────────────

    /**
     * Generate an ephemeral ECDH P-256 key pair.
     * Returns (publicKeyDerBytes, privateKey).
     * The public key is DER-encoded SubjectPublicKeyInfo (SPKI) — safe to send over wire.
     */
    fun generateKeyPair(): Pair<ByteArray, PrivateKey> {
        val gen = KeyPairGenerator.getInstance("EC")
        gen.initialize(ECGenParameterSpec("secp256r1"), SecureRandom())
        val kp = gen.generateKeyPair()
        // getEncoded() on an EC public key returns DER SPKI format
        return Pair(kp.public.encoded, kp.private)
    }

    // ── Key derivation ────────────────────────────────────────────────────────

    /**
     * Derive a 256-bit AES-GCM key via HKDF-SHA-256.
     *
     * Both sides must call this with the same inputs (order: sender then receiver)
     * to arrive at the same key.
     *
     * Steps:
     *  1. ECDH key agreement → shared secret
     *  2. HKDF-Extract: PRK = HMAC-SHA256(salt, sharedSecret)
     *     where salt = 32 zero bytes || senderPublicKeyDer || receiverPublicKeyDer
     *  3. HKDF-Expand: OKM = HMAC-SHA256(PRK, info || 0x01)
     *     where info = "wyre-transfer-v1"
     *  4. Return first 32 bytes as the AES key
     */
    fun deriveKey(
        privateKey: PrivateKey,
        peerPublicKeyDer: ByteArray,
        senderPublicKeyDer: ByteArray,
        receiverPublicKeyDer: ByteArray,
    ): ByteArray {
        // 1. ECDH key agreement
        val peerPublicKey = decodeSpkiPublicKey(peerPublicKeyDer)
        val ka = KeyAgreement.getInstance("ECDH")
        ka.init(privateKey)
        ka.doPhase(peerPublicKey, true)
        val sharedSecret = ka.generateSecret()

        // 2. HKDF-Extract
        // salt = 32 zero bytes || senderPublicKeyDer || receiverPublicKeyDer
        val zeroSalt = ByteArray(KEY_LENGTH_BYTES) { 0 }
        val combinedSalt = zeroSalt + senderPublicKeyDer + receiverPublicKeyDer
        val prk = hmacSha256(combinedSalt, sharedSecret)

        // 3. HKDF-Expand (single block, T(1))
        val info = "wyre-transfer-v1".toByteArray(Charsets.UTF_8)
        val t1Input = info + byteArrayOf(0x01)
        val okm = hmacSha256(prk, t1Input)

        // 4. Return first 32 bytes
        return okm.copyOf(KEY_LENGTH_BYTES)
    }

    // ── Encryption ────────────────────────────────────────────────────────────

    /**
     * Encrypt one chunk.
     * Returns Triple(iv, ciphertext, tag).
     *
     * Android's AES/GCM/NoPadding Cipher.doFinal() returns ciphertext || tag
     * concatenated — we split by taking the last 16 bytes as the tag.
     */
    fun encryptChunk(key: ByteArray, plaintext: ByteArray): Triple<ByteArray, ByteArray, ByteArray> {
        val iv = ByteArray(IV_LENGTH).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val keySpec = SecretKeySpec(key, "AES")
        val gcmSpec = GCMParameterSpec(TAG_LENGTH_BITS, iv)
        cipher.init(Cipher.ENCRYPT_MODE, keySpec, gcmSpec)
        val output = cipher.doFinal(plaintext)

        // output = ciphertext || tag (last TAG_LENGTH_BYTES bytes)
        val ciphertext = output.copyOf(output.size - TAG_LENGTH_BYTES)
        val tag = output.copyOfRange(output.size - TAG_LENGTH_BYTES, output.size)
        return Triple(iv, ciphertext, tag)
    }

    // ── Decryption ────────────────────────────────────────────────────────────

    /**
     * Decrypt one chunk. Throws AEADBadTagException on authentication failure.
     *
     * Android GCM expects ciphertext || tag concatenated before doFinal.
     */
    fun decryptChunk(key: ByteArray, iv: ByteArray, ciphertext: ByteArray, tag: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val keySpec = SecretKeySpec(key, "AES")
        val gcmSpec = GCMParameterSpec(TAG_LENGTH_BITS, iv)
        cipher.init(Cipher.DECRYPT_MODE, keySpec, gcmSpec)
        // Concatenate ciphertext + tag — Android GCM expects them together
        val combined = ciphertext + tag
        return cipher.doFinal(combined)
    }

    // ── Wire format ───────────────────────────────────────────────────────────

    /**
     * Encode to wire format:
     * [4-byte payload length][12-byte IV][ciphertext][16-byte tag]
     */
    fun encodeChunk(iv: ByteArray, ciphertext: ByteArray, tag: ByteArray): ByteArray {
        val payloadLength = iv.size + ciphertext.size + tag.size
        val result = ByteArray(4 + payloadLength)
        // Write big-endian uint32 length
        result[0] = (payloadLength shr 24).toByte()
        result[1] = (payloadLength shr 16).toByte()
        result[2] = (payloadLength shr 8).toByte()
        result[3] = payloadLength.toByte()
        var pos = 4
        iv.copyInto(result, pos); pos += iv.size
        ciphertext.copyInto(result, pos); pos += ciphertext.size
        tag.copyInto(result, pos)
        return result
    }

    /**
     * Decode one encrypted chunk from an InputStream.
     * Returns Triple(iv, ciphertext, tag) or null on EOF.
     * Throws on malformed data or stream errors.
     */
    fun decodeChunkFromStream(inputStream: InputStream): Triple<ByteArray, ByteArray, ByteArray>? {
        // Read 4-byte length
        val lenBuf = ByteArray(4)
        val lenRead = inputStream.readNBytes(lenBuf, 0, 4)
        if (lenRead == 0) return null // clean EOF
        if (lenRead < 4) throw java.io.IOException("Unexpected EOF reading chunk length")

        val payloadLength = ((lenBuf[0].toInt() and 0xFF) shl 24) or
                            ((lenBuf[1].toInt() and 0xFF) shl 16) or
                            ((lenBuf[2].toInt() and 0xFF) shl 8) or
                             (lenBuf[3].toInt() and 0xFF)

        if (payloadLength < IV_LENGTH + TAG_LENGTH_BYTES) {
            throw java.io.IOException("Chunk payload too small: $payloadLength bytes")
        }

        val payload = ByteArray(payloadLength)
        val payloadRead = inputStream.readNBytes(payload, 0, payloadLength)
        if (payloadRead < payloadLength) throw java.io.IOException("Unexpected EOF reading chunk payload")

        val iv = payload.copyOf(IV_LENGTH)
        val tag = payload.copyOfRange(payloadLength - TAG_LENGTH_BYTES, payloadLength)
        val ciphertext = payload.copyOfRange(IV_LENGTH, payloadLength - TAG_LENGTH_BYTES)

        return Triple(iv, ciphertext, tag)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    private fun hmacSha256(key: ByteArray, data: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal(data)
    }

    private fun decodeSpkiPublicKey(der: ByteArray): PublicKey {
        val spec = X509EncodedKeySpec(der)
        return KeyFactory.getInstance("EC").generatePublic(spec)
    }
}
