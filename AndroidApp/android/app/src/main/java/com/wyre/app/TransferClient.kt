package com.wyre.app

import java.io.File
import java.net.Socket
import java.security.MessageDigest

private const val CHUNK_SIZE = 64 * 1024
private const val PROGRESS_INTERVAL_MS = 150L

/**
 * TransferClient.kt
 * TCP client — connects to a peer's TransferServer and streams a file.
 *
 * Progress is emitted based on bytes written to the socket (sender-side),
 * not on receiver feedback. This avoids the need to read the input stream
 * concurrently while writing, which would require two threads.
 *
 * The receiver feedback is still drained after shutdownOutput so the
 * socket closes cleanly, but it is not used for progress reporting.
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

        onEvent(TransferEvent.Started(
            transferId = transferId,
            direction  = "send",
            peerId     = "",
            peerName   = senderName,
            fileName   = fileName,
            fileSize   = fileSize,
            status     = "connecting"
        ))

        try {
            val sock = Socket(peerIp, peerPort)
            socket = sock

            val out = sock.getOutputStream()
            val inp = sock.getInputStream()

            // ── 1. Send JSON header ───────────────────────────────────────────
            val header = buildHeader() + "\n"
            out.write(header.toByteArray(Charsets.UTF_8))
            out.flush()

            // ── 2. Read accept/decline (newline-terminated JSON) ──────────────
            val responseLine = readLine(inp) ?: throw Exception("No response from peer")
            val accepted = org.json.JSONObject(responseLine).optBoolean("accepted", false)
            if (!accepted) {
                onEvent(TransferEvent.Error(transferId, "Declined by recipient", "DECLINED"))
                sock.close()
                return
            }

            onEvent(TransferEvent.Started(
                transferId = transferId,
                direction  = "send",
                peerId     = "",
                peerName   = senderName,
                fileName   = fileName,
                fileSize   = fileSize,
                status     = "active"
            ))

            // ── 3. Stream file, emitting progress from sender side ────────────
            val file = File(filePath)
            var bytesSent = 0L
            var lastProgressTime = System.currentTimeMillis()
            var lastProgressBytes = 0L
            val buf = ByteArray(CHUNK_SIZE)

            file.inputStream().use { fis ->
                var read: Int
                while (fis.read(buf).also { read = it } != -1) {
                    if (cancelled) { sock.close(); return }

                    out.write(buf, 0, read)
                    bytesSent += read

                    val now = System.currentTimeMillis()
                    val elapsed = now - lastProgressTime

                    if (elapsed >= PROGRESS_INTERVAL_MS) {
                        val bytesInInterval = bytesSent - lastProgressBytes
                        val speed = if (elapsed > 0) (bytesInInterval * 1000L / elapsed) else 0L
                        val progress = if (fileSize > 0) ((bytesSent * 100L) / fileSize).toInt().coerceIn(0, 99) else 0
                        val eta = if (speed > 0) (fileSize - bytesSent) / speed else 0L

                        onEvent(TransferEvent.Progress(
                            transferId      = transferId,
                            progress        = progress,
                            speed           = speed,
                            eta             = eta,
                            bytesTransferred = bytesSent,
                            totalBytes      = fileSize
                        ))

                        lastProgressTime = now
                        lastProgressBytes = bytesSent
                    }
                }
            }

            out.flush()
            // Half-close write side — signals EOF to receiver
            sock.shutdownOutput()

            // ── 4. Drain receiver feedback until socket closes ────────────────
            // The desktop receiver sends progress JSON lines back; we drain them
            // so the TCP connection closes cleanly, but we don't use them for UI.
            try {
                val drainBuf = ByteArray(4096)
                while (inp.read(drainBuf) != -1) { /* drain */ }
            } catch (_: Exception) {}

            if (!cancelled) {
                onEvent(TransferEvent.Progress(transferId, 100, 0, 0, fileSize, fileSize))
                onEvent(TransferEvent.Complete(
                    transferId = transferId,
                    direction  = "send",
                    peerId     = "",
                    peerName   = senderName,
                    fileName   = fileName,
                    fileSize   = fileSize,
                    savedPath  = "",
                    startedAt  = startedAt
                ))
            }
            sock.close()

        } catch (e: Exception) {
            if (!cancelled) {
                onEvent(TransferEvent.Error(transferId, e.message ?: "Send failed", "SEND_ERROR"))
            }
        }
    }

    private fun buildHeader(): String = org.json.JSONObject().apply {
        put("transferId",      transferId)
        put("senderDeviceId",  senderDeviceId)
        put("senderName",      senderName)
        put("fileName",        fileName)
        put("fileSize",        fileSize)
        put("checksum",        computeChecksum())
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

    // Reads one newline-terminated line from the stream.
    // Only used for the initial accept/decline handshake.
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
