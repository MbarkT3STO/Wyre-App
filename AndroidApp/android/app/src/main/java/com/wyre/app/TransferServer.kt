package com.wyre.app

import android.content.Context
import java.io.File
import java.io.InputStream
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService

private const val CHUNK_SIZE = 64 * 1024
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
    private val onEvent: (TransferEvent) -> Unit
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

        val savePath = uniquePath(File(saveDir, req.fileName))
        val md = MessageDigest.getInstance("SHA-256")
        var bytesReceived = 0L
        var lastProgressTime = System.currentTimeMillis()
        var lastBytes = 0L

        try {
            File(savePath.parent!!).mkdirs()
            savePath.outputStream().use { fos ->
                // Write bytes that arrived with the header
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
                        // Send feedback to sender
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
                savePath.delete()
                onEvent(TransferEvent.Error(req.transferId, "Checksum mismatch — file corrupted", "CHECKSUM_ERROR"))
            } else {
                onEvent(TransferEvent.Complete(
                    transferId = req.transferId,
                    direction  = "receive",
                    peerId     = req.senderDeviceId,
                    peerName   = req.senderName,
                    fileName   = req.fileName,
                    fileSize   = req.fileSize,
                    savedPath  = savePath.absolutePath,
                    startedAt  = startedAt
                ))
            }
        } catch (e: Exception) {
            savePath.delete()
            onEvent(TransferEvent.Error(req.transferId, e.message ?: "Receive failed", "RECEIVE_ERROR"))
        } finally {
            socket.close()
        }
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
