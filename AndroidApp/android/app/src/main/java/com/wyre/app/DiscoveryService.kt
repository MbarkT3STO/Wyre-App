package com.wyre.app

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.NetworkInterface
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import org.json.JSONObject

private const val BROADCAST_PORT = 49152
private const val BROADCAST_INTERVAL_SEC = 3L
private const val DEVICE_TIMEOUT_MS = 10_000L

data class DeviceInfo(
    val id: String,
    val name: String,
    val platform: String,
    val ip: String,
    val port: Int,
    val version: String,
    val lastSeen: Long,
    val online: Boolean
)

/**
 * DiscoveryService.kt
 * UDP broadcast + listen — mirrors the desktop UdpBroadcaster + UdpListener.
 */
class DiscoveryService(
    private val deviceId: String,
    private var deviceName: String,
    private val platform: String,
    private val port: Int,
    private val version: String,
    private val executor: java.util.concurrent.ExecutorService,
    private val onDevicesChanged: (List<DeviceInfo>) -> Unit
) {
    private val devices = ConcurrentHashMap<String, DeviceInfo>()
    private val scheduler: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
    private var broadcastFuture: ScheduledFuture<*>? = null
    private var evictionFuture: ScheduledFuture<*>? = null
    private var listenSocket: DatagramSocket? = null
    @Volatile private var running = false

    fun start() {
        if (running) return
        running = true
        startBroadcasting()
        startListening()
        startEviction()
    }

    fun stop() {
        running = false
        broadcastFuture?.cancel(false)
        evictionFuture?.cancel(false)
        listenSocket?.close()
        scheduler.shutdownNow()
    }

    fun updateName(name: String) { deviceName = name }

    /** Returns all currently online devices */
    fun getDevices(): List<DeviceInfo> = devices.values.filter { it.online }

    private fun startBroadcasting() {
        broadcastFuture = scheduler.scheduleAtFixedRate({
            try {
                val payload = buildAnnouncement()
                val bytes = payload.toByteArray(Charsets.UTF_8)
                val broadcastAddr = getDirectedBroadcast() ?: InetAddress.getByName("255.255.255.255")
                DatagramSocket().use { sock ->
                    sock.broadcast = true
                    val packet = DatagramPacket(bytes, bytes.size, broadcastAddr, BROADCAST_PORT)
                    sock.send(packet)
                }
            } catch (_: Exception) {}
        }, 0, BROADCAST_INTERVAL_SEC, TimeUnit.SECONDS)
    }

    private fun startListening() {
        executor.submit {
            try {
                val sock = DatagramSocket(null).apply {
                    reuseAddress = true
                    bind(java.net.InetSocketAddress(BROADCAST_PORT))
                    broadcast = true
                }
                listenSocket = sock
                val buf = ByteArray(4096)
                while (running) {
                    try {
                        val packet = DatagramPacket(buf, buf.size)
                        sock.receive(packet)
                        val msg = String(packet.data, 0, packet.length, Charsets.UTF_8)
                        val senderIp = packet.address.hostAddress ?: continue
                        handleAnnouncement(msg, senderIp)
                    } catch (_: Exception) { if (!running) break }
                }
            } catch (_: Exception) {}
        }
    }

    private fun startEviction() {
        evictionFuture = scheduler.scheduleAtFixedRate({
            val now = System.currentTimeMillis()
            var changed = false
            for ((id, device) in devices) {
                if (device.online && now - device.lastSeen > DEVICE_TIMEOUT_MS) {
                    devices[id] = device.copy(online = false)
                    changed = true
                }
                if (!device.online && now - device.lastSeen > 60_000) {
                    devices.remove(id)
                    changed = true
                }
            }
            if (changed) onDevicesChanged(devices.values.filter { it.online })
        }, 2, 2, TimeUnit.SECONDS)
    }

    private fun handleAnnouncement(msg: String, senderIp: String) {
        try {
            val json = JSONObject(msg)
            val id = json.getString("id")
            if (id == deviceId) return // ignore own broadcasts

            val now = System.currentTimeMillis()
            val existing = devices[id]
            val device = DeviceInfo(
                id       = id,
                name     = json.getString("name"),
                platform = json.getString("platform"),
                ip       = senderIp,
                port     = json.getInt("port"),
                version  = json.getString("version"),
                lastSeen = now,
                online   = true
            )

            val changed = existing == null || !existing.online
                || existing.name != device.name
                || existing.ip != device.ip
                || existing.port != device.port

            devices[id] = device
            if (changed) onDevicesChanged(devices.values.filter { it.online })
        } catch (_: Exception) {}
    }

    private fun buildAnnouncement(): String = JSONObject().apply {
        put("id",       deviceId)
        put("name",     deviceName)
        put("platform", platform)
        put("port",     port)
        put("version",  version)
    }.toString()

    private fun getDirectedBroadcast(): InetAddress? {
        return try {
            NetworkInterface.getNetworkInterfaces()?.toList()
                ?.flatMap { it.interfaceAddresses }
                ?.firstOrNull { !it.address.isLoopbackAddress && it.address is java.net.Inet4Address }
                ?.let { ia ->
                    val addr = ia.address.address
                    val prefix = ia.networkPrefixLength.toInt()
                    val mask = if (prefix == 0) 0 else (-1 shl (32 - prefix))
                    val broadcast = (addr.fold(0) { acc, b -> (acc shl 8) or (b.toInt() and 0xFF) } or mask.inv())
                    InetAddress.getByAddress(byteArrayOf(
                        (broadcast shr 24).toByte(),
                        (broadcast shr 16).toByte(),
                        (broadcast shr 8).toByte(),
                        broadcast.toByte()
                    ))
                }
        } catch (_: Exception) { null }
    }
}
