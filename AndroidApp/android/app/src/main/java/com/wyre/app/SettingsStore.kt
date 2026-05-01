package com.wyre.app

import android.content.Context
import android.content.SharedPreferences

/**
 * SettingsStore.kt — thin wrapper around SharedPreferences.
 * Replaces electron-store from the desktop app.
 */
class SettingsStore(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("wyre_settings", Context.MODE_PRIVATE)

    fun getString(key: String, default: String): String = prefs.getString(key, default) ?: default
    fun getInt(key: String, default: Int): Int = prefs.getInt(key, default)
    fun getLong(key: String, default: Long): Long = prefs.getLong(key, default)
    fun getFloat(key: String, default: Float): Float = prefs.getFloat(key, default)
    fun getBoolean(key: String, default: Boolean): Boolean = prefs.getBoolean(key, default)

    fun getStringList(key: String): List<String> {
        val raw = prefs.getString(key, "") ?: ""
        return if (raw.isEmpty()) emptyList() else raw.split(",")
    }

    fun setString(key: String, value: String) = prefs.edit().putString(key, value).apply()
    fun setInt(key: String, value: Int) = prefs.edit().putInt(key, value).apply()
    fun setLong(key: String, value: Long) = prefs.edit().putLong(key, value).apply()
    fun setFloat(key: String, value: Float) = prefs.edit().putFloat(key, value).apply()
    fun setBoolean(key: String, value: Boolean) = prefs.edit().putBoolean(key, value).apply()
    fun setStringList(key: String, value: List<String>) = setString(key, value.joinToString(","))
}
