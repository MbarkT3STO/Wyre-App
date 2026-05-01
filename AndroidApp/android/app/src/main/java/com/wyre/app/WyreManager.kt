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
import java.net.InetAddress
import java.net.NetworkInterface
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

const val REQUEST_CODE_PICK_FILE = 9001

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
    private val devices  = ConcurrentHashMap<String, DeviceInfo>()
    private val history  = mutableListOf<JSObject>()

    private var discoveryService: DiscoveryService? = null
    private var transferServer: TransferServer? = null
    private val activeTransfers = ConcurrentHashMap<String, Any>()

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    fun start() {
        val port = settings.getInt("transferPort", 49200)
        transferServer = TransferServer(context, port, executor, settings, ::onIncomingRequest, ::onTransferEvent)
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
        obj.put("uiScale",            settings.getFloat("uiScale",             1.0f))
        obj.put("version",            "1.0.0")
        return obj
    }

    fun setSettings(data: JSONObject) {
        if (data.has("deviceName"))         settings.setString("deviceName",         data.getString("deviceName"))
        if (data.has("theme"))              settings.setString("theme",              data.getString("theme"))
        if (data.has("autoAccept"))         settings.setBoolean("autoAccept",        data.getBoolean("autoAccept"))
        if (data.has("autoDeclineTimeout")) settings.setInt("autoDeclineTimeout",    data.getInt("autoDeclineTimeout"))
        if (data.has("showNotifications"))  settings.setBoolean("showNotifications", data.getBoolean("showNotifications"))
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

    fun getDevicesJson(): JSArray = buildDevicesArray(devices.values.filter { it.online })

    fun startDiscovery()  { discoveryService?.start() }
    fun stopDiscovery()   { discoveryService?.stop() }

    // ── Transfers ─────────────────────────────────────────────────────────────

    fun sendFile(deviceId: String, filePath: String, fileName: String, fileSize: Long): String? {
        val device = devices.values.find { it.id == deviceId && it.online } ?: return null
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

    // ── History ───────────────────────────────────────────────────────────────

    fun getHistoryJson(): JSArray {
        val arr = JSArray()
        synchronized(history) { history.forEach { arr.put(it) } }
        return arr
    }

    fun clearHistory() { synchronized(history) { history.clear() } }

    // ── File picker ───────────────────────────────────────────────────────────
    // Callback-based — WyrePlugin owns the PluginCall, not WyreManager
    private var pickFileCallback: ((JSArray) -> Unit)? = null

    fun launchFilePicker(activity: Activity, callback: (JSArray) -> Unit) {
        pickFileCallback = callback
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            type = "*/*"
            addCategory(Intent.CATEGORY_OPENABLE)
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        activity.startActivityForResult(intent, REQUEST_CODE_PICK_FILE)
    }

    /** Called from WyrePlugin.handleOnActivityResult */
    fun handlePickFileResult(resultCode: Int, data: android.content.Intent?) {
        val callback = pickFileCallback ?: return
        pickFileCallback = null

        if (resultCode != Activity.RESULT_OK || data == null) {
            callback(JSArray())
            return
        }

        // Collect all selected URIs
        val uris = mutableListOf<Uri>()
        val clipData = data.clipData
        if (clipData != null) {
            for (i in 0 until clipData.itemCount) uris.add(clipData.getItemAt(i).uri)
        } else {
            data.data?.let { uris.add(it) }
        }

        if (uris.isEmpty()) { callback(JSArray()); return }

        // Copy files on background thread — can be slow for large files
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
            val file = File(path)
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.provider", file)
            val mime = context.contentResolver.getType(uri) ?: "*/*"
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mime)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.startActivity(intent)
        } catch (e: Exception) {
            // Silently ignore if no app can handle the file type
        }
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

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
                obj.put("transferId",       event.transferId)
                obj.put("progress",         event.progress)
                obj.put("speed",            event.speed)
                obj.put("eta",              event.eta)
                obj.put("bytesTransferred", event.bytesTransferred)
                obj.put("totalBytes",       event.totalBytes)
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

    private fun resolveUri(uri: Uri): JSObject? {
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
            obj.put("size", if (size > 0) size else cacheFile.length())
            obj
        } catch (e: Exception) {
            android.util.Log.e("WyreManager", "resolveUri failed: ${e.message}", e)
            null
        }
    }

    private fun getDownloadsDir(): String =
        context.getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS)?.absolutePath
            ?: context.filesDir.absolutePath
}
