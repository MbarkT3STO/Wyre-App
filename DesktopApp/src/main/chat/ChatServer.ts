/**
 * ChatServer.ts
 * Listens on the same TCP port as TransferServer.
 * Chat connections are identified by the 'type: chat_handshake' header field.
 * The TransferServer routes chat connections here via the chatConnection event.
 *
 * Protocol:
 *   1. Sender connects and sends a JSON handshake line:
 *      { "type": "chat_handshake", "senderDeviceId": "...", "senderName": "..." }\n
 *   2. Receiver responds:
 *      { "accepted": true }\n  or  { "accepted": false }\n
 *   3. Both sides exchange newline-delimited JSON messages:
 *      { "type": "chat", "id": "...", "senderDeviceId": "...", ... }\n
 *      { "type": "chat_ack", "id": "..." }\n
 *      { "type": "chat_close", "senderDeviceId": "..." }\n
 *
 * File/image attachments are sent inline as base64 in the wire message
 * (capped at MAX_INLINE_FILE_BYTES). Larger files fall back to a
 * separate TransferServer send.
 */

import { EventEmitter } from 'events';
import { Socket } from 'net';
import { randomUUID } from 'crypto';
import { basename } from 'path';
import { readFile } from 'fs/promises';
import type {
  ChatWireMessage,
  ChatAckWireMessage,
  ChatHandshakeWireMessage,
  ChatCloseWireMessage,
} from '../../shared/models/ChatMessage';
import { Logger } from '../logging/Logger';

/** Maximum file size to send inline as base64 (4 MB) */
const MAX_INLINE_FILE_BYTES = 4 * 1024 * 1024;

/** Maximum text message length */
const MAX_TEXT_LENGTH = 10_000;

/** Maximum header/message size before we drop the connection */
const MAX_MESSAGE_SIZE = 8 * 1024 * 1024; // 8 MB

export interface IncomingChatSession {
  sessionId: string;
  peerId: string;
  peerName: string;
  socket: Socket;
}

export interface ChatServerEvents {
  /** A peer wants to start a chat session */
  incomingSession: (session: IncomingChatSession) => void;
  /** A message was received on an active session */
  message: (sessionId: string, msg: ChatWireMessage) => void;
  /** A session was closed by the peer */
  sessionClosed: (sessionId: string) => void;
  /** A socket error occurred on a session */
  sessionError: (sessionId: string, err: Error) => void;
}

export declare interface ChatServer {
  on<K extends keyof ChatServerEvents>(event: K, listener: ChatServerEvents[K]): this;
  emit<K extends keyof ChatServerEvents>(event: K, ...args: Parameters<ChatServerEvents[K]>): boolean;
}

interface ActiveSession {
  socket: Socket;
  peerId: string;
  peerName: string;
  sendBuffer: string;
}

export class ChatServer extends EventEmitter {
  private sessions: Map<string, ActiveSession> = new Map();
  private logger: Logger | null = null;

  constructor() {
    super();
    try { this.logger = Logger.getInstance(); } catch { /* not yet initialised */ }
  }

  /**
   * Called by TransferServer when it detects a chat_handshake connection.
   * The socket has already been paused; remainingBuffer contains bytes after the header line.
   */
  handleIncomingConnection(
    socket: Socket,
    handshake: ChatHandshakeWireMessage,
    remainingBuffer: Buffer,
  ): void {
    const sessionId = this.makeSessionId(handshake.senderDeviceId);

    // If a session already exists for this peer, close the old one first
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.socket.destroy();
      this.sessions.delete(sessionId);
    }

    const session: IncomingChatSession = {
      sessionId,
      peerId: handshake.senderDeviceId,
      peerName: handshake.senderName,
      socket,
    };

    this.emit('incomingSession', session);

    // Store temporarily — accept/decline will be called by ChatManager
    this.sessions.set(sessionId, {
      socket,
      peerId: handshake.senderDeviceId,
      peerName: handshake.senderName,
      sendBuffer: '',
    });

    // Attach message handler with any leftover bytes
    this.attachMessageHandler(sessionId, socket, remainingBuffer);
  }

  /**
   * Accept an incoming session — sends the accept response.
   */
  acceptSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try {
      session.socket.write(JSON.stringify({ accepted: true }) + '\n');
    } catch (err) {
      this.logger?.warn('ChatServer: failed to send accept', { sessionId, err: String(err) });
    }
  }

  /**
   * Decline an incoming session — sends the decline response and closes.
   */
  declineSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try {
      session.socket.write(JSON.stringify({ accepted: false }) + '\n');
      session.socket.destroy();
    } catch { /* ignore */ }
    this.sessions.delete(sessionId);
  }

  /**
   * Register an outgoing session (initiated by us).
   * The socket is already connected and the handshake has been sent.
   */
  registerOutgoingSession(sessionId: string, peerId: string, peerName: string, socket: Socket): void {
    this.sessions.set(sessionId, { socket, peerId, peerName, sendBuffer: '' });
    this.attachMessageHandler(sessionId, socket, Buffer.alloc(0));
  }

  /**
   * Send a text message on a session.
   */
  sendText(sessionId: string, messageId: string, senderDeviceId: string, senderName: string, text: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.socket.destroyed) return false;

    const wire: ChatWireMessage = {
      type: 'chat',
      id: messageId,
      senderDeviceId,
      senderName,
      msgType: 'text',
      text: text.slice(0, MAX_TEXT_LENGTH),
      timestamp: Date.now(),
    };

    return this.writeMessage(session, wire);
  }

  /**
   * Send a file or image on a session.
   * Reads the file and sends it inline as base64 if ≤ MAX_INLINE_FILE_BYTES.
   * Returns false if the file is too large (caller should use TransferServer instead).
   */
  async sendFile(
    sessionId: string,
    messageId: string,
    senderDeviceId: string,
    senderName: string,
    filePath: string,
    fileName: string,
    fileSize: number,
  ): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || session.socket.destroyed) return false;

    if (fileSize > MAX_INLINE_FILE_BYTES) return false;

    try {
      const data = await readFile(filePath);
      const base64 = data.toString('base64');
      const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
      const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext);

      const wire: ChatWireMessage = {
        type: 'chat',
        id: messageId,
        senderDeviceId,
        senderName,
        msgType: isImage ? 'image' : 'file',
        fileName: basename(fileName),
        fileSize,
        thumbnail: base64,
        timestamp: Date.now(),
      };

      return this.writeMessage(session, wire);
    } catch (err) {
      this.logger?.warn('ChatServer: failed to read file for chat', { filePath, err: String(err) });
      return false;
    }
  }

  /**
   * Send an acknowledgement for a received message.
   */
  sendAck(sessionId: string, messageId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.socket.destroyed) return;
    const ack: ChatAckWireMessage = { type: 'chat_ack', id: messageId };
    this.writeMessage(session, ack);
  }

  /**
   * Close a session gracefully.
   */
  closeSession(sessionId: string, senderDeviceId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const close: ChatCloseWireMessage = { type: 'chat_close', senderDeviceId };
    try {
      this.writeMessage(session, close);
      session.socket.end();
    } catch { /* ignore */ }
    this.sessions.delete(sessionId);
  }

  /**
   * Force-close a session without sending a close message.
   */
  destroySession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.socket.destroy();
    this.sessions.delete(sessionId);
  }

  isSessionActive(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return !!session && !session.socket.destroyed;
  }

  stop(): void {
    for (const [id, session] of this.sessions) {
      try { session.socket.destroy(); } catch { /* ignore */ }
      this.sessions.delete(id);
    }
  }

  /** Derive a stable session ID from a peer device ID */
  makeSessionId(peerId: string): string {
    return `chat_${peerId}`;
  }

  private writeMessage(session: ActiveSession, msg: object): boolean {
    try {
      const line = JSON.stringify(msg) + '\n';
      return session.socket.write(line);
    } catch (err) {
      this.logger?.warn('ChatServer: write failed', { err: String(err) });
      return false;
    }
  }

  private attachMessageHandler(sessionId: string, socket: Socket, initialBuffer: Buffer): void {
    let buffer = initialBuffer.length > 0 ? Buffer.from(initialBuffer) : Buffer.alloc(0);

    const processBuffer = (): void => {
      while (true) {
        const newlineIdx = buffer.indexOf(0x0a);
        if (newlineIdx === -1) break;

        const line = buffer.slice(0, newlineIdx).toString('utf8');
        buffer = buffer.slice(newlineIdx + 1);

        if (!line.trim()) continue;

        try {
          const msg = JSON.parse(line) as Record<string, unknown>;
          this.handleIncomingMessage(sessionId, msg);
        } catch {
          // Malformed JSON — ignore
        }
      }
    };

    // Process any bytes that arrived with the handshake
    if (buffer.length > 0) processBuffer();

    socket.on('data', (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      buffer = Buffer.concat([buffer, buf]);

      if (buffer.length > MAX_MESSAGE_SIZE) {
        socket.destroy(new Error('Chat message too large'));
        this.sessions.delete(sessionId);
        return;
      }

      processBuffer();
    });

    socket.on('end', () => {
      this.sessions.delete(sessionId);
      this.emit('sessionClosed', sessionId);
    });

    socket.on('close', () => {
      this.sessions.delete(sessionId);
    });

    socket.on('error', (err) => {
      this.sessions.delete(sessionId);
      this.emit('sessionError', sessionId, err);
    });

    socket.resume();
  }

  private handleIncomingMessage(sessionId: string, msg: Record<string, unknown>): void {
    const type = msg['type'] as string | undefined;

    if (type === 'chat') {
      const wire = msg as unknown as ChatWireMessage;
      // Validate required fields
      if (!wire.id || !wire.senderDeviceId) return;
      // Sanitise text
      if (wire.text) wire.text = wire.text.slice(0, MAX_TEXT_LENGTH);
      // Sanitise file name
      if (wire.fileName) wire.fileName = basename(wire.fileName).replace(/[\x00-\x1F\x7F]/g, '');
      // Send ack
      this.sendAck(sessionId, wire.id);
      this.emit('message', sessionId, wire);
    } else if (type === 'chat_close') {
      this.sessions.delete(sessionId);
      this.emit('sessionClosed', sessionId);
    } else if (type === 'chat_ack') {
      // Acks are handled by ChatManager
      const ack = msg as unknown as ChatAckWireMessage;
      this.emit('message', sessionId, { type: 'chat_ack', id: ack.id } as unknown as ChatWireMessage);
    }
  }
}

export { randomUUID };
