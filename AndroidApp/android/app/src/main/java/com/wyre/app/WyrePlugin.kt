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

    /** The manager is owned by WyreService; we just hold a reference */
    private val manager: WyreManager?
        get() = WyrePluginBridge.serviceManager

    override fun load() {
        // Start the background service (idempotent — safe to call multiple times)
        WyreService.start(context)
        // Register this plugin instance so the service can forward events to JS
        WyrePluginBridge.registerPlugin(this)
        // If service manager isn't ready yet, retry after a short delay
        if (WyrePluginBridge.serviceManager == null) {
            mainHandler.postDelayed({
                WyrePluginBridge.registerPlugin(this)
            }, 500)
        }
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
    fun cancelTransfer(call: PluginCall) {
        val transferId = call.getString("transferId") ?: run { call.reject("transferId required"); return }
        manager?.cancelTransfer(transferId)
        call.resolve()
    }

    @PluginMethod
    fun respondToIncoming(call: PluginCall) {
        val m = manager ?: run { call.reject("Service not ready"); return }
        val transferId = call.getString("transferId") ?: run { call.reject("transferId required"); return }
        val accepted   = call.getBoolean("accepted", false) ?: false
        m.respondToIncoming(transferId, accepted)
        call.resolve()
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
            val res = JSObject()
            res.put("files", filesArray)
            call.resolve(res)
        }
    }

    // ── Shell actions ─────────────────────────────────────────────────────────

    @PluginMethod
    fun openFile(call: PluginCall) {
        val m = manager ?: run { call.reject("Service not ready"); return }
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
