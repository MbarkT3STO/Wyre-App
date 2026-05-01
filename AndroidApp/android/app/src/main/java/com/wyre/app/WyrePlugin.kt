package com.wyre.app

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
/**
 * WyrePlugin.kt
 *
 * Capacitor plugin that bridges the WebView (TypeScript) to native Android
 * networking and file I/O. Delegates all heavy work to WyreManager.
 *
 * Exposed methods (called from JS via Capacitor):
 *  - getSettings / setSettings
 *  - getDevices / startDiscovery / stopDiscovery
 *  - sendFile / cancelTransfer / respondToIncoming
 *  - getHistory / clearHistory
 *  - pickFile
 *  - openFile / showInFolder
 *
 * Events pushed to JS:
 *  - devicesUpdated
 *  - transferStarted / transferProgress / transferComplete / transferError
 *  - incomingRequest
 *  - transferQueueUpdated
 */
@CapacitorPlugin(name = "WyrePlugin")
class WyrePlugin : Plugin() {

    private lateinit var manager: WyreManager

    override fun load() {
        manager = WyreManager(context) { event, data ->
            notifyListeners(event, data)
        }
        manager.start()
    }

    override fun handleOnDestroy() {
        manager.stop()
    }

    override fun handleOnActivityResult(requestCode: Int, resultCode: Int, data: android.content.Intent?) {
        if (requestCode == REQUEST_CODE_PICK_FILE) {
            manager.handlePickFileResult(resultCode, data)
        }
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

    @PluginMethod
    fun pickFile(call: PluginCall) {
        manager.pickFile(activity) { result ->
            if (result == null) {
                // User cancelled — resolve with empty files array
                val empty = JSObject()
                empty.put("files", JSArray())
                call.resolve(empty)
            } else {
                call.resolve(result)
            }
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
        manager.openFile(activity, path) // On Android, "show in folder" = open the file
        call.resolve()
    }
}
