package com.wyre.app

import com.getcapacitor.JSObject
import java.util.concurrent.atomic.AtomicBoolean

/**
 * WyrePluginBridge.kt
 * Singleton that connects WyreService (background) with WyrePlugin (foreground).
 *
 * When the app is open, WyrePlugin registers itself here so events from the
 * service are forwarded to the WebView. When the app is closed, events are
 * handled by the service directly (e.g. showing system notifications).
 */
object WyrePluginBridge {

    /** The WyreManager owned by the service — shared with the plugin */
    @Volatile var serviceManager: WyreManager? = null

    /** The active plugin instance (null when app is in background) */
    @Volatile private var activePlugin: WyrePlugin? = null

    private val appInForeground = AtomicBoolean(false)

    fun registerPlugin(plugin: WyrePlugin) {
        activePlugin = plugin
        appInForeground.set(true)
    }

    fun unregisterPlugin() {
        activePlugin = null
        appInForeground.set(false)
    }

    fun isAppInForeground(): Boolean = appInForeground.get()

    /** Called by WyreService — forwards to plugin if app is open */
    fun notifyIfActive(event: String, data: JSObject) {
        activePlugin?.notifyFromService(event, data)
    }
}
