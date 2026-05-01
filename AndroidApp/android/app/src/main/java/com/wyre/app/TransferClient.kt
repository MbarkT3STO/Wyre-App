package com.wyre.app

import java.io.File
import java.net.Socket
import java.security.MessageDigest

private const val CHUNK_SIZE = 64 * 1024
private const val PROGRESS_INTERVAL_MS = 100L

/**
 * TransferClient.kt
 * TCP client — mirrors the desktop TransferClient.ts.
 * Connects to a peer's TransferServer, sends header, streams file.
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

            // Send JSON header
            val header = buildHeader() + "\n"
            out.write(header.toByteArray(Charsets.UTF_8))
            out.flush()

            // Read accept/decline response (newline-terminated JSON)
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

            // Stream file
            val file = File(filePath)
            var bytesSent = 0L
            var lastProgressTime = System.currentTimeMillis()
            var lastBytes = 0L
            val buf = ByteArray(CHUNK_SIZE)

            file.inputStream().use { fis ->
                var read: Int
                while (fis.read(buf).also { read = it } != -1) {
                    if (cancelled) { sock.close(); return }
                    out.write(buf, 0, read)
                    bytesSent += read

                    val now = System.currentTimeMillis()
                    if (now - lastProgressTime >= PROGRESS_INTERVAL_MS) {
                        val elapsed = (now - lastProgressTime) / 1000.0
                        val speed = if (elapsed > 0) ((bytesSent - lastBytes) / elapsed).toLong() else 0L
                        val eta = if (speed > 0) (fileSize - bytesSent) / speed else 0L
                        val progress = if (fileSize > 0) ((bytesSent * 100) / fileSize).toInt() else 0
                        onEvent(TransferEvent.Progress(transferId, progress, speed, eta, bytesSent, fileSize))
                        lastProgressTime = now
                        lastBytes = bytesSent
                    }
                }
            }

            out.flush()
            sock.shutdownOutput()

            // Read final feedback from receiver
            try {
                while (true) {
                    val line = readLine(inp) ?: break
                    val fb = org.json.JSONObject(line)
                    if (fb.optInt("p", -1) == 100) break
                }
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
