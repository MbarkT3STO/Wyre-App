package com.wyre.app

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.provider.MediaStore
import android.util.Base64
import androidx.annotation.RequiresApi
import java.io.File
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService

private const val CHUNK_SIZE = 1 * 1024 * 1024
private const val PROGRESS_INTERVAL_MS = 100L
private const val HEADER_MAX_BYTES = 4096

/**
 * TransferServer.kt
 * TCP server — mirrors the desktop TransferServer.ts.
 * Listens for incoming connections, parses header, waits for accept/decline.
 */
class TransferServer(
    private val context: Context,
    private val preferredPort: Int,
    private val executor: ExecutorService,
    private val settings: SettingsStore,
    private val onIncomingRequest: (IncomingRequest) -> Unit,
    private val onEvent: (TransferEvent) -> Unit,
    private val onClipboardReceived: ((senderName: String, text: String, truncated: Boolean) -> Unit)? = null,
    private val onChatHandshake: ((handshake: org.json.JSONObject, socket: java.net.Socket, remaining: ByteArray) -> Unit)? = null
) {
    private var serverSocket: ServerSocket? = null
    @Volatile private var running = false

    data class PendingEntry(
        val socket: Socket,
        val request: IncomingRequest,
        val remainingBytes: ByteArray,
        /** Receiver key pair — set when sender advertised encryption support */
        val receiverPubKeyDer: ByteArray? = null,
        val receiverPrivKey: java.security.PrivateKey? = null,
        /** Derived AES-256-GCM key — set after key exchange */
        val encryptionKey: ByteArray? = null
    )

    private val pending = ConcurrentHashMap<String, PendingEntry>()

    fun start(): Int {
        val port = try { preferredPort.takeIf { it > 0 } ?: 0 } catch (_: Exception) { 0 }
        val ss = ServerSocket(port)
        serverSocket = ss
        running = true

        executor.submit {
            while (running) {
                try {
                    val client = ss.accept()
                    executor.submit { handleConnection(client) }
                } catch (_: Exception) { if (!running) break }
            }
        }

        return ss.localPort
    }

    fun stop() {
        running = false
        pending.values.forEach { it.socket.close() }
        pending.clear()
        serverSocket?.close()
    }

    fun isPending(transferId: String) = pending.containsKey(transferId)

    fun respond(transferId: String, accepted: Boolean, saveDir: String) {
        val entry = pending.remove(transferId) ?: return
        val out = entry.socket.getOutputStream()

        if (!accepted) {
            out.write(("""{"accepted":false}""" + "\n").toByteArray())
            out.flush()
            entry.socket.close()
            return
        }

        // Validate the requested resume offset against any existing partial file
        val headerResumeOffset = entry.request.resumeOffset
        val validatedOffset = if (headerResumeOffset > 0) {
            val partial = File(saveDir, entry.request.fileName)
            if (partial.exists() && partial.length() == headerResumeOffset) headerResumeOffset else 0L
        } else {
            0L
        }

        // Build accept response — include encryption key if negotiated
        val responseJson = org.json.JSONObject().apply {
            put("accepted",      true)
            put("resumeOffset",  validatedOffset)
            if (entry.receiverPubKeyDer != null && entry.encryptionKey != null) {
                put("encryption", org.json.JSONObject().apply {
                    put("accepted",          true)
                    put("receiverPublicKey", Base64.encodeToString(entry.receiverPubKeyDer, Base64.NO_WRAP))
                })
            }
        }
        out.write((responseJson.toString() + "\n").toByteArray())
        out.flush()

        executor.submit {
            receiveFile(entry.socket, entry.request, saveDir, entry.remainingBytes, validatedOffset, entry.encryptionKey)
        }
    }

    private fun handleConnection(socket: Socket) {
        val inp = socket.getInputStream()
        val headerBuf = StringBuilder()
        var remaining = ByteArray(0)

        try {
            // Read until newline (header terminator), max HEADER_MAX_BYTES
            val tmp = ByteArray(1)
            while (headerBuf.length < HEADER_MAX_BYTES) {
                if (inp.read(tmp) == -1) break
                if (tmp[0] == '\n'.code.toByte()) break
                headerBuf.append(tmp[0].toInt().toChar())
            }

            val json = org.json.JSONObject(headerBuf.toString())

            // ── Clipboard frame — not a file transfer ──────────────────────────
            if (json.optString("type") == "clipboard") {
                val senderName = json.optString("senderName", "Unknown")
                val text       = json.optString("text", "")
                val truncated  = json.optBoolean("truncated", false)
                socket.close()
                onClipboardReceived?.invoke(senderName, text, truncated)
                return
            }

            // ── Chat handshake — route to ChatManager ──────────────────────────
            if (json.optString("type") == "chat_handshake") {
                // Pass the socket and any bytes already read after the header line
                val available = inp.available()
                val chatRemaining = if (available > 0) {
                    val buf = ByteArray(available)
                    inp.read(buf)
                    buf
                } else {
                    ByteArray(0)
                }
                onChatHandshake?.invoke(json, socket, chatRemaining)
                    ?: socket.close()  // no handler registered — close gracefully
                return
            }

            val transferId     = json.getString("transferId")
            val senderDeviceId = json.getString("senderDeviceId")
            val senderName     = json.getString("senderName")
            val rawFileName    = json.getString("fileName")
            val fileSize       = json.getLong("fileSize")
            val checksum       = json.getString("checksum")
            val resumeOffset   = json.optLong("resumeOffset", 0L)

            val fileName = sanitizeFileName(rawFileName)

            // ── Encryption handshake ───────────────────────────────────────────
            var receiverPubKeyDer: ByteArray? = null
            var receiverPrivKey: java.security.PrivateKey? = null
            var encryptionKey: ByteArray? = null

            val encField = json.optJSONObject("encryption")
            if (encField != null && encField.optBoolean("supported", false)) {
                val senderPubKeyB64 = encField.optString("senderPublicKey", "")
                if (senderPubKeyB64.isNotEmpty()) {
                    try {
                        val senderPubKeyDer = Base64.decode(senderPubKeyB64, Base64.NO_WRAP)
                        val (recvPubDer, recvPriv) = TransferCrypto.generateKeyPair()
                        receiverPubKeyDer = recvPubDer
                        receiverPrivKey   = recvPriv
                        encryptionKey = TransferCrypto.deriveKey(
                            privateKey           = recvPriv,
                            peerPublicKeyDer     = senderPubKeyDer,
                            senderPublicKeyDer   = senderPubKeyDer,
                            receiverPublicKeyDer = recvPubDer,
                        )
                    } catch (_: Exception) {
                        // Key exchange failed — fall back to plaintext
                        receiverPubKeyDer = null
                        receiverPrivKey   = null
                        encryptionKey     = null
                    }
                }
            }

            // Read any bytes that arrived after the newline in the same packet
            val available = inp.available()
            if (available > 0) {
                remaining = ByteArray(available)
                inp.read(remaining)
            }

            val request = IncomingRequest(transferId, senderDeviceId, senderName, fileName, fileSize, checksum, resumeOffset)
            pending[transferId] = PendingEntry(socket, request, remaining, receiverPubKeyDer, receiverPrivKey, encryptionKey)
            onIncomingRequest(request)

        } catch (e: Exception) {
            socket.close()
        }
    }

    private fun receiveFile(socket: Socket, req: IncomingRequest, saveDir: String, initial: ByteArray, validatedOffset: Long = 0L, encryptionKey: ByteArray? = null) {
        val startedAt = System.currentTimeMillis()
        onEvent(TransferEvent.Started(
            transferId = req.transferId,
            direction  = "receive",
            peerId     = req.senderDeviceId,
            peerName   = req.senderName,
            fileName   = req.fileName,
            fileSize   = req.fileSize,
            status     = "active"
        ))

        val md = MessageDigest.getInstance("SHA-256")
        var bytesReceived = validatedOffset
        var lastProgressTime = System.currentTimeMillis()
        var lastBytes = validatedOffset

        val (outputStream, finalPath, cleanupOnError) = openOutputStream(req.fileName, saveDir, validatedOffset)
            ?: run {
                onEvent(TransferEvent.Error(req.transferId, "Cannot open output stream", "PATH_ERROR"))
                socket.close()
                return
            }

        try {
            outputStream.use { fos ->
                val inp = socket.getInputStream()
                val out = socket.getOutputStream()

                if (encryptionKey != null) {
                    // ── Encrypted receive path ─────────────────────────────────
                    // Process any bytes that arrived with the header first
                    // (unlikely for encrypted transfers but handle for correctness)
                    // For encrypted mode we use the stream-based decoder.
                    // We need to prepend `initial` to the stream — wrap it.
                    val combinedStream = if (initial.isNotEmpty()) {
                        java.io.SequenceInputStream(
                            java.io.ByteArrayInputStream(initial),
                            inp
                        )
                    } else {
                        inp
                    }

                    while (true) {
                        val chunk = try {
                            TransferCrypto.decodeChunkFromStream(combinedStream) ?: break
                        } catch (_: java.io.IOException) {
                            break // EOF or stream closed
                        }

                        val (iv, ciphertext, tag) = chunk
                        val plaintext = try {
                            TransferCrypto.decryptChunk(encryptionKey, iv, ciphertext, tag)
                        } catch (_: javax.crypto.AEADBadTagException) {
                            cleanupOnError()
                            onEvent(TransferEvent.Error(req.transferId, "GCM authentication tag mismatch — transfer aborted", "DECRYPT_AUTH_FAILED"))
                            socket.close()
                            return
                        } catch (_: Exception) {
                            cleanupOnError()
                            onEvent(TransferEvent.Error(req.transferId, "Decryption failed", "DECRYPT_AUTH_FAILED"))
                            socket.close()
                            return
                        }

                        fos.write(plaintext)
                        md.update(plaintext)
                        bytesReceived += plaintext.size

                        val now = System.currentTimeMillis()
                        if (now - lastProgressTime >= PROGRESS_INTERVAL_MS) {
                            val elapsed = (now - lastProgressTime) / 1000.0
                            val speed = if (elapsed > 0) ((bytesReceived - lastBytes) / elapsed).toLong() else 0L
                            val eta = if (speed > 0) (req.fileSize - bytesReceived) / speed else 0L
                            val progress = if (req.fileSize > 0) ((bytesReceived * 100) / req.fileSize).toInt().coerceAtMost(99) else 0
                            onEvent(TransferEvent.Progress(req.transferId, progress, speed, eta, bytesReceived, req.fileSize))
                            try {
                                val fb = """{"p":$progress,"b":$bytesReceived,"s":$speed,"e":$eta}""" + "\n"
                                out.write(fb.toByteArray())
                                out.flush()
                            } catch (_: Exception) {}
                            lastProgressTime = now
                            lastBytes = bytesReceived
                        }
                    }

                } else {
                    // ── Plaintext receive path (original behaviour) ────────────
                    if (initial.isNotEmpty()) {
                        fos.write(initial)
                        md.update(initial)
                        bytesReceived += initial.size
                    }

                    val buf = ByteArray(CHUNK_SIZE)
                    var read: Int

                    while (inp.read(buf).also { read = it } != -1) {
                        fos.write(buf, 0, read)
                        md.update(buf, 0, read)
                        bytesReceived += read

                        val now = System.currentTimeMillis()
                        if (now - lastProgressTime >= PROGRESS_INTERVAL_MS) {
                            val elapsed = (now - lastProgressTime) / 1000.0
                            val speed = if (elapsed > 0) ((bytesReceived - lastBytes) / elapsed).toLong() else 0L
                            val eta = if (speed > 0) (req.fileSize - bytesReceived) / speed else 0L
                            val progress = if (req.fileSize > 0) ((bytesReceived * 100) / req.fileSize).toInt().coerceAtMost(99) else 0
                            onEvent(TransferEvent.Progress(req.transferId, progress, speed, eta, bytesReceived, req.fileSize))
                            try {
                                val fb = """{"p":$progress,"b":$bytesReceived,"s":$speed,"e":$eta}""" + "\n"
                                out.write(fb.toByteArray())
                                out.flush()
                            } catch (_: Exception) {}
                            lastProgressTime = now
                            lastBytes = bytesReceived
                        }
                    }
                }
            }

            val receivedChecksum = md.digest().joinToString("") { "%02x".format(it) }
            if (receivedChecksum != req.checksum) {
                cleanupOnError()
                onEvent(TransferEvent.Error(req.transferId, "Checksum mismatch — file corrupted", "CHECKSUM_ERROR"))
            } else {
                onEvent(TransferEvent.Complete(
                    transferId = req.transferId,
                    direction  = "receive",
                    peerId     = req.senderDeviceId,
                    peerName   = req.senderName,
                    fileName   = req.fileName,
                    fileSize   = req.fileSize,
                    savedPath  = finalPath,
                    startedAt  = startedAt
                ))
            }
        } catch (e: Exception) {
            cleanupOnError()
            onEvent(TransferEvent.Error(req.transferId, e.message ?: "Receive failed", "RECEIVE_ERROR"))
        } finally {
            socket.close()
        }
    }

    /**
     * Opens an OutputStream for saving a received file.
     * Returns (stream, displayPath, cleanupFn) or null on failure.
     *
     * Strategy:
     * - Default Downloads folder on API 29+ → MediaStore (immediately visible in Files app)
     * - Any custom folder → write directly to the path
     *   (user granted permission via ACTION_OPEN_DOCUMENT_TREE, or API < 29)
     */
    private fun openOutputStream(fileName: String, saveDir: String, resumeOffset: Long = 0L): Triple<OutputStream, String, () -> Unit>? {
        val publicDownloads = android.os.Environment
            .getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS)
            .absolutePath

        val isDefaultDownloads = saveDir.trimEnd('/') == publicDownloads.trimEnd('/')

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && isDefaultDownloads) {
            // Default Downloads on API 29+ — use MediaStore so file is visible immediately
            // Resume not supported via MediaStore; fall back to direct write for resumes
            if (resumeOffset > 0) {
                openDirectly(fileName, saveDir, resumeOffset)
            } else {
                openViaMediaStore(fileName, "Download")
                    ?: openDirectly(fileName, saveDir, 0L) // fallback if MediaStore fails
            }
        } else {
            // Custom folder or API < 29 — write directly
            openDirectly(fileName, saveDir, resumeOffset)
        }
    }

    /** Save via MediaStore — file appears in Files app immediately, no media scan needed */
    @RequiresApi(Build.VERSION_CODES.Q)
    private fun openViaMediaStore(fileName: String, relativePath: String): Triple<OutputStream, String, () -> Unit>? {
        val resolver = context.contentResolver

        // Use the general Files collection — works for any folder, not just Downloads
        val collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)

        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
            put(MediaStore.MediaColumns.MIME_TYPE, guessMime(fileName))
            put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath.trimEnd('/') + "/")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }

        val uri = resolver.insert(collection, values) ?: return null
        val stream = resolver.openOutputStream(uri) ?: run {
            resolver.delete(uri, null, null)
            return null
        }

        val displayPath = "/storage/emulated/0/${relativePath.trimEnd('/')}/$fileName"
        val cleanup: () -> Unit = { resolver.delete(uri, null, null); Unit }

        return Triple(object : OutputStream() {
            override fun write(b: Int) = stream.write(b)
            override fun write(b: ByteArray, off: Int, len: Int) = stream.write(b, off, len)
            override fun flush() = stream.flush()
            override fun close() {
                stream.close()
                val update = ContentValues().apply {
                    put(MediaStore.MediaColumns.IS_PENDING, 0)
                }
                resolver.update(uri, update, null, null)
            }
        }, displayPath, cleanup)
    }

    /** Write directly to a file path — used for custom folders and API < 29 */
    private fun openDirectly(fileName: String, saveDir: String, resumeOffset: Long = 0L): Triple<OutputStream, String, () -> Unit>? {
        return try {
            val dir = File(saveDir)
            dir.mkdirs()
            val file = if (resumeOffset > 0) File(dir, fileName) else uniquePath(File(dir, fileName))
            val stream = java.io.FileOutputStream(file, resumeOffset > 0) // append when resuming
            Triple(stream, file.absolutePath, { file.delete(); Unit })
        } catch (_: Exception) { null }
    }

    private fun guessMime(fileName: String): String {
        val ext = fileName.substringAfterLast('.', "").lowercase()
        return android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "*/*"
    }

    private fun sanitizeFileName(raw: String): String {
        var name = File(raw).name
        name = name.replace(Regex("[\\x00-\\x1F\\x7F]"), "")
        name = name.replace(Regex("[\\\\/:*?\"<>|]"), "_")
        name = name.trimStart('.', ' ')
        if (name.isEmpty()) name = "file"
        return name.take(255)
    }

    private fun uniquePath(file: File): File {
        if (!file.exists()) return file
        val name = file.nameWithoutExtension
        val ext  = if (file.extension.isNotEmpty()) ".${file.extension}" else ""
        var counter = 1
        while (counter < 1000) {
            val candidate = File(file.parent, "$name ($counter)$ext")
            if (!candidate.exists()) return candidate
            counter++
        }
        return File(file.parent, "$name (${System.currentTimeMillis()})$ext")
    }
}
