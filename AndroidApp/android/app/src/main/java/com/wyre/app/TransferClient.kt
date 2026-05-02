package com.wyre.app

import android.util.Base64
import java.io.File
import java.net.Socket
import java.security.MessageDigest

private const val CHUNK_SIZE = 1 * 1024 * 1024
private const val PROGRESS_INTERVAL_MS = 150L

/**
 * TransferClient.kt
 * TCP client — connects to a peer's TransferServer and streams a file.
 *
 * When peerSupportsEncryption is true, performs an ECDH P-256 handshake and
 * encrypts each chunk with AES-256-GCM before writing to the socket.
 * Falls back to plaintext if the peer does not accept encryption.
 */
class TransferClient(
    private val transferId: String,
    private val filePath: String,
    private val fileName: String,
    private val fileSize: Long,
    private val peerIp: String,
    private val peerPort: Int,
    private val senderDeviceId: String,
    private val senderName: String,
    private val resumeOffset: Long = 0,
    private val peerSupportsEncryption: Boolean = false,
    private val onEvent: (TransferEvent) -> Unit
) : Cancellable {

    @Volatile private var cancelled = false
    private var socket: Socket? = null

    override fun cancel() {
        cancelled = true
        socket?.close()
    }

    fun send() {
        val startedAt = System.currentTimeMillis()

        val file = File(filePath)
        val actualFileSize = if (fileSize > 0) fileSize else file.length()

        onEvent(TransferEvent.Started(
            transferId = transferId,
            direction  = "send",
            peerId     = "",
            peerName   = senderName,
            fileName   = fileName,
            fileSize   = actualFileSize,
            status     = "connecting"
        ))

        try {
            val sock = Socket(peerIp, peerPort)
            socket = sock

            val out = sock.getOutputStream()
            val inp = sock.getInputStream()

            // ── 1. Build and send JSON header ─────────────────────────────────
            var senderPubKeyDer: ByteArray? = null
            var senderPrivKey: java.security.PrivateKey? = null

            val headerJson = org.json.JSONObject().apply {
                put("transferId",      transferId)
                put("senderDeviceId",  senderDeviceId)
                put("senderName",      senderName)
                put("fileName",        fileName)
                put("fileSize",        actualFileSize)
                put("checksum",        computeChecksum())
                if (resumeOffset > 0) put("resumeOffset", resumeOffset)

                if (peerSupportsEncryption) {
                    val (pubKeyDer, privKey) = TransferCrypto.generateKeyPair()
                    senderPubKeyDer = pubKeyDer
                    senderPrivKey   = privKey
                    put("encryption", org.json.JSONObject().apply {
                        put("supported",       true)
                        put("senderPublicKey", Base64.encodeToString(pubKeyDer, Base64.NO_WRAP))
                    })
                }
            }

            out.write((headerJson.toString() + "\n").toByteArray(Charsets.UTF_8))
            out.flush()

            // ── 2. Read accept/decline response ───────────────────────────────
            val responseLine = readLine(inp) ?: throw Exception("No response from peer")
            val responseJson = org.json.JSONObject(responseLine)
            val accepted = responseJson.optBoolean("accepted", false)
            if (!accepted) {
                onEvent(TransferEvent.Error(transferId, "Declined by recipient", "DECLINED"))
                sock.close()
                return
            }

            // ── 3. Negotiate encryption ───────────────────────────────────────
            var encryptionKey: ByteArray? = null

            if (peerSupportsEncryption && senderPubKeyDer != null && senderPrivKey != null) {
                val encResp = responseJson.optJSONObject("encryption")
                if (encResp != null && encResp.optBoolean("accepted", false)) {
                    val receiverPubKeyB64 = encResp.optString("receiverPublicKey", "")
                    if (receiverPubKeyB64.isNotEmpty()) {
                        try {
                            val receiverPubKeyDer = Base64.decode(receiverPubKeyB64, Base64.NO_WRAP)
                            encryptionKey = TransferCrypto.deriveKey(
                                privateKey         = senderPrivKey!!,
                                peerPublicKeyDer   = receiverPubKeyDer,
                                senderPublicKeyDer = senderPubKeyDer!!,
                                receiverPublicKeyDer = receiverPubKeyDer,
                            )
                        } catch (_: Exception) {
                            // Key derivation failed — fall back to plaintext
                            encryptionKey = null
                        }
                    }
                }
            }

            onEvent(TransferEvent.Started(
                transferId = transferId,
                direction  = "send",
                peerId     = "",
                peerName   = senderName,
                fileName   = fileName,
                fileSize   = actualFileSize,
                status     = "active"
            ))

            // ── 4. Stream file ────────────────────────────────────────────────
            if (encryptionKey != null) {
                streamEncrypted(sock, out, inp, file, actualFileSize, encryptionKey!!, startedAt)
            } else {
                streamPlaintext(sock, out, inp, file, actualFileSize, startedAt)
            }

        } catch (e: Exception) {
            if (!cancelled) {
                onEvent(TransferEvent.Error(transferId, e.message ?: "Send failed", "SEND_ERROR"))
            } else {
                onEvent(TransferEvent.Error(transferId, "Cancelled", "CANCELLED"))
            }
        }
    }

    // ── Plaintext streaming (original behaviour) ──────────────────────────────

    private fun streamPlaintext(
        sock: Socket,
        out: java.io.OutputStream,
        inp: java.io.InputStream,
        file: File,
        actualFileSize: Long,
        startedAt: Long,
    ) {
        var bytesSent = resumeOffset
        var lastProgressTime = System.currentTimeMillis()
        var lastProgressBytes = resumeOffset
        val buf = ByteArray(CHUNK_SIZE)
        var chunksSinceFlush = 0

        val fis = java.io.FileInputStream(file)
        if (resumeOffset > 0) {
            var skipped = 0L
            while (skipped < resumeOffset) {
                val n = fis.skip(resumeOffset - skipped)
                if (n <= 0) break
                skipped += n
            }
        }
        fis.use { fis ->
            var read: Int
            while (fis.read(buf).also { read = it } != -1) {
                if (cancelled) {
                    sock.close()
                    onEvent(TransferEvent.Error(transferId, "Cancelled", "CANCELLED"))
                    return
                }

                out.write(buf, 0, read)
                bytesSent += read
                chunksSinceFlush++

                if (chunksSinceFlush >= 8) {
                    out.flush()
                    chunksSinceFlush = 0
                }

                emitProgressIfDue(bytesSent, actualFileSize, lastProgressTime, lastProgressBytes) { time, bytes ->
                    lastProgressTime = time
                    lastProgressBytes = bytes
                }
            }
        }

        out.flush()
        sock.shutdownOutput()
        drainFeedback(inp)

        if (!cancelled) {
            onEvent(TransferEvent.Progress(transferId, 100, 0, 0, actualFileSize, actualFileSize))
            onEvent(TransferEvent.Complete(
                transferId = transferId,
                direction  = "send",
                peerId     = "",
                peerName   = senderName,
                fileName   = fileName,
                fileSize   = actualFileSize,
                savedPath  = "",
                startedAt  = startedAt
            ))
        }
        sock.close()
    }

    // ── Encrypted streaming ───────────────────────────────────────────────────

    private fun streamEncrypted(
        sock: Socket,
        out: java.io.OutputStream,
        inp: java.io.InputStream,
        file: File,
        actualFileSize: Long,
        encryptionKey: ByteArray,
        startedAt: Long,
    ) {
        var bytesSent = resumeOffset
        var lastProgressTime = System.currentTimeMillis()
        var lastProgressBytes = resumeOffset
        val buf = ByteArray(CHUNK_SIZE)

        val fis = java.io.FileInputStream(file)
        if (resumeOffset > 0) {
            var skipped = 0L
            while (skipped < resumeOffset) {
                val n = fis.skip(resumeOffset - skipped)
                if (n <= 0) break
                skipped += n
            }
        }
        fis.use { fis ->
            var read: Int
            while (fis.read(buf).also { read = it } != -1) {
                if (cancelled) {
                    sock.close()
                    onEvent(TransferEvent.Error(transferId, "Cancelled", "CANCELLED"))
                    return
                }

                val plaintext = buf.copyOf(read)
                val (iv, ciphertext, tag) = TransferCrypto.encryptChunk(encryptionKey, plaintext)
                val encoded = TransferCrypto.encodeChunk(iv, ciphertext, tag)
                out.write(encoded)
                out.flush()

                bytesSent += read

                emitProgressIfDue(bytesSent, actualFileSize, lastProgressTime, lastProgressBytes) { time, bytes ->
                    lastProgressTime = time
                    lastProgressBytes = bytes
                }
            }
        }

        out.flush()
        sock.shutdownOutput()
        drainFeedback(inp)

        if (!cancelled) {
            onEvent(TransferEvent.Progress(transferId, 100, 0, 0, actualFileSize, actualFileSize))
            onEvent(TransferEvent.Complete(
                transferId = transferId,
                direction  = "send",
                peerId     = "",
                peerName   = senderName,
                fileName   = fileName,
                fileSize   = actualFileSize,
                savedPath  = "",
                startedAt  = startedAt
            ))
        }
        sock.close()
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private inline fun emitProgressIfDue(
        bytesSent: Long,
        actualFileSize: Long,
        lastProgressTime: Long,
        lastProgressBytes: Long,
        update: (Long, Long) -> Unit,
    ) {
        val now = System.currentTimeMillis()
        val elapsed = now - lastProgressTime
        if (bytesSent > 0 && elapsed >= PROGRESS_INTERVAL_MS) {
            val bytesInInterval = bytesSent - lastProgressBytes
            val speed = if (elapsed > 0) (bytesInInterval * 1000L / elapsed) else 0L
            val progress = if (actualFileSize > 0) ((bytesSent * 100L) / actualFileSize).toInt().coerceIn(1, 99) else 1
            val eta = if (speed > 0) (actualFileSize - bytesSent) / speed else 0L
            onEvent(TransferEvent.Progress(
                transferId       = transferId,
                progress         = progress,
                speed            = speed,
                eta              = eta,
                bytesTransferred = bytesSent,
                totalBytes       = actualFileSize
            ))
            update(now, bytesSent)
        }
    }

    private fun drainFeedback(inp: java.io.InputStream) {
        try {
            val drainBuf = ByteArray(4096)
            while (inp.read(drainBuf) != -1) { /* drain */ }
        } catch (_: Exception) {}
    }

    private fun buildHeader(actualFileSize: Long): String = org.json.JSONObject().apply {
        put("transferId",      transferId)
        put("senderDeviceId",  senderDeviceId)
        put("senderName",      senderName)
        put("fileName",        fileName)
        put("fileSize",        actualFileSize)
        put("checksum",        computeChecksum())
        if (resumeOffset > 0) put("resumeOffset", resumeOffset)
    }.toString()

    private fun computeChecksum(): String {
        val md = MessageDigest.getInstance("SHA-256")
        File(filePath).inputStream().use { fis ->
            val buf = ByteArray(CHUNK_SIZE)
            var read: Int
            while (fis.read(buf).also { read = it } != -1) md.update(buf, 0, read)
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    private fun readLine(inp: java.io.InputStream): String? {
        val sb = StringBuilder()
        var b: Int
        while (inp.read().also { b = it } != -1) {
            if (b == '\n'.code) return sb.toString()
            sb.append(b.toChar())
        }
        return if (sb.isNotEmpty()) sb.toString() else null
    }
}
