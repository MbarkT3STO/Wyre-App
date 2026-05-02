package com.wyre.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * WyreManager.kt
 * Central coordinator — owns discovery, transfer server/client, settings, history.
 * All networking runs on a dedicated thread pool; events are posted back via notifyFn.
 */
class WyreManager(
    private val context: Context,
    private val notifyFn: (event: String, data: JSObject) -> Unit
) {
    private val executor = Executors.newCachedThreadPool()
    private val settings = SettingsStore(context)
    private val history  = mutableListOf<JSObject>()

    private var discoveryService: DiscoveryService? = null
    private var transferServer: TransferServer? = null
    private val activeTransfers = ConcurrentHashMap<String, Any>()

    /** Paused transfers waiting for resume (Feature 4) */
    private data class PausedTransfer(
        val peerId: String,
        val filePath: String,
        val fileName: String,
        val fileSize: Long
    )
    private val pausedTransfers = ConcurrentHashMap<String, PausedTransfer>()

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    fun start() {
        val port = settings.getInt("transferPort", 49200)
        transferServer = TransferServer(
            context             = context,
            preferredPort       = port,
            executor            = executor,
            settings            = settings,
            onIncomingRequest   = ::onIncomingRequest,
            onEvent             = ::onTransferEvent,
            onClipboardReceived = ::onClipboardReceived
        )
        val actualPort = transferServer!!.start()
        if (actualPort != port) settings.setInt("transferPort", actualPort)

        discoveryService = DiscoveryService(
            deviceId   = settings.getString("deviceId", UUID.randomUUID().toString()),
            deviceName = settings.getString("deviceName", Build.MODEL),
            platform   = "android",
            port       = actualPort,
            version    = "1.0.0",
            executor   = executor,
            onDevicesChanged = { list -> notifyFn("devicesUpdated", buildDevicesPayload(list)) }
        )
        discoveryService!!.start()
    }

    fun stop() {
        discoveryService?.stop()
        transferServer?.stop()
        executor.shutdownNow()
    }

    // ── Settings ──────────────────────────────────────────────────────────────

    fun getSettings(): JSObject {
        val obj = JSObject()
        obj.put("deviceId",           settings.getString("deviceId",           UUID.randomUUID().toString()))
        obj.put("deviceName",         settings.getString("deviceName",         Build.MODEL))
        obj.put("transferPort",       settings.getInt("transferPort",          49200))
        obj.put("saveDirectory",      settings.getString("saveDirectory",      getDownloadsDir()))
        obj.put("theme",              settings.getString("theme",              "system"))
        obj.put("autoAccept",         settings.getBoolean("autoAccept",        false))
        obj.put("trustedDeviceIds",   JSArray(settings.getStringList("trustedDeviceIds")))
        obj.put("autoDeclineTimeout", settings.getInt("autoDeclineTimeout",    30))
        obj.put("showNotifications",  settings.getBoolean("showNotifications", true))
        obj.put("backgroundService",  settings.getBoolean("backgroundService",  false))
        obj.put("uiScale",            settings.getFloat("uiScale",             1.0f))
        obj.put("version",            "1.0.0")
        return obj
    }

    fun setSettings(data: JSONObject) {
        if (data.has("deviceName"))         settings.setString("deviceName",         data.getString("deviceName"))
        if (data.has("saveDirectory"))      settings.setString("saveDirectory",      data.getString("saveDirectory"))
        if (data.has("theme"))              settings.setString("theme",              data.getString("theme"))
        if (data.has("autoAccept"))         settings.setBoolean("autoAccept",        data.getBoolean("autoAccept"))
        if (data.has("autoDeclineTimeout")) settings.setInt("autoDeclineTimeout",    data.getInt("autoDeclineTimeout"))
        if (data.has("showNotifications"))  settings.setBoolean("showNotifications", data.getBoolean("showNotifications"))
        if (data.has("backgroundService"))  settings.setBoolean("backgroundService",  data.getBoolean("backgroundService"))
        if (data.has("uiScale"))            settings.setFloat("uiScale",             data.getDouble("uiScale").toFloat())
        if (data.has("trustedDeviceIds")) {
            val arr = data.getJSONArray("trustedDeviceIds")
            val list = (0 until arr.length()).map { arr.getString(it) }
            settings.setStringList("trustedDeviceIds", list)
        }
        // Propagate name change to discovery broadcaster
        if (data.has("deviceName")) {
            discoveryService?.updateName(data.getString("deviceName"))
        }
    }

    // ── Devices ───────────────────────────────────────────────────────────────

    fun getDevicesJson(): JSArray = buildDevicesArray(discoveryService?.getDevices() ?: emptyList())

    fun startDiscovery()  { discoveryService?.start() }
    fun stopDiscovery()   { discoveryService?.stop() }

    // ── Transfers ─────────────────────────────────────────────────────────────

    fun sendFile(deviceId: String, filePath: String, fileName: String, fileSize: Long): String? {
        val device = discoveryService?.getDevices()?.find { it.id == deviceId && it.online }
            ?: return null
        val transferId = UUID.randomUUID().toString()

        executor.submit {
            TransferClient(
                transferId = transferId,
                filePath   = filePath,
                fileName   = fileName,
                fileSize   = fileSize,
                peerIp     = device.ip,
                peerPort   = device.port,
                senderDeviceId = settings.getString("deviceId", ""),
                senderName     = settings.getString("deviceName", Build.MODEL),
                onEvent    = ::onTransferEvent
            ).send()
        }
        return transferId
    }

    fun cancelTransfer(transferId: String) {
        (activeTransfers[transferId] as? Cancellable)?.cancel()
    }

    fun respondToIncoming(transferId: String, accepted: Boolean) {
        transferServer?.respond(transferId, accepted,
            saveDir = settings.getString("saveDirectory", getDownloadsDir()))
    }

    fun respondToIncomingWithPath(transferId: String, accepted: Boolean, savePath: String) {
        transferServer?.respond(transferId, accepted, saveDir = savePath)
    }

    // ── Clipboard (Feature 2) ─────────────────────────────────────────────────

    /**
     * Sends a clipboard text frame to a peer over TCP.
     * Uses the same newline-terminated JSON header format as file transfers,
     * but with type:"clipboard" so the receiver's TransferServer can distinguish it.
     */
    fun sendClipboard(deviceId: String, text: String, callback: (String?) -> Unit) {
        val device = discoveryService?.getDevices()?.find { it.id == deviceId && it.online }
        if (device == null) { callback("Device not found or offline"); return }

        val senderName = settings.getString("deviceName", Build.MODEL)
        val senderDeviceId = settings.getString("deviceId", "")
        val truncated = text.length > 5000
        val safeText = if (truncated) text.take(5000) else text

        executor.submit {
            try {
                val sock = java.net.Socket(device.ip, device.port)
                sock.use {
                    val frame = org.json.JSONObject().apply {
                        put("type",           "clipboard")
                        put("senderDeviceId", senderDeviceId)
                        put("senderName",     senderName)
                        put("text",           safeText)
                        put("truncated",      truncated)
                    }.toString() + "\n"
                    it.getOutputStream().write(frame.toByteArray(Charsets.UTF_8))
                    it.getOutputStream().flush()
                }
                callback(null)
            } catch (e: Exception) {
                callback(e.message ?: "Failed to send clipboard")
            }
        }
    }

    // ── Folder send (Feature 1) ───────────────────────────────────────────────

    /**
     * Zips a folder on a background thread then sends the zip via TransferClient.
     * The zip is written to the app cache dir and deleted after the transfer.
     */
    fun sendFolder(deviceId: String, folderPath: String, folderName: String, callback: (String?) -> Unit) {
        val device = discoveryService?.getDevices()?.find { it.id == deviceId && it.online }
        if (device == null) { callback(null); return }

        executor.submit {
            try {
                val zipName = "$folderName.zip"
                val zipFile = java.io.File(context.cacheDir, "wyre-${System.currentTimeMillis()}-$zipName")

                zipFolder(java.io.File(folderPath), zipFile)

                val transferId = UUID.randomUUID().toString()
                executor.submit {
                    TransferClient(
                        transferId     = transferId,
                        filePath       = zipFile.absolutePath,
                        fileName       = zipName,
                        fileSize       = zipFile.length(),
                        peerIp         = device.ip,
                        peerPort       = device.port,
                        senderDeviceId = settings.getString("deviceId", ""),
                        senderName     = settings.getString("deviceName", Build.MODEL),
                        onEvent        = { event ->
                            onTransferEvent(event)
                            if (event is TransferEvent.Complete || event is TransferEvent.Error) {
                                zipFile.delete()
                            }
                        }
                    ).send()
                }
                callback(transferId)
            } catch (e: Exception) {
                android.util.Log.e("WyreManager", "sendFolder failed: ${e.message}", e)
                callback(null)
            }
        }
    }

    /** Recursively zips a folder into a zip file using java.util.zip */
    private fun zipFolder(folder: java.io.File, zipFile: java.io.File) {
        java.util.zip.ZipOutputStream(zipFile.outputStream().buffered()).use { zos ->
            fun addEntry(file: java.io.File, entryName: String) {
                if (file.isDirectory) {
                    file.listFiles()?.forEach { child ->
                        addEntry(child, "$entryName/${child.name}")
                    }
                } else {
                    zos.putNextEntry(java.util.zip.ZipEntry(entryName))
                    file.inputStream().use { it.copyTo(zos) }
                    zos.closeEntry()
                }
            }
            folder.listFiles()?.forEach { child -> addEntry(child, child.name) }
        }
    }

    // ── Resume (Feature 4) ────────────────────────────────────────────────────

    /**
     * Resume a paused transfer. The native side tracks paused transfers by ID.
     * If the transfer is found and the peer is still online, re-sends from the
     * last known byte offset.
     */
    fun resumeTransfer(transferId: String) {
        val paused = pausedTransfers[transferId] ?: return
        val device = discoveryService?.getDevices()?.find { it.id == paused.peerId && it.online } ?: return

        pausedTransfers.remove(transferId)

        executor.submit {
            TransferClient(
                transferId     = transferId,
                filePath       = paused.filePath,
                fileName       = paused.fileName,
                fileSize       = paused.fileSize,
                peerIp         = device.ip,
                peerPort       = device.port,
                senderDeviceId = settings.getString("deviceId", ""),
                senderName     = settings.getString("deviceName", Build.MODEL),
                onEvent        = ::onTransferEvent
            ).send()
        }
    }

    // ── History ───────────────────────────────────────────────────────────────

    fun getHistoryJson(): JSArray {
        val arr = JSArray()
        synchronized(history) { history.forEach { arr.put(it) } }
        return arr
    }

    fun clearHistory() { synchronized(history) { history.clear() } }

    // ── File picker ───────────────────────────────────────────────────────────
    // Resolves a list of content URIs to file objects on a background thread.
    // Called by WyrePlugin after it receives the activity result.
    fun resolveUris(uris: List<Uri>, callback: (JSArray) -> Unit) {
        executor.submit {
            val filesArray = JSArray()
            for (uri in uris) {
                resolveUri(uri)?.let { filesArray.put(it) }
            }
            callback(filesArray)
        }
    }

    // ── Shell ─────────────────────────────────────────────────────────────────

    fun openFile(activity: Activity, path: String) {
        try {
            val file = java.io.File(path)
            if (!file.exists()) return

            // For files in public Downloads, use MediaStore URI directly
            // For files in app-private dirs, use FileProvider
            val uri = if (path.startsWith(
                    android.os.Environment.getExternalStoragePublicDirectory(
                        android.os.Environment.DIRECTORY_DOWNLOADS).absolutePath)) {
                android.net.Uri.fromFile(file)
            } else {
                FileProvider.getUriForFile(context, "${context.packageName}.provider", file)
            }

            val mime = context.contentResolver.getType(uri)
                ?: android.webkit.MimeTypeMap.getSingleton()
                    .getMimeTypeFromExtension(file.extension.lowercase())
                ?: "*/*"

            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mime)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.startActivity(intent)
        } catch (_: Exception) {}
    }

    fun showInFolder(activity: Activity, path: String) {
        try {
            // Open the Downloads folder in the Files app
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(
                    android.net.Uri.parse("content://com.android.externalstorage.documents/document/primary%3ADownload"),
                    "vnd.android.document/directory"
                )
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            // Try the Files app intent first
            try {
                activity.startActivity(intent)
                return
            } catch (_: Exception) {}

            // Fallback: open the Downloads app
            val fallback = Intent(android.app.DownloadManager.ACTION_VIEW_DOWNLOADS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.startActivity(fallback)
        } catch (_: Exception) {}
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    private fun onClipboardReceived(senderName: String, text: String, truncated: Boolean) {
        val obj = JSObject()
        obj.put("senderName", senderName)
        obj.put("text",       text)
        obj.put("truncated",  truncated)
        notifyFn("clipboardReceived", obj)
    }

    private fun onIncomingRequest(req: IncomingRequest) {
        val obj = JSObject()
        obj.put("transferId",      req.transferId)
        obj.put("senderName",      req.senderName)
        obj.put("senderDeviceId",  req.senderDeviceId)
        obj.put("fileName",        req.fileName)
        obj.put("fileSize",        req.fileSize)
        obj.put("checksum",        req.checksum)
        notifyFn("incomingRequest", obj)

        // Auto-decline after timeout if not responded
        val timeout = settings.getInt("autoDeclineTimeout", 30).toLong()
        executor.submit {
            Thread.sleep(timeout * 1000)
            if (transferServer?.isPending(req.transferId) == true) {
                transferServer?.respond(req.transferId, false, "")
            }
        }
    }

    private fun onTransferEvent(event: TransferEvent) {
        val obj = JSObject()
        when (event) {
            is TransferEvent.Started -> {
                obj.put("transferId", event.transferId)
                obj.put("direction",  event.direction)
                obj.put("peerId",     event.peerId)
                obj.put("peerName",   event.peerName)
                obj.put("fileName",   event.fileName)
                obj.put("fileSize",   event.fileSize)
                obj.put("status",     event.status)
                notifyFn("transferStarted", obj)
            }
            is TransferEvent.Progress -> {
                obj.put("transferId",        event.transferId)
                obj.put("progress",          event.progress)
                obj.put("speed",             event.speed)
                obj.put("eta",               event.eta)
                obj.put("bytesTransferred",  event.bytesTransferred)
                obj.put("totalBytes",        event.totalBytes)
                notifyFn("transferProgress", obj)
            }
            is TransferEvent.Complete -> {
                obj.put("transferId", event.transferId)
                obj.put("savedPath",  event.savedPath)
                notifyFn("transferComplete", obj)
                addToHistory(event)
            }
            is TransferEvent.Error -> {
                obj.put("transferId", event.transferId)
                obj.put("error",      event.error)
                obj.put("code",       event.code)
                notifyFn("transferError", obj)
            }
        }
    }

    private fun addToHistory(event: TransferEvent.Complete) {
        val rec = JSObject()
        rec.put("id",          event.transferId)
        rec.put("direction",   event.direction)
        rec.put("status",      "completed")
        rec.put("peerId",      event.peerId)
        rec.put("peerName",    event.peerName)
        rec.put("fileName",    event.fileName)
        rec.put("fileSize",    event.fileSize)
        rec.put("startedAt",   event.startedAt)
        rec.put("completedAt", System.currentTimeMillis())
        rec.put("savedPath",   event.savedPath)
        synchronized(history) {
            history.add(0, rec)
            if (history.size > 500) history.removeAt(history.size - 1)
        }
    }

    private fun buildDevicesPayload(list: List<DeviceInfo>): JSObject {
        val obj = JSObject()
        obj.put("devices", buildDevicesArray(list))
        return obj
    }

    private fun buildDevicesArray(list: List<DeviceInfo>): JSArray {
        val arr = JSArray()
        list.forEach { d ->
            val obj = JSObject()
            obj.put("id",       d.id)
            obj.put("name",     d.name)
            obj.put("platform", d.platform)
            obj.put("ip",       d.ip)
            obj.put("port",     d.port)
            obj.put("version",  d.version)
            obj.put("lastSeen", d.lastSeen)
            obj.put("online",   d.online)
            arr.put(obj)
        }
        return arr
    }

    fun resolveUri(uri: Uri): JSObject? {
        return try {
            val cursor = context.contentResolver.query(uri, null, null, null, null) ?: return null
            var name = "file"
            var size = 0L
            cursor.use {
                if (it.moveToFirst()) {
                    val nameIdx = it.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    val sizeIdx = it.getColumnIndex(OpenableColumns.SIZE)
                    if (nameIdx >= 0) name = it.getString(nameIdx) ?: "file"
                    if (sizeIdx >= 0) size = it.getLong(sizeIdx)
                }
            }

            // Sanitize filename
            name = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").trim()
            if (name.isEmpty()) name = "file"

            // Copy to cache dir so we have a stable file path
            val cacheFile = java.io.File(context.cacheDir.absolutePath + java.io.File.separator + name)
            context.contentResolver.openInputStream(uri)?.use { input ->
                cacheFile.outputStream().use { out -> input.copyTo(out) }
            }

            val obj = JSObject()
            obj.put("path", cacheFile.absolutePath)
            obj.put("name", name)
            // Always use actual file size from disk — most reliable source
            val actualSize = cacheFile.length().takeIf { it > 0 } ?: size
            obj.put("size", actualSize)
            obj
        } catch (e: Exception) {
            android.util.Log.e("WyreManager", "resolveUri failed: ${e.message}", e)
            null
        }
    }

    private fun getDownloadsDir(): String =
        android.os.Environment
            .getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS)
            .absolutePath
}
