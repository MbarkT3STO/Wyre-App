package com.wyre.app

import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.ServerSocket
import java.net.Socket
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService

private const val TAG = "ChatManager"
private const val CHAT_PORT_OFFSET = 1   // chat listens on transferPort + 1
private const val HEADER_MAX = 65536

/**
 * ChatManager.kt
 * Implements peer-to-peer chat over a dedicated TCP connection per session.
 *
 * Wire protocol: newline-delimited JSON frames (same as file transfer / clipboard).
 * Frame types: chat_handshake, chat, chat_ack, chat_edit, chat_delete, chat_close
 *
 * Each session is a persistent TCP connection:
 *   - Initiator connects to peer's chat port and sends chat_handshake
 *   - Acceptor receives handshake, fires chatInvite event to JS, then sends chat_handshake back
 *   - Both sides can then send chat frames freely
 */
class ChatManager(
    private val executor: ExecutorService,
    private val localDeviceId: String,
    private val localDeviceName: String,
    private val chatPort: Int,
    private val notifyFn: (event: String, data: JSObject) -> Unit
) {
    // sessionId → active session
    private val sessions = ConcurrentHashMap<String, ChatSession>()

    // sessionId → open socket (for sending)
    private val sockets = ConcurrentHashMap<String, Socket>()

    // Pending invites waiting for JS accept/decline
    private val pendingInvites = ConcurrentHashMap<String, Socket>()

    private var serverSocket: ServerSocket? = null
    @Volatile private var running = false

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    fun start() {
        running = true
        val ss = try {
            ServerSocket(chatPort)
        } catch (e: Exception) {
            Log.e(TAG, "Could not bind chat server on port $chatPort: ${e.message}")
            return
        }
        serverSocket = ss
        executor.submit {
            while (running) {
                try {
                    val client = ss.accept()
                    executor.submit { handleIncomingConnection(client) }
                } catch (_: Exception) {
                    if (!running) break
                }
            }
        }
        Log.d(TAG, "Chat server listening on port $chatPort")
    }

    fun stop() {
        running = false
        sockets.values.forEach { runCatching { it.close() } }
        sockets.clear()
        pendingInvites.values.forEach { runCatching { it.close() } }
        pendingInvites.clear()
        sessions.clear()
        serverSocket?.close()
    }

    // ── Open session (initiator side) ─────────────────────────────────────────

    /**
     * Opens a chat session with a peer. Connects to peerIp:peerChatPort,
     * sends a handshake, and waits for the peer's handshake reply.
     * Returns a JSObject with sessionId, peerId, peerName, connected.
     */
    fun openSession(peerId: String, peerName: String, peerIp: String, peerChatPort: Int): JSObject {
        // Reuse existing connected session if one exists
        val existing = sessions.values.find { it.peerId == peerId && it.connected }
        if (existing != null) {
            return existing.toJSObject()
        }

        val sessionId = buildSessionId(localDeviceId, peerId)
        val socket = Socket(peerIp, peerChatPort)
        socket.soTimeout = 10_000

        val out = socket.getOutputStream()

        // Send handshake
        val handshake = JSONObject().apply {
            put("type",           "chat_handshake")
            put("senderDeviceId", localDeviceId)
            put("senderName",     localDeviceName)
            put("sessionId",      sessionId)
        }
        out.write((handshake.toString() + "\n").toByteArray(Charsets.UTF_8))
        out.flush()

        // Wait for peer's handshake reply (with timeout)
        val reader = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.UTF_8))
        val replyLine = reader.readLine() ?: throw Exception("Peer closed connection during handshake")
        val reply = JSONObject(replyLine)

        if (reply.optString("type") != "chat_handshake") {
            socket.close()
            throw Exception("Unexpected handshake reply: ${reply.optString("type")}")
        }

        val resolvedPeerName = reply.optString("senderName", peerName)

        socket.soTimeout = 0  // no timeout for the live session

        val session = ChatSession(
            id          = sessionId,
            peerId      = peerId,
            peerName    = resolvedPeerName,
            connected   = true,
            messages    = mutableListOf(),
            lastActivity = System.currentTimeMillis(),
            unreadCount = 0
        )
        sessions[sessionId] = session
        sockets[sessionId]  = socket

        // Start reader loop
        executor.submit { readLoop(sessionId, socket, reader) }

        return session.toJSObject()
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
        socket.close()
        sessions[sessionId]?.connected = false
        notifySessionUpdated(sessionId)
    }

    // ── Send text ─────────────────────────────────────────────────────────────

    fun sendText(sessionId: String, text: String): JSObject? {
        val socket = sockets[sessionId] ?: return null
        val session = sessions[sessionId] ?: return null

        val messageId = UUID.randomUUID().toString()
        val timestamp = System.currentTimeMillis()

        val frame = JSONObject().apply {
            put("type",           "chat")
            put("id",             messageId)
            put("senderDeviceId", localDeviceId)
            put("senderName",     localDeviceName)
            put("msgType",        "text")
            put("text",           text)
            put("timestamp",      timestamp)
        }

        return try {
            socket.getOutputStream().write((frame.toString() + "\n").toByteArray(Charsets.UTF_8))
            socket.getOutputStream().flush()

            val msg = buildMessage(
                id        = messageId,
                sessionId = sessionId,
                senderId  = localDeviceId,
                senderName = localDeviceName,
                isOwn     = true,
                type      = "text",
                text      = text,
                timestamp = timestamp,
                status    = "sent"
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

    // ── Accept / decline invite ───────────────────────────────────────────────

    fun acceptInvite(sessionId: String) {
        val socket = pendingInvites.remove(sessionId) ?: return

        val session = sessions[sessionId] ?: return
        sockets[sessionId] = socket

        // Send our handshake back
        try {
            val handshake = JSONObject().apply {
                put("type",           "chat_handshake")
                put("senderDeviceId", localDeviceId)
                put("senderName",     localDeviceName)
                put("sessionId",      sessionId)
            }
            socket.getOutputStream().write((handshake.toString() + "\n").toByteArray(Charsets.UTF_8))
            socket.getOutputStream().flush()
        } catch (e: Exception) {
            Log.e(TAG, "acceptInvite handshake failed: ${e.message}")
            socket.close()
            return
        }

        session.connected = true
        notifySessionUpdated(sessionId)

        val reader = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.UTF_8))
        executor.submit { readLoop(sessionId, socket, reader) }
    }

    fun declineInvite(sessionId: String) {
        val socket = pendingInvites.remove(sessionId) ?: return
        sessions.remove(sessionId)
        runCatching { socket.close() }
    }

    // ── Get sessions ──────────────────────────────────────────────────────────

    fun getSessionsJson(): JSArray {
        val arr = JSArray()
        sessions.values.forEach { arr.put(it.toJSObject()) }
        return arr
    }

    fun markRead(sessionId: String) {
        sessions[sessionId]?.unreadCount = 0
        notifySessionUpdated(sessionId)
    }

    // ── Incoming connection handler (acceptor side) ───────────────────────────

    private fun handleIncomingConnection(socket: Socket) {
        try {
            val reader = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.UTF_8))
            val line = reader.readLine() ?: run { socket.close(); return }
            val json = JSONObject(line)

            when (json.optString("type")) {
                "chat_handshake" -> {
                    val peerId    = json.getString("senderDeviceId")
                    val peerName  = json.getString("senderName")
                    val sessionId = json.optString("sessionId").ifEmpty { buildSessionId(peerId, localDeviceId) }

                    val session = ChatSession(
                        id           = sessionId,
                        peerId       = peerId,
                        peerName     = peerName,
                        connected    = false,  // not yet — waiting for JS accept
                        messages     = mutableListOf(),
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
                else -> {
                    Log.w(TAG, "Unexpected first frame type: ${json.optString("type")}")
                    socket.close()
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "handleIncomingConnection error: ${e.message}")
            socket.close()
        }
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
                val messageId  = json.getString("id")
                val senderId   = json.getString("senderDeviceId")
                val senderName = json.optString("senderName", session.peerName)
                val msgType    = json.optString("msgType", "text")
                val text       = json.optString("text")
                val fileName   = json.optString("fileName")
                val fileSize   = json.optLong("fileSize", 0L)
                val timestamp  = json.optLong("timestamp", System.currentTimeMillis())

                val msg = buildMessage(
                    id         = messageId,
                    sessionId  = sessionId,
                    senderId   = senderId,
                    senderName = senderName,
                    isOwn      = senderId == localDeviceId,
                    type       = msgType,
                    text       = text.ifEmpty { null },
                    fileName   = fileName.ifEmpty { null },
                    fileSize   = if (fileSize > 0) fileSize else null,
                    timestamp  = timestamp,
                    status     = "delivered"
                )
                session.messages.add(msg)
                session.lastActivity = timestamp
                session.unreadCount++

                // Send ack
                sendAck(sessionId, messageId)

                val payload = JSObject()
                payload.put("sessionId", sessionId)
                payload.put("message",   msg.toJSObject())
                notifyFn("chatMessage", payload)
                notifySessionUpdated(sessionId)
            }

            "chat_ack" -> {
                val messageId = json.getString("id")
                val msg = session.messages.find { it.id == messageId }
                if (msg != null) {
                    msg.status = "delivered"
                    val payload = JSObject()
                    payload.put("sessionId", sessionId)
                    payload.put("messageId", messageId)
                    payload.put("status",    "delivered")
                    notifyFn("chatMessageStatus", payload)
                }
            }

            "chat_edit" -> {
                val messageId = json.getString("id")
                val newText   = json.getString("newText")
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
                val messageId = json.getString("id")
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

    /** Deterministic session ID from two device IDs (sorted so both sides agree) */
    private fun buildSessionId(a: String, b: String): String {
        val sorted = listOf(a, b).sorted()
        return "${sorted[0]}_${sorted[1]}"
    }

    private fun buildMessage(
        id: String, sessionId: String, senderId: String, senderName: String,
        isOwn: Boolean, type: String, text: String? = null, fileName: String? = null,
        fileSize: Long? = null, filePath: String? = null, timestamp: Long,
        status: String
    ) = ChatMessageData(
        id = id, sessionId = sessionId, senderId = senderId, senderName = senderName,
        isOwn = isOwn, type = type, text = text, fileName = fileName,
        fileSize = fileSize, filePath = filePath, timestamp = timestamp,
        status = status
    )
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
    val fileName: String?,
    val fileSize: Long?,
    val filePath: String?,
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

data class ChatSession(
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
        val msgs = JSArray()
        messages.forEach { msgs.put(it.toJSObject()) }
        obj.put("messages", msgs)
        return obj
    }
}
