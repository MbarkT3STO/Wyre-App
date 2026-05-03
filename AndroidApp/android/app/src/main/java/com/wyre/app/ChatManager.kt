package com.wyre.app

import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.Socket
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService

private const val TAG = "ChatManager"
private const val MAX_TEXT_LENGTH = 10_000

/**
 * ChatManager.kt
 * Implements peer-to-peer chat over the SAME TCP port as file transfers.
 *
 * Wire protocol (identical to desktop ChatServer.ts):
 *   Initiator → Receiver:
 *     { "type": "chat_handshake", "senderDeviceId": "...", "senderName": "..." }\n
 *   Receiver → Initiator:
 *     { "accepted": true }\n  OR  { "accepted": false }\n
 *   Both sides then exchange newline-delimited JSON frames:
 *     { "type": "chat", "id": "...", "senderDeviceId": "...", "msgType": "text", "text": "...", "timestamp": 0 }\n
 *     { "type": "chat_ack", "id": "..." }\n
 *     { "type": "chat_edit", "id": "...", "senderDeviceId": "...", "newText": "...", "editedAt": 0 }\n
 *     { "type": "chat_delete", "id": "...", "senderDeviceId": "..." }\n
 *     { "type": "chat_close", "senderDeviceId": "..." }\n
 *
 * Session IDs match the desktop format: "chat_{peerId}"
 *
 * Incoming connections are routed here by TransferServer when it detects
 * type == "chat_handshake" in the first JSON header line.
 */
class ChatManager(
    private val executor: ExecutorService,
    private val localDeviceId: String,
    private val localDeviceName: String,
    private val notifyFn: (event: String, data: JSObject) -> Unit
) {
    // sessionId → active session state
    private val sessions = ConcurrentHashMap<String, ChatSessionState>()

    // sessionId → open socket (for sending)
    private val sockets = ConcurrentHashMap<String, Socket>()

    // sessionId → pending incoming socket (waiting for JS accept/decline)
    private val pendingInvites = ConcurrentHashMap<String, Socket>()

    // ── Open session (initiator side) ─────────────────────────────────────────

    /**
     * Connects to peerIp:peerPort (the transfer port), sends chat_handshake,
     * waits for { "accepted": true/false } response.
     * Runs on a background thread — call from executor.
     */
    fun openSession(peerId: String, peerName: String, peerIp: String, peerPort: Int): JSObject {
        val sessionId = makeSessionId(peerId)

        // Reuse existing connected session
        val existing = sessions[sessionId]
        if (existing != null && sockets[sessionId]?.isClosed == false) {
            return existing.toJSObject()
        }

        val socket = Socket(peerIp, peerPort)
        socket.soTimeout = 10_000
        socket.tcpNoDelay = true

        val out = socket.getOutputStream()

        // Send handshake — same format as desktop ChatClient.ts
        val handshake = JSONObject().apply {
            put("type",           "chat_handshake")
            put("senderDeviceId", localDeviceId)
            put("senderName",     localDeviceName)
        }
        out.write((handshake.toString() + "\n").toByteArray(Charsets.UTF_8))
        out.flush()

        // Wait for accept/decline response
        val reader = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.UTF_8))
        val responseLine = reader.readLine()
            ?: throw Exception("Peer closed connection during handshake")

        val response = JSONObject(responseLine)
        if (!response.optBoolean("accepted", false)) {
            socket.close()
            throw Exception("Chat invite declined by peer")
        }

        socket.soTimeout = 0  // no timeout for live session

        val session = ChatSessionState(
            id           = sessionId,
            peerId       = peerId,
            peerName     = peerName,
            connected    = true,
            messages     = mutableListOf(),
            lastActivity = System.currentTimeMillis(),
            unreadCount  = 0
        )
        sessions[sessionId] = session
        sockets[sessionId]  = socket

        // Start read loop
        executor.submit { readLoop(sessionId, socket, reader) }

        return session.toJSObject()
    }

    // ── Incoming connection (acceptor side) ───────────────────────────────────

    /**
     * Called by TransferServer when it detects a chat_handshake frame.
     * The socket is already paused; remainingBuffer contains bytes after the header line.
     */
    fun handleIncomingConnection(
        socket: Socket,
        handshake: JSONObject,
        remainingBuffer: ByteArray
    ) {
        val peerId    = handshake.getString("senderDeviceId")
        val peerName  = handshake.optString("senderName", "Unknown")
        val sessionId = makeSessionId(peerId)

        // Close any existing session for this peer
        sockets.remove(sessionId)?.let { runCatching { it.close() } }

        val session = ChatSessionState(
            id           = sessionId,
            peerId       = peerId,
            peerName     = peerName,
            connected    = false,
            messages     = sessions[sessionId]?.messages ?: mutableListOf(),
            lastActivity = System.currentTimeMillis(),
            unreadCount  = 0
        )
        sessions[sessionId]       = session
        pendingInvites[sessionId] = socket

        // Notify JS of the invite
        val invite = JSObject()
        invite.put("sessionId", sessionId)
        invite.put("peerId",    peerId)
        invite.put("peerName",  peerName)
        notifyFn("chatInvite", invite)
    }

    // ── Accept / decline invite ───────────────────────────────────────────────

    fun acceptInvite(sessionId: String) {
        val socket = pendingInvites.remove(sessionId) ?: return
        val session = sessions[sessionId] ?: return

        // Send accept response — same format as desktop ChatServer.acceptSession()
        try {
            socket.getOutputStream().write(
                (JSONObject().apply { put("accepted", true) }.toString() + "\n")
                    .toByteArray(Charsets.UTF_8)
            )
            socket.getOutputStream().flush()
        } catch (e: Exception) {
            Log.e(TAG, "acceptInvite: failed to send accept: ${e.message}")
            runCatching { socket.close() }
            return
        }

        session.connected = true
        sockets[sessionId] = socket
        notifySessionUpdated(sessionId)

        val reader = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.UTF_8))
        executor.submit { readLoop(sessionId, socket, reader) }
    }

    fun declineInvite(sessionId: String) {
        val socket = pendingInvites.remove(sessionId) ?: return
        sessions.remove(sessionId)
        try {
            socket.getOutputStream().write(
                (JSONObject().apply { put("accepted", false) }.toString() + "\n")
                    .toByteArray(Charsets.UTF_8)
            )
            socket.getOutputStream().flush()
        } catch (_: Exception) {}
        runCatching { socket.close() }
    }

    // ── Close session ─────────────────────────────────────────────────────────

    fun closeSession(sessionId: String) {
        val socket = sockets.remove(sessionId) ?: return
        try {
            val close = JSONObject().apply {
                put("type",           "chat_close")
                put("senderDeviceId", localDeviceId)
            }
            socket.getOutputStream().write((close.toString() + "\n").toByteArray(Charsets.UTF_8))
            socket.getOutputStream().flush()
        } catch (_: Exception) {}
        runCatching { socket.close() }
        sessions[sessionId]?.connected = false
        notifySessionUpdated(sessionId)
    }

    // ── Send text ─────────────────────────────────────────────────────────────

    fun sendText(sessionId: String, text: String): JSObject? {
        val socket  = sockets[sessionId]  ?: return null
        val session = sessions[sessionId] ?: return null

        val messageId = UUID.randomUUID().toString()
        val timestamp = System.currentTimeMillis()
        val safeText  = text.take(MAX_TEXT_LENGTH)

        val frame = JSONObject().apply {
            put("type",           "chat")
            put("id",             messageId)
            put("senderDeviceId", localDeviceId)
            put("senderName",     localDeviceName)
            put("msgType",        "text")
            put("text",           safeText)
            put("timestamp",      timestamp)
        }

        return try {
            socket.getOutputStream().write((frame.toString() + "\n").toByteArray(Charsets.UTF_8))
            socket.getOutputStream().flush()

            val msg = ChatMessageData(
                id         = messageId,
                sessionId  = sessionId,
                senderId   = localDeviceId,
                senderName = localDeviceName,
                isOwn      = true,
                type       = "text",
                text       = safeText,
                timestamp  = timestamp,
                status     = "sent"
            )
            session.messages.add(msg)
            session.lastActivity = timestamp

            val result = JSObject()
            result.put("messageId", messageId)
            result
        } catch (e: Exception) {
            Log.e(TAG, "sendText failed: ${e.message}")
            null
        }
    }

    // ── Send file (base64 inline) ─────────────────────────────────────────────

    fun sendFileBase64(sessionId: String, fileName: String, fileSize: Long, base64: String): JSObject? {
        val socket  = sockets[sessionId]  ?: return null
        val session = sessions[sessionId] ?: return null

        val messageId = UUID.randomUUID().toString()
        val timestamp = System.currentTimeMillis()
        val ext       = fileName.substringAfterLast('.', "").lowercase()
        val isImage   = ext in listOf("jpg", "jpeg", "png", "gif", "webp", "bmp", "svg")
        val msgType   = if (isImage) "image" else "file"

        val frame = JSONObject().apply {
            put("type",           "chat")
            put("id",             messageId)
            put("senderDeviceId", localDeviceId)
            put("senderName",     localDeviceName)
            put("msgType",        msgType)
            put("fileName",       fileName)
            put("fileSize",       fileSize)
            put("thumbnail",      base64)
            put("timestamp",      timestamp)
        }

        return try {
            socket.getOutputStream().write((frame.toString() + "\n").toByteArray(Charsets.UTF_8))
            socket.getOutputStream().flush()

            val msg = ChatMessageData(
                id         = messageId,
                sessionId  = sessionId,
                senderId   = localDeviceId,
                senderName = localDeviceName,
                isOwn      = true,
                type       = msgType,
                text       = null,
                fileName   = fileName,
                fileSize   = fileSize,
                timestamp  = timestamp,
                status     = "sent"
            )
            session.messages.add(msg)
            session.lastActivity = timestamp

            val result = JSObject()
            result.put("messageId", messageId)
            result
        } catch (e: Exception) {
            Log.e(TAG, "sendFileBase64 failed: ${e.message}")
            null
        }
    }

    // ── Edit message ──────────────────────────────────────────────────────────

    fun editMessage(sessionId: String, messageId: String, newText: String) {
        val socket  = sockets[sessionId]  ?: return
        val session = sessions[sessionId] ?: return
        val editedAt = System.currentTimeMillis()

        val frame = JSONObject().apply {
            put("type",           "chat_edit")
            put("id",             messageId)
            put("senderDeviceId", localDeviceId)
            put("newText",        newText.take(MAX_TEXT_LENGTH))
            put("editedAt",       editedAt)
        }

        try {
            socket.getOutputStream().write((frame.toString() + "\n").toByteArray(Charsets.UTF_8))
            socket.getOutputStream().flush()
        } catch (e: Exception) {
            Log.e(TAG, "editMessage failed: ${e.message}")
        }

        // Update local copy
        val msg = session.messages.find { it.id == messageId }
        if (msg != null) {
            msg.text     = newText
            msg.editedAt = editedAt
            notifySessionUpdated(sessionId)
        }
    }

    // ── Delete message ────────────────────────────────────────────────────────

    fun deleteMessage(sessionId: String, messageId: String) {
        val socket  = sockets[sessionId]  ?: return
        val session = sessions[sessionId] ?: return

        val frame = JSONObject().apply {
            put("type",           "chat_delete")
            put("id",             messageId)
            put("senderDeviceId", localDeviceId)
        }

        try {
            socket.getOutputStream().write((frame.toString() + "\n").toByteArray(Charsets.UTF_8))
            socket.getOutputStream().flush()
        } catch (e: Exception) {
            Log.e(TAG, "deleteMessage failed: ${e.message}")
        }

        // Update local copy
        val msg = session.messages.find { it.id == messageId }
        if (msg != null) {
            msg.deleted = true
            notifySessionUpdated(sessionId)
        }
    }

    fun getSessionsJson(): JSArray {
        val arr = JSArray()
        sessions.values.forEach { arr.put(it.toJSObject()) }
        return arr
    }

    fun markRead(sessionId: String) {
        sessions[sessionId]?.unreadCount = 0
        notifySessionUpdated(sessionId)
    }

    fun stop() {
        sockets.values.forEach { runCatching { it.close() } }
        sockets.clear()
        pendingInvites.values.forEach { runCatching { it.close() } }
        pendingInvites.clear()
        sessions.clear()
    }

    // ── Read loop ─────────────────────────────────────────────────────────────

    private fun readLoop(sessionId: String, socket: Socket, reader: BufferedReader) {
        try {
            var line: String?
            while (reader.readLine().also { line = it } != null) {
                val json = try { JSONObject(line!!) } catch (_: Exception) { continue }
                handleFrame(sessionId, json)
            }
        } catch (_: Exception) {
            // Connection closed or error
        } finally {
            sockets.remove(sessionId)
            sessions[sessionId]?.connected = false
            notifySessionUpdated(sessionId)
            runCatching { socket.close() }
        }
    }

    private fun handleFrame(sessionId: String, json: JSONObject) {
        val session = sessions[sessionId] ?: return

        when (json.optString("type")) {
            "chat" -> {
                val messageId  = json.optString("id").ifEmpty { return }
                val senderId   = json.optString("senderDeviceId").ifEmpty { return }
                val senderName = json.optString("senderName", session.peerName)
                val msgType    = json.optString("msgType", "text")
                val text       = json.optString("text").ifEmpty { null }
                val fileName   = json.optString("fileName").ifEmpty { null }
                val fileSize   = json.optLong("fileSize", 0L).takeIf { it > 0 }
                val timestamp  = json.optLong("timestamp", System.currentTimeMillis())

                val msg = ChatMessageData(
                    id         = messageId,
                    sessionId  = sessionId,
                    senderId   = senderId,
                    senderName = senderName,
                    isOwn      = senderId == localDeviceId,
                    type       = msgType,
                    text       = text,
                    fileName   = fileName,
                    fileSize   = fileSize,
                    timestamp  = timestamp,
                    status     = "delivered"
                )
                session.messages.add(msg)
                session.lastActivity = timestamp
                session.unreadCount++

                // Auto-ack
                sendAck(sessionId, messageId)

                val payload = JSObject()
                payload.put("sessionId", sessionId)
                payload.put("message",   msg.toJSObject())
                notifyFn("chatMessage", payload)
                notifySessionUpdated(sessionId)
            }

            "chat_ack" -> {
                val messageId = json.optString("id").ifEmpty { return }
                val msg = session.messages.find { it.id == messageId }
                if (msg != null && msg.status != "delivered") {
                    msg.status = "delivered"
                    val payload = JSObject()
                    payload.put("sessionId", sessionId)
                    payload.put("messageId", messageId)
                    payload.put("status",    "delivered")
                    notifyFn("chatMessageStatus", payload)
                }
            }

            "chat_edit" -> {
                val messageId = json.optString("id").ifEmpty { return }
                val newText   = json.optString("newText")
                val editedAt  = json.optLong("editedAt", System.currentTimeMillis())
                val msg = session.messages.find { it.id == messageId }
                if (msg != null) {
                    msg.text     = newText
                    msg.editedAt = editedAt
                    val payload = JSObject()
                    payload.put("sessionId", sessionId)
                    payload.put("message",   msg.toJSObject())
                    notifyFn("chatMessage", payload)
                }
            }

            "chat_delete" -> {
                val messageId = json.optString("id").ifEmpty { return }
                val msg = session.messages.find { it.id == messageId }
                if (msg != null) {
                    msg.deleted = true
                    val payload = JSObject()
                    payload.put("sessionId", sessionId)
                    payload.put("message",   msg.toJSObject())
                    notifyFn("chatMessage", payload)
                }
            }

            "chat_close" -> {
                sockets.remove(sessionId)
                session.connected = false
                notifySessionUpdated(sessionId)
            }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun sendAck(sessionId: String, messageId: String) {
        val socket = sockets[sessionId] ?: return
        try {
            val ack = JSONObject().apply {
                put("type", "chat_ack")
                put("id",   messageId)
            }
            socket.getOutputStream().write((ack.toString() + "\n").toByteArray(Charsets.UTF_8))
            socket.getOutputStream().flush()
        } catch (_: Exception) {}
    }

    private fun notifySessionUpdated(sessionId: String) {
        val session = sessions[sessionId] ?: return
        val payload = JSObject()
        payload.put("session", session.toJSObject())
        notifyFn("chatSessionUpdated", payload)
    }

    /** Session ID format matches desktop: "chat_{peerId}" */
    fun makeSessionId(peerId: String): String = "chat_$peerId"
}

// ── Data classes ──────────────────────────────────────────────────────────────

data class ChatMessageData(
    val id: String,
    val sessionId: String,
    val senderId: String,
    val senderName: String,
    val isOwn: Boolean,
    val type: String,
    var text: String?,
    val fileName: String? = null,
    val fileSize: Long? = null,
    val filePath: String? = null,
    val timestamp: Long,
    var status: String,
    var editedAt: Long? = null,
    var deleted: Boolean = false
) {
    fun toJSObject(): JSObject {
        val obj = JSObject()
        obj.put("id",         id)
        obj.put("sessionId",  sessionId)
        obj.put("senderId",   senderId)
        obj.put("senderName", senderName)
        obj.put("isOwn",      isOwn)
        obj.put("type",       type)
        obj.put("timestamp",  timestamp)
        obj.put("status",     status)
        text?.let     { obj.put("text",     it) }
        fileName?.let { obj.put("fileName", it) }
        fileSize?.let { obj.put("fileSize", it) }
        filePath?.let { obj.put("filePath", it) }
        editedAt?.let { obj.put("editedAt", it) }
        if (deleted) obj.put("deleted", true)
        return obj
    }
}

data class ChatSessionState(
    val id: String,
    val peerId: String,
    val peerName: String,
    var connected: Boolean,
    val messages: MutableList<ChatMessageData>,
    var lastActivity: Long,
    var unreadCount: Int
) {
    fun toJSObject(): JSObject {
        val obj = JSObject()
        obj.put("id",           id)
        obj.put("peerId",       peerId)
        obj.put("peerName",     peerName)
        obj.put("connected",    connected)
        obj.put("lastActivity", lastActivity)
        obj.put("unreadCount",  unreadCount)
        val msgs = com.getcapacitor.JSArray()
        messages.forEach { msgs.put(it.toJSObject()) }
        obj.put("messages", msgs)
        return obj
    }
}
