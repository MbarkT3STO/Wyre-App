package com.wyre.app

/** Marker interface for cancellable operations */
interface Cancellable { fun cancel() }

/** Incoming transfer request from a peer */
data class IncomingRequest(
    val transferId: String,
    val senderDeviceId: String,
    val senderName: String,
    val fileName: String,
    val fileSize: Long,
    val checksum: String
)

/** Sealed event hierarchy emitted by TransferClient and TransferServer */
sealed class TransferEvent {
    data class Started(
        val transferId: String,
        val direction: String,
        val peerId: String,
        val peerName: String,
        val fileName: String,
        val fileSize: Long,
        val status: String
    ) : TransferEvent()

    data class Progress(
        val transferId: String,
        val progress: Int,
        val speed: Long,
        val eta: Long,
        val bytesTransferred: Long,
        val totalBytes: Long
    ) : TransferEvent()

    data class Complete(
        val transferId: String,
        val direction: String,
        val peerId: String,
        val peerName: String,
        val fileName: String,
        val fileSize: Long,
        val savedPath: String,
        val startedAt: Long
    ) : TransferEvent()

    data class Error(
        val transferId: String,
        val error: String,
        val code: String
    ) : TransferEvent()
}
