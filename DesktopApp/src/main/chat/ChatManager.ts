/**
 * ChatManager.ts
 * Orchestrates chat sessions: creates, tracks, and tears down sessions.
 * Bridges ChatServer + ChatClient with the IPC layer.
 * No Electron/IPC knowledge — emits typed events consumed by ChatIpcBridge.
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { writeFile, mkdir } from 'fs/promises';
import { join, extname } from 'path';
import type { Socket } from 'net';
import { ChatServer } from './ChatServer';
import { ChatClient } from './ChatClient';
import type { ChatMessage, ChatSession, ChatWireMessage } from '../../shared/models/ChatMessage';
import type { DiscoveryService } from '../discovery/DiscoveryService';
import type { SettingsStore } from '../store/SettingsStore';
import { Logger } from '../logging/Logger';

export interface ChatManagerEvents {
  /** A new message was sent or received */
  message: (sessionId: string, message: ChatMessage) => void;
  /** Message delivery status changed */
  messageStatus: (sessionId: string, messageId: string, status: ChatMessage['status']) => void;
  /** Session state changed */
  sessionUpdated: (session: ChatSession) => void;
  /** A peer wants to start a chat (receiver side) */
  invite: (sessionId: string, peerId: string, peerName: string) => void;
  /** Sender's outgoing request is pending (waiting for receiver to accept/decline) */
  requestPending: (sessionId: string, peerId: string, peerName: string) => void;
  /** Sender's outgoing request was resolved */
  requestResolved: (sessionId: string, outcome: 'accepted' | 'declined' | 'cancelled' | 'timeout') => void;
  /** A message was edited (own or peer) */
  messageEdited: (sessionId: string, messageId: string, newText: string, editedAt: number) => void;
  /** A message was deleted (own or peer) */
  messageDeleted: (sessionId: string, messageId: string) => void;
}

export declare interface ChatManager {
  on<K extends keyof ChatManagerEvents>(event: K, listener: ChatManagerEvents[K]): this;
  emit<K extends keyof ChatManagerEvents>(event: K, ...args: Parameters<ChatManagerEvents[K]>): boolean;
}

export class ChatManager extends EventEmitter {
  private chatServer: ChatServer;
  private chatClient: ChatClient;
  private discoveryService: DiscoveryService;
  private settingsStore: SettingsStore;
  private sessions: Map<string, ChatSession> = new Map();
  /** Pending invites waiting for user accept/decline */
  private pendingInvites: Set<string> = new Set();
  private logger: Logger | null = null;

  constructor(options: {
    chatServer: ChatServer;
    chatClient: ChatClient;
    discoveryService: DiscoveryService;
    settingsStore: SettingsStore;
  }) {
    super();
    this.chatServer = options.chatServer;
    this.chatClient = options.chatClient;
    this.discoveryService = options.discoveryService;
    this.settingsStore = options.settingsStore;
    try { this.logger = Logger.getInstance(); } catch { /* not yet initialised */ }

    this.wireChatServer();
    this.wireChatClient();
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Open a chat session with a peer device.
   * If a session already exists and is connected, returns it immediately.
   */
  async openSession(deviceId: string): Promise<ChatSession> {
    const sessionId = this.chatServer.makeSessionId(deviceId);

    // Return existing connected session
    const existing = this.sessions.get(sessionId);
    if (existing && this.chatServer.isSessionActive(sessionId)) {
      return existing;
    }

    // Find the device
    const devices = this.discoveryService.getDevices();
    const device = devices.find(d => d.id === deviceId);
    if (!device) throw new Error(`Device ${deviceId} not found or offline`);

    // Create or reset session
    const session: ChatSession = existing ?? {
      id: sessionId,
      peerId: deviceId,
      peerName: device.name,
      connected: false,
      messages: existing?.messages ?? [],
      lastActivity: Date.now(),
      unreadCount: 0,
    };

    session.connected = false;
    session.peerName = device.name;
    this.sessions.set(sessionId, session);
    this.emit('sessionUpdated', { ...session });

    // Connect
    const settings = this.settingsStore.get();
    this.chatClient.connect({
      sessionId,
      peerIp: device.ip,
      peerPort: device.port,
      senderDeviceId: settings.deviceId,
      senderName: settings.deviceName,
    });

    // Notify renderer that the outgoing request is now pending
    this.emit('requestPending', sessionId, deviceId, device.name);

    return session;
  }

  /**
   * Cancel an outgoing chat request (before it is accepted).
   */
  cancelRequest(sessionId: string): void {
    this.chatServer.destroySession(sessionId);
    const session = this.sessions.get(sessionId);
    if (session) {
      session.connected = false;
      this.emit('sessionUpdated', { ...session });
    }
    this.emit('requestResolved', sessionId, 'cancelled');
  }

  /**
   * Close a chat session.
   */
  closeSession(sessionId: string): void {
    const settings = this.settingsStore.get();
    this.chatServer.closeSession(sessionId, settings.deviceId);
    const session = this.sessions.get(sessionId);
    if (session) {
      session.connected = false;
      this.emit('sessionUpdated', { ...session });
    }
  }

  /**
   * Accept a pending chat invite.
   */
  acceptInvite(sessionId: string): void {
    if (!this.pendingInvites.has(sessionId)) return;
    this.pendingInvites.delete(sessionId);
    this.chatServer.acceptSession(sessionId);

    const session = this.sessions.get(sessionId);
    if (session) {
      session.connected = true;
      this.emit('sessionUpdated', { ...session });
    }
  }

  /**
   * Decline a pending chat invite.
   */
  declineInvite(sessionId: string): void {
    if (!this.pendingInvites.has(sessionId)) return;
    this.pendingInvites.delete(sessionId);
    this.chatServer.declineSession(sessionId);
    this.sessions.delete(sessionId);
  }

  /**
   * Send a text message on a session.
   */
  sendText(sessionId: string, text: string): ChatMessage | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const settings = this.settingsStore.get();
    const messageId = randomUUID();

    const message: ChatMessage = {
      id: messageId,
      sessionId,
      senderId: settings.deviceId,
      senderName: settings.deviceName,
      isOwn: true,
      type: 'text',
      text,
      timestamp: Date.now(),
      status: 'sending',
    };

    this.addMessage(session, message);

    const sent = this.chatServer.sendText(
      sessionId,
      messageId,
      settings.deviceId,
      settings.deviceName,
      text,
    );

    if (sent) {
      message.status = 'sent';
      this.emit('messageStatus', sessionId, messageId, 'sent');
    } else {
      message.status = 'failed';
      this.emit('messageStatus', sessionId, messageId, 'failed');
    }

    return message;
  }

  /**
   * Send a file or image on a session.
   * Reads the file locally so the sender also sees the image preview.
   */
  async sendFile(sessionId: string, filePath: string, fileName: string, fileSize: number): Promise<ChatMessage | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const settings = this.settingsStore.get();
    const messageId = randomUUID();
    const ext = extname(fileName).toLowerCase().slice(1);
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext);

    // Read file as base64 so the sender can also see the preview
    let thumbnail: string | undefined;
    try {
      const { readFile } = await import('fs/promises');
      const data = await readFile(filePath);
      thumbnail = data.toString('base64');
    } catch {
      thumbnail = undefined;
    }

    const message: ChatMessage = {
      id: messageId,
      sessionId,
      senderId: settings.deviceId,
      senderName: settings.deviceName,
      isOwn: true,
      type: isImage ? 'image' : 'file',
      fileName,
      fileSize,
      filePath,
      thumbnail: isImage ? thumbnail : undefined,
      timestamp: Date.now(),
      status: 'sending',
    };

    this.addMessage(session, message);

    const sent = await this.chatServer.sendFile(
      sessionId,
      messageId,
      settings.deviceId,
      settings.deviceName,
      filePath,
      fileName,
      fileSize,
    );

    if (sent) {
      message.status = 'sent';
      this.emit('messageStatus', sessionId, messageId, 'sent');
    } else {
      message.status = 'failed';
      this.emit('messageStatus', sessionId, messageId, 'failed');
    }

    return message;
  }

  /**
   * Get all sessions.
   */
  getSessions(): ChatSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Mark all messages in a session as read.
   */
  markRead(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.unreadCount = 0;
    this.emit('sessionUpdated', { ...session });
  }

  /**
   * Edit a sent text message. Only own messages can be edited.
   * Propagates the edit to the peer over the wire.
   */
  editMessage(sessionId: string, messageId: string, newText: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const msg = session.messages.find(m => m.id === messageId);
    if (!msg || !msg.isOwn || msg.type !== 'text' || msg.deleted) return false;

    const editedAt = Date.now();
    msg.text = newText;
    msg.editedAt = editedAt;

    const settings = this.settingsStore.get();
    this.chatServer.sendEdit(sessionId, messageId, settings.deviceId, newText);

    this.emit('messageEdited', sessionId, messageId, newText, editedAt);
    return true;
  }

  /**
   * Delete a message. Only own messages can be deleted.
   * Sends a delete wire message to the peer so their copy is also removed.
   */
  deleteMessage(sessionId: string, messageId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const msg = session.messages.find(m => m.id === messageId);
    if (!msg || !msg.isOwn || msg.deleted) return false;

    msg.deleted = true;

    const settings = this.settingsStore.get();
    this.chatServer.sendDelete(sessionId, messageId, settings.deviceId);

    this.emit('messageDeleted', sessionId, messageId);
    return true;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private wireChatServer(): void {
    this.chatServer.on('incomingSession', (incoming) => {
      const { sessionId, peerId, peerName } = incoming;

      // Create session in pending state
      const session: ChatSession = {
        id: sessionId,
        peerId,
        peerName,
        connected: false,
        messages: this.sessions.get(sessionId)?.messages ?? [],
        lastActivity: Date.now(),
        unreadCount: 0,
      };
      this.sessions.set(sessionId, session);
      this.pendingInvites.add(sessionId);

      this.emit('invite', sessionId, peerId, peerName);
    });

    this.chatServer.on('message', (sessionId, wire) => {
      // Handle acks
      if ((wire as unknown as { type: string }).type === 'chat_ack') {
        const ack = wire as unknown as { type: string; id: string };
        const session = this.sessions.get(sessionId);
        if (session) {
          const msg = session.messages.find(m => m.id === ack.id);
          if (msg && msg.status !== 'delivered') {
            msg.status = 'delivered';
            this.emit('messageStatus', sessionId, ack.id, 'delivered');
          }
        }
        return;
      }

      this.handleIncomingMessage(sessionId, wire);
    });

    this.chatServer.on('sessionClosed', (sessionId) => {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.connected = false;
        this.emit('sessionUpdated', { ...session });
      }
    });

    this.chatServer.on('sessionError', (sessionId, err) => {
      this.logger?.warn('ChatManager: session error', { sessionId, err: err.message });
      const session = this.sessions.get(sessionId);
      if (session) {
        session.connected = false;
        this.emit('sessionUpdated', { ...session });
      }
    });

    // Peer edited a message
    this.chatServer.on('messageEdited', (sessionId, messageId, newText, editedAt) => {
      const session = this.sessions.get(sessionId);
      if (!session) return;
      const msg = session.messages.find(m => m.id === messageId);
      if (msg && !msg.deleted) {
        msg.text = newText;
        msg.editedAt = editedAt;
        this.emit('messageEdited', sessionId, messageId, newText, editedAt);
      }
    });

    // Peer deleted a message
    this.chatServer.on('messageDeleted', (sessionId, messageId) => {
      const session = this.sessions.get(sessionId);
      if (!session) return;
      const msg = session.messages.find(m => m.id === messageId);
      if (msg) {
        msg.deleted = true;
        this.emit('messageDeleted', sessionId, messageId);
      }
    });
  }

  private wireChatClient(): void {
    this.chatClient.on('connected', (sessionId, socket) => {
      const session = this.sessions.get(sessionId);
      if (!session) return;

      session.connected = true;
      this.emit('sessionUpdated', { ...session });
      // Outgoing request accepted — notify renderer
      this.emit('requestResolved', sessionId, 'accepted');

      // Register the outgoing socket with ChatServer for message handling
      this.chatServer.registerOutgoingSession(sessionId, session.peerId, session.peerName, socket);
    });

    this.chatClient.on('declined', (sessionId) => {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.connected = false;
        this.emit('sessionUpdated', { ...session });
      }
      this.emit('requestResolved', sessionId, 'declined');
    });

    this.chatClient.on('error', (sessionId, err) => {
      this.logger?.warn('ChatManager: client error', { sessionId, err: err.message });
      const session = this.sessions.get(sessionId);
      if (session) {
        session.connected = false;
        this.emit('sessionUpdated', { ...session });
      }
      this.emit('requestResolved', sessionId, 'timeout');
    });
  }

  private async handleIncomingMessage(sessionId: string, wire: ChatWireMessage): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const settings = this.settingsStore.get();
    let filePath: string | undefined;

    // Save inline file/image to disk
    if ((wire.msgType === 'file' || wire.msgType === 'image') && wire.thumbnail && wire.fileName) {
      try {
        const saveDir = join(settings.saveDirectory, 'Chat');
        await mkdir(saveDir, { recursive: true });
        const safeName = wire.fileName.replace(/[^a-zA-Z0-9._\-]/g, '_');
        filePath = join(saveDir, `${Date.now()}_${safeName}`);
        const data = Buffer.from(wire.thumbnail, 'base64');
        await writeFile(filePath, data);
      } catch (err) {
        this.logger?.warn('ChatManager: failed to save chat file', { err: String(err) });
      }
    }

    const message: ChatMessage = {
      id: wire.id,
      sessionId,
      senderId: wire.senderDeviceId,
      senderName: wire.senderName,
      isOwn: wire.senderDeviceId === settings.deviceId,
      type: wire.msgType,
      text: wire.text,
      fileName: wire.fileName,
      fileSize: wire.fileSize,
      filePath,
      thumbnail: wire.msgType === 'image' ? wire.thumbnail : undefined,
      timestamp: wire.timestamp,
      status: 'delivered',
    };

    this.addMessage(session, message);
    this.emit('message', sessionId, message);
  }

  private addMessage(session: ChatSession, message: ChatMessage): void {
    session.messages.push(message);
    session.lastActivity = message.timestamp;
    if (!message.isOwn) {
      session.unreadCount++;
    }
    this.emit('message', session.id, message);
    this.emit('sessionUpdated', { ...session });
  }
}
