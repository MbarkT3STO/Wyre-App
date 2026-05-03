package com.wyre.app

import android.app.Activity
import android.content.Intent
import android.os.Handler
import android.os.Looper
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "WyrePlugin")
class WyrePlugin : Plugin() {

    private val mainHandler = Handler(Looper.getMainLooper())
    private val executor = java.util.concurrent.Executors.newCachedThreadPool()

    /** The manager is owned by WyreService; we just hold a reference */
    private val manager: WyreManager?
        get() = WyrePluginBridge.serviceManager

    override fun load() {
        // Only start the background service if the user has enabled it
        if (WyreService.isEnabled(context)) {
            WyreService.start(context)
        } else if (WyrePluginBridge.serviceManager == null) {
            // App is open but service isn't running — start a local manager
            startLocalManager()
        }
        WyrePluginBridge.registerPlugin(this)
    }

    private fun startLocalManager() {
        val localManager = WyreManager(context) { event, data ->
            mainHandler.post { notifyListeners(event, data) }
        }
        localManager.start()
        WyrePluginBridge.serviceManager = localManager
    }

    override fun handleOnDestroy() {
        WyrePluginBridge.unregisterPlugin()
        // Do NOT stop the service here — it should keep running in the background
    }

    /** Called by WyrePluginBridge from the service thread — posts to main thread */
    fun notifyFromService(event: String, data: JSObject) {
        mainHandler.post {
            notifyListeners(event, data)
        }
    }

    // ── Settings ──────────────────────────────────────────────────────────────

    @PluginMethod
    fun getSettings(call: PluginCall) {
        val m = manager ?: run { call.reject("Service not ready"); return }
        call.resolve(m.getSettings())
    }

    @PluginMethod
    fun setSettings(call: PluginCall) {
        val m = manager ?: run { call.reject("Service not ready"); return }
        m.setSettings(call.data)

        // Handle backgroundService toggle
        if (call.data.has("backgroundService")) {
            val enable = call.data.getBoolean("backgroundService") ?: false
            if (enable) {
                WyreService.start(context)
            } else {
                // Stop the foreground service but keep a local manager running
                // so the app still works while open
                WyreService.stop(context)
                if (WyrePluginBridge.serviceManager == null) {
                    startLocalManager()
                }
            }
        }

        call.resolve()
    }

    // ── Device discovery ──────────────────────────────────────────────────────

    @PluginMethod
    fun getDevices(call: PluginCall) {
        val m = manager ?: run { call.reject("Service not ready"); return }
        val result = JSObject()
        result.put("devices", m.getDevicesJson())
        call.resolve(result)
    }

    @PluginMethod
    fun startDiscovery(call: PluginCall) {
        manager?.startDiscovery()
        call.resolve()
    }

    @PluginMethod
    fun stopDiscovery(call: PluginCall) {
        manager?.stopDiscovery()
        call.resolve()
    }

    // ── File transfer ─────────────────────────────────────────────────────────

    @PluginMethod
    fun sendFile(call: PluginCall) {
        val m = manager ?: run { call.reject("Service not ready"); return }
        val deviceId = call.getString("deviceId") ?: run { call.reject("deviceId required"); return }
        val filePath  = call.getString("filePath")  ?: run { call.reject("filePath required");  return }
        val fileName  = call.getString("fileName")  ?: run { call.reject("fileName required");  return }
        val fileSize  = call.getLong("fileSize")    ?: 0L

        val transferId = m.sendFile(deviceId, filePath, fileName, fileSize)
        if (transferId == null) {
            call.reject("Device not found or offline")
            return
        }
        val result = JSObject()
        result.put("transferId", transferId)
        call.resolve(result)
    }

    @PluginMethod
    fun sendFolder(call: PluginCall) {
        val m = manager ?: run { call.reject("Service not ready"); return }
        val deviceId   = call.getString("deviceId")   ?: run { call.reject("deviceId required");   return }
        val folderUri  = call.getString("folderUri")  ?: run { call.reject("folderUri required");  return }
        val folderName = call.getString("folderName") ?: run { call.reject("folderName required"); return }

        val treeUri = android.net.Uri.parse(folderUri)

        m.sendFolder(deviceId, treeUri, folderName) { transferId ->
            mainHandler.post {
                if (transferId == null) {
                    call.reject("Failed to send folder — device may be offline or folder could not be zipped")
                } else {
                    val result = JSObject()
                    result.put("transferId", transferId)
                    call.resolve(result)
                }
            }
        }
    }

    @PluginMethod
    fun cancelTransfer(call: PluginCall) {
        val transferId = call.getString("transferId") ?: run { call.reject("transferId required"); return }
        manager?.cancelTransfer(transferId)
        call.resolve()
    }

    @PluginMethod
    fun resumeTransfer(call: PluginCall) {
        val m = manager ?: run { call.reject("Service not ready"); return }
        val transferId = call.getString("transferId") ?: run { call.reject("transferId required"); return }
        m.resumeTransfer(transferId)
        call.resolve()
    }

    @PluginMethod
    fun respondToIncoming(call: PluginCall) {
        val m = manager ?: run { call.reject("Service not ready"); return }
        val transferId = call.getString("transferId") ?: run { call.reject("transferId required"); return }
        val accepted   = call.getBoolean("accepted", false) ?: false
        // Use custom save path if provided, otherwise fall back to settings
        val customPath = call.getString("savePath")
        if (customPath != null && customPath.isNotEmpty()) {
            m.respondToIncomingWithPath(transferId, accepted, customPath)
        } else {
            m.respondToIncoming(transferId, accepted)
        }
        call.resolve()
    }

    // ── Clipboard (Feature 2) ─────────────────────────────────────────────────

    @PluginMethod
    fun sendClipboard(call: PluginCall) {
        val m = manager ?: run { call.reject("Service not ready"); return }
        val deviceId = call.getString("deviceId") ?: run { call.reject("deviceId required"); return }
        val text     = call.getString("text")     ?: run { call.reject("text required");     return }

        m.sendClipboard(deviceId, text) { error ->
            mainHandler.post {
                if (error != null) call.reject(error) else call.resolve()
            }
        }
    }

    // ── History ───────────────────────────────────────────────────────────────

    @PluginMethod
    fun getHistory(call: PluginCall) {
        val m = manager ?: run { call.reject("Service not ready"); return }
        val result = JSObject()
        result.put("history", m.getHistoryJson())
        call.resolve(result)
    }

    @PluginMethod
    fun clearHistory(call: PluginCall) {
        manager?.clearHistory()
        call.resolve()
    }

    // ── File picker ───────────────────────────────────────────────────────────

    @PluginMethod
    fun pickFile(call: PluginCall) {
        val m = manager ?: run { call.reject("Service not ready"); return }
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            type = "*/*"
            addCategory(Intent.CATEGORY_OPENABLE)
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        startActivityForResult(call, intent, "onPickFileResult")
    }

    // ── Folder picker (ACTION_OPEN_DOCUMENT_TREE) ─────────────────────────────

    @PluginMethod
    fun pickFolder(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        }
        startActivityForResult(call, intent, "onPickFolderResult")
    }

    @ActivityCallback
    fun onPickFolderResult(call: PluginCall, result: androidx.activity.result.ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK || result.data?.data == null) {
            val empty = JSObject()
            empty.put("path", "")
            call.resolve(empty)
            return
        }

        val treeUri = result.data!!.data!!

        // Persist permission so we can write to this folder later
        val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        context.contentResolver.takePersistableUriPermission(treeUri, flags)

        // Convert the tree URI to a real file system path
        // e.g. content://com.android.externalstorage.documents/tree/primary%3ADownload%2FWyre
        // → /storage/emulated/0/Download/Wyre
        val path = uriToPath(treeUri)

        val res = JSObject()
        res.put("path", path)
        res.put("uri", treeUri.toString())
        call.resolve(res)
    }

    private fun uriToPath(uri: android.net.Uri): String {
        // DocumentsContract tree URI format:
        // content://com.android.externalstorage.documents/tree/primary%3APath%2FTo%2FFolder
        val docId = android.provider.DocumentsContract.getTreeDocumentId(uri)
        // docId is like "primary:Download/Wyre" or "primary:Download"
        return if (docId.startsWith("primary:")) {
            "/storage/emulated/0/${docId.removePrefix("primary:")}"
        } else {
            // External SD or other storage — use the raw path
            "/storage/${docId.replace(":", "/")}"
        }
    }

    @ActivityCallback
    fun onPickFileResult(call: PluginCall, result: androidx.activity.result.ActivityResult) {
        val m = manager ?: run { call.reject("Service not ready"); return }

        if (result.resultCode != Activity.RESULT_OK || result.data == null) {
            val empty = JSObject()
            empty.put("files", JSArray())
            call.resolve(empty)
            return
        }

        val data = result.data!!
        val uris = mutableListOf<android.net.Uri>()
        val clipData = data.clipData
        if (clipData != null) {
            for (i in 0 until clipData.itemCount) uris.add(clipData.getItemAt(i).uri)
        } else {
            data.data?.let { uris.add(it) }
        }

        if (uris.isEmpty()) {
            val empty = JSObject()
            empty.put("files", JSArray())
            call.resolve(empty)
            return
        }

        m.resolveUris(uris) { filesArray ->
            mainHandler.post {
                val res = JSObject()
                res.put("files", filesArray)
                call.resolve(res)
            }
        }
    }

    // ── Chat ──────────────────────────────────────────────────────────────────

    @PluginMethod
    fun chatOpenSession(call: PluginCall) {
        val m = manager ?: run { call.reject("Service not ready"); return }
        val deviceId = call.getString("deviceId") ?: run { call.reject("deviceId required"); return }
        executor.submit {
            try {
                val result = m.chatOpenSession(deviceId)
                mainHandler.post { call.resolve(result) }
            } catch (e: Exception) {
                mainHandler.post { call.reject(e.message ?: "Failed to open chat session") }
            }
        }
    }

    @PluginMethod
    fun chatCloseSession(call: PluginCall) {
        val m = manager ?: run { call.reject("Service not ready"); return }
        val sessionId = call.getString("sessionId") ?: run { call.reject("sessionId required"); return }
        m.chatCloseSession(sessionId)
        call.resolve()
    }

    @PluginMethod
    fun chatSendText(call: PluginCall) {
        val m = manager ?: run { call.reject("Service not ready"); return }
        val sessionId = call.getString("sessionId") ?: run { call.reject("sessionId required"); return }
        val text      = call.getString("text")      ?: run { call.reject("text required");      return }
        executor.submit {
            val result = m.chatSendText(sessionId, text)
            mainHandler.post {
                if (result != null) call.resolve(result) else call.reject("Failed to send message")
            }
        }
    }

    @PluginMethod
    fun chatSendFile(call: PluginCall) {
        val m = manager ?: run { call.reject("Service not ready"); return }
        val sessionId = call.getString("sessionId") ?: run { call.reject("sessionId required"); return }
        val fileName  = call.getString("fileName")  ?: run { call.reject("fileName required");  return }
        val fileSize  = call.getLong("fileSize")    ?: 0L
        val base64    = call.getString("base64")

        if (base64.isNullOrEmpty()) {
            call.reject("base64 data required on Android")
            return
        }

        executor.submit {
            val result = m.chatSendFileBase64(sessionId, fileName, fileSize, base64)
            mainHandler.post {
                if (result != null) call.resolve(result) else call.reject("Failed to send file")
            }
        }
    }

    @PluginMethod
    fun chatEditMessage(call: PluginCall) {
        val m = manager ?: run { call.reject("Service not ready"); return }
        val sessionId = call.getString("sessionId") ?: run { call.reject("sessionId required"); return }
        val messageId = call.getString("messageId") ?: run { call.reject("messageId required"); return }
        val newText   = call.getString("newText")   ?: run { call.reject("newText required");   return }
        executor.submit {
            m.chatEditMessage(sessionId, messageId, newText)
            mainHandler.post { call.resolve() }
        }
    }

    @PluginMethod
    fun chatDeleteMessage(call: PluginCall) {
        val m = manager ?: run { call.reject("Service not ready"); return }
        val sessionId = call.getString("sessionId") ?: run { call.reject("sessionId required"); return }
        val messageId = call.getString("messageId") ?: run { call.reject("messageId required"); return }
        executor.submit {
            m.chatDeleteMessage(sessionId, messageId)
            mainHandler.post { call.resolve() }
        }
    }

    @PluginMethod
    fun chatAcceptInvite(call: PluginCall) {
        val m = manager ?: run { call.reject("Service not ready"); return }
        val sessionId = call.getString("sessionId") ?: run { call.reject("sessionId required"); return }
        executor.submit {
            m.chatAcceptInvite(sessionId)
            mainHandler.post { call.resolve() }
        }
    }

    @PluginMethod
    fun chatDeclineInvite(call: PluginCall) {
        val m = manager ?: run { call.reject("Service not ready"); return }
        val sessionId = call.getString("sessionId") ?: run { call.reject("sessionId required"); return }
        m.chatDeclineInvite(sessionId)
        call.resolve()
    }

    @PluginMethod
    fun chatGetSessions(call: PluginCall) {
        val m = manager ?: run { call.reject("Service not ready"); return }
        val result = com.getcapacitor.JSObject()
        result.put("sessions", m.chatGetSessions())
        call.resolve(result)
    }

    @PluginMethod
    fun chatMarkRead(call: PluginCall) {
        val m = manager ?: run { call.reject("Service not ready"); return }
        val sessionId = call.getString("sessionId") ?: run { call.reject("sessionId required"); return }
        m.chatMarkRead(sessionId)
        call.resolve()
    }

    @PluginMethod
    fun chatSaveFile(call: PluginCall) {
        val fileName = call.getString("fileName") ?: run { call.reject("fileName required"); return }
        val base64   = call.getString("base64")   ?: run { call.reject("base64 required");   return }
        executor.submit {
            try {
                val bytes = android.util.Base64.decode(base64, android.util.Base64.NO_WRAP)
                val downloadsDir = android.os.Environment
                    .getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS)
                downloadsDir.mkdirs()
                val file = java.io.File(downloadsDir, fileName)
                file.writeBytes(bytes)
                mainHandler.post {
                    val result = com.getcapacitor.JSObject()
                    result.put("path", file.absolutePath)
                    call.resolve(result)
                }
            } catch (e: Exception) {
                mainHandler.post { call.reject(e.message ?: "Failed to save file") }
            }
        }
    }

    // ── Shell actions ─────────────────────────────────────────────────────────

    @PluginMethod
    fun openFile(call: PluginCall) {        val m = manager ?: run { call.reject("Service not ready"); return }
        val path = call.getString("path") ?: run { call.reject("path required"); return }
        m.openFile(activity, path)
        call.resolve()
    }

    @PluginMethod
    fun showInFolder(call: PluginCall) {
        val m = manager ?: run { call.reject("Service not ready"); return }
        val path = call.getString("path") ?: run { call.reject("path required"); return }
        m.showInFolder(activity, path)
        call.resolve()
    }
}
