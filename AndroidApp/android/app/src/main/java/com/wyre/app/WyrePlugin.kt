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

    private lateinit var manager: WyreManager
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun load() {
        manager = WyreManager(context) { event, data ->
            // notifyListeners MUST run on the main thread —
            // TransferClient fires events from a background executor thread
            mainHandler.post {
                notifyListeners(event, data)
            }
        }
        manager.start()
    }

    override fun handleOnDestroy() {
        manager.stop()
    }

    // ── Settings ──────────────────────────────────────────────────────────────

    @PluginMethod
    fun getSettings(call: PluginCall) {
        call.resolve(manager.getSettings())
    }

    @PluginMethod
    fun setSettings(call: PluginCall) {
        manager.setSettings(call.data)
        call.resolve()
    }

    // ── Device discovery ──────────────────────────────────────────────────────

    @PluginMethod
    fun getDevices(call: PluginCall) {
        val result = JSObject()
        result.put("devices", manager.getDevicesJson())
        call.resolve(result)
    }

    @PluginMethod
    fun startDiscovery(call: PluginCall) {
        manager.startDiscovery()
        call.resolve()
    }

    @PluginMethod
    fun stopDiscovery(call: PluginCall) {
        manager.stopDiscovery()
        call.resolve()
    }

    // ── File transfer ─────────────────────────────────────────────────────────

    @PluginMethod
    fun sendFile(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: run { call.reject("deviceId required"); return }
        val filePath  = call.getString("filePath")  ?: run { call.reject("filePath required");  return }
        val fileName  = call.getString("fileName")  ?: run { call.reject("fileName required");  return }
        val fileSize  = call.getLong("fileSize")    ?: 0L

        val transferId = manager.sendFile(deviceId, filePath, fileName, fileSize)
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
        manager.cancelTransfer(transferId)
        call.resolve()
    }

    @PluginMethod
    fun respondToIncoming(call: PluginCall) {
        val transferId = call.getString("transferId") ?: run { call.reject("transferId required"); return }
        val accepted   = call.getBoolean("accepted", false) ?: false
        manager.respondToIncoming(transferId, accepted)
        call.resolve()
    }

    // ── History ───────────────────────────────────────────────────────────────

    @PluginMethod
    fun getHistory(call: PluginCall) {
        val result = JSObject()
        result.put("history", manager.getHistoryJson())
        call.resolve(result)
    }

    @PluginMethod
    fun clearHistory(call: PluginCall) {
        manager.clearHistory()
        call.resolve()
    }

    // ── File picker ───────────────────────────────────────────────────────────
    // Uses Capacitor's bridge startActivityForResult so the result is routed
    // back through @ActivityCallback — the correct Capacitor 6 pattern.

    @PluginMethod
    fun pickFile(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            type = "*/*"
            addCategory(Intent.CATEGORY_OPENABLE)
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        startActivityForResult(call, intent, "onPickFileResult")
    }

    @ActivityCallback
    private fun onPickFileResult(call: PluginCall, result: androidx.activity.result.ActivityResult) {
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

        manager.resolveUris(uris) { filesArray ->
            val res = JSObject()
            res.put("files", filesArray)
            call.resolve(res)
        }
    }

    // ── Shell actions ─────────────────────────────────────────────────────────

    @PluginMethod
    fun openFile(call: PluginCall) {
        val path = call.getString("path") ?: run { call.reject("path required"); return }
        manager.openFile(activity, path)
        call.resolve()
    }

    @PluginMethod
    fun showInFolder(call: PluginCall) {
        val path = call.getString("path") ?: run { call.reject("path required"); return }
        manager.showInFolder(activity, path)
        call.resolve()
    }
}
