package com.wyre.app

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.provider.MediaStore
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
    private val onClipboardReceived: ((senderName: String, text: String, truncated: Boolean) -> Unit)? = null
) {
    private var serverSocket: ServerSocket? = null
    @Volatile private var running = false

    data class PendingEntry(
        val socket: Socket,
        val request: IncomingRequest,
        val remainingBytes: ByteArray
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

        out.write(("""{"accepted":true}""" + "\n").toByteArray())
        out.flush()

        executor.submit {
            receiveFile(entry.socket, entry.request, saveDir, entry.remainingBytes)
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

            val transferId     = json.getString("transferId")
            val senderDeviceId = json.getString("senderDeviceId")
            val senderName     = json.getString("senderName")
            val rawFileName    = json.getString("fileName")
            val fileSize       = json.getLong("fileSize")
            val checksum       = json.getString("checksum")

            val fileName = sanitizeFileName(rawFileName)

            // Read any bytes that arrived after the newline in the same packet
            val available = inp.available()
            if (available > 0) {
                remaining = ByteArray(available)
                inp.read(remaining)
            }

            val request = IncomingRequest(transferId, senderDeviceId, senderName, fileName, fileSize, checksum)
            pending[transferId] = PendingEntry(socket, request, remaining)
            onIncomingRequest(request)

        } catch (e: Exception) {
            socket.close()
        }
    }

    private fun receiveFile(socket: Socket, req: IncomingRequest, saveDir: String, initial: ByteArray) {
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
        var bytesReceived = 0L
        var lastProgressTime = System.currentTimeMillis()
        var lastBytes = 0L

        // On API 29+ use MediaStore to save directly to public Downloads
        // On older versions write directly to the file path
        val (outputStream, finalPath, cleanupOnError) = openOutputStream(req.fileName, saveDir)
            ?: run {
                onEvent(TransferEvent.Error(req.transferId, "Cannot open output stream", "PATH_ERROR"))
                socket.close()
                return
            }

        try {
            outputStream.use { fos ->
                if (initial.isNotEmpty()) {
                    fos.write(initial)
                    md.update(initial)
                    bytesReceived += initial.size
                }

                val inp = socket.getInputStream()
                val out = socket.getOutputStream()
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
    private fun openOutputStream(fileName: String, saveDir: String): Triple<OutputStream, String, () -> Unit>? {
        val publicDownloads = android.os.Environment
            .getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS)
            .absolutePath

        val isDefaultDownloads = saveDir.trimEnd('/') == publicDownloads.trimEnd('/')

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && isDefaultDownloads) {
            // Default Downloads on API 29+ — use MediaStore so file is visible immediately
            openViaMediaStore(fileName, "Download")
                ?: openDirectly(fileName, saveDir) // fallback if MediaStore fails
        } else {
            // Custom folder or API < 29 — write directly
            // The user granted write permission via ACTION_OPEN_DOCUMENT_TREE,
            // or we're on an older API where direct writes are always allowed.
            openDirectly(fileName, saveDir)
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
    private fun openDirectly(fileName: String, saveDir: String): Triple<OutputStream, String, () -> Unit>? {
        return try {
            val dir = File(saveDir)
            dir.mkdirs()
            val file = uniquePath(File(dir, fileName))
            val stream = file.outputStream()
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
