package com.wyre.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.getcapacitor.JSObject

/**
 * WyreService.kt
 * Foreground service that keeps the transfer server and discovery alive
 * when the app is in the background or closed.
 *
 * Also handles showing system notifications for incoming transfer requests
 * when the app is not in the foreground.
 */
class WyreService : Service() {

    private var manager: WyreManager? = null
    private var incomingNotifId = 2000

    companion object {
        const val CHANNEL_PERSISTENT = "wyre_persistent"
        const val CHANNEL_INCOMING   = "wyre_incoming"
        const val NOTIF_ID_PERSISTENT = 1

        fun start(context: Context) {
            val intent = Intent(context, WyreService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, WyreService::class.java))
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
        startForeground(NOTIF_ID_PERSISTENT, buildPersistentNotification())

        manager = WyreManager(applicationContext) { event, data ->
            // Forward events to the plugin if the app is open
            WyrePluginBridge.notifyIfActive(event, data)

            // Show system notification for incoming requests when app is in background
            if (event == "incomingRequest" && !WyrePluginBridge.isAppInForeground()) {
                showIncomingNotification(data)
            }
        }
        manager?.start()
        WyrePluginBridge.serviceManager = manager
    }

    override fun onDestroy() {
        manager?.stop()
        WyrePluginBridge.serviceManager = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY // Restart if killed by system
    }

    // ── Notifications ─────────────────────────────────────────────────────────

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)

            // Persistent silent notification (required for foreground service)
            nm.createNotificationChannel(NotificationChannel(
                CHANNEL_PERSISTENT,
                "Wyre Running",
                NotificationManager.IMPORTANCE_MIN
            ).apply {
                description = "Keeps Wyre active to receive files"
                setShowBadge(false)
            })

            // Incoming transfer alerts
            nm.createNotificationChannel(NotificationChannel(
                CHANNEL_INCOMING,
                "Incoming Files",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Alerts when someone wants to send you a file"
                enableVibration(true)
            })
        }
    }

    private fun buildPersistentNotification(): Notification {
        val openIntent = PendingIntent.getActivity(
            this, 0,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, CHANNEL_PERSISTENT)
            .setContentTitle("Wyre is active")
            .setContentText("Ready to receive files")
            .setSmallIcon(R.drawable.ic_stat_wyre)
            .setContentIntent(openIntent)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()
    }

    private fun showIncomingNotification(data: JSObject) {
        val senderName = data.getString("senderName") ?: "Someone"
        val fileName   = data.getString("fileName")   ?: "a file"
        val transferId = data.getString("transferId") ?: return

        val openIntent = PendingIntent.getActivity(
            this, transferId.hashCode(),
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val notif = NotificationCompat.Builder(this, CHANNEL_INCOMING)
            .setContentTitle("$senderName wants to send you a file")
            .setContentText(fileName)
            .setSmallIcon(R.drawable.ic_stat_wyre)
            .setContentIntent(openIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        NotificationManagerCompat.from(this).notify(incomingNotifId++, notif)
    }
}
