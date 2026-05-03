/**
 * ChatIpcBridge.ts
 * Registers all ipcMain handlers for chat and wires ChatManager events
 * to renderer pushes. Follows the same pattern as IpcBridge.ts.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { ChatIpcChannels } from '../../shared/ipc/ChatIpcContracts';
import type {
  ChatSessionOpenPayload,
  ChatSessionClosePayload,
  ChatSendTextPayload,
  ChatSendFilePayload,
  ChatInviteAcceptPayload,
  ChatInviteDeclinePayload,
  ChatMarkReadPayload,
  ChatRequestCancelPayload,
  ChatEditMessagePayload,
  ChatDeleteMessagePayload,
} from '../../shared/ipc/ChatIpcContracts';
import type { ChatManager } from './ChatManager';

export class ChatIpcBridge {
  private chatManager: ChatManager;
  private getMainWindow: () => BrowserWindow | null;

  constructor(options: {
    chatManager: ChatManager;
    getMainWindow: () => BrowserWindow | null;
  }) {
    this.chatManager = options.chatManager;
    this.getMainWindow = options.getMainWindow;
  }

  register(): void {
    this.registerHandlers();
    this.wireManagerEvents();
  }

  private send(channel: string, payload: unknown): void {
    const win = this.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }

  private registerHandlers(): void {
    // Open a chat session
    ipcMain.handle(ChatIpcChannels.CHAT_SESSION_OPEN, async (_event, payload: ChatSessionOpenPayload) => {
      const session = await this.chatManager.openSession(payload.deviceId);
      return session;
    });

    // Close a chat session
    ipcMain.handle(ChatIpcChannels.CHAT_SESSION_CLOSE, (_event, payload: ChatSessionClosePayload) => {
      this.chatManager.closeSession(payload.sessionId);
    });

    // Send a text message
    ipcMain.handle(ChatIpcChannels.CHAT_SEND_TEXT, (_event, payload: ChatSendTextPayload) => {
      const message = this.chatManager.sendText(payload.sessionId, payload.text);
      return message;
    });

    // Send a file or image
    ipcMain.handle(ChatIpcChannels.CHAT_SEND_FILE, async (_event, payload: ChatSendFilePayload) => {
      const message = await this.chatManager.sendFile(
        payload.sessionId,
        payload.filePath,
        payload.fileName,
        payload.fileSize,
      );
      return message;
    });

    // Accept a chat invite
    ipcMain.handle(ChatIpcChannels.CHAT_INVITE_ACCEPT, (_event, payload: ChatInviteAcceptPayload) => {
      this.chatManager.acceptInvite(payload.sessionId);
    });

    // Decline a chat invite
    ipcMain.handle(ChatIpcChannels.CHAT_INVITE_DECLINE, (_event, payload: ChatInviteDeclinePayload) => {
      this.chatManager.declineInvite(payload.sessionId);
    });

    // Get all sessions
    ipcMain.handle(ChatIpcChannels.CHAT_SESSIONS_GET, () => {
      return this.chatManager.getSessions();
    });

    // Mark messages as read
    ipcMain.handle(ChatIpcChannels.CHAT_MARK_READ, (_event, payload: ChatMarkReadPayload) => {
      this.chatManager.markRead(payload.sessionId);
    });

    // Cancel an outgoing chat request
    ipcMain.handle(ChatIpcChannels.CHAT_REQUEST_CANCEL, (_event, payload: ChatRequestCancelPayload) => {
      this.chatManager.cancelRequest(payload.sessionId);
    });

    // Edit a message
    ipcMain.handle(ChatIpcChannels.CHAT_EDIT_MESSAGE, (_event, payload: ChatEditMessagePayload) => {
      return this.chatManager.editMessage(payload.sessionId, payload.messageId, payload.newText);
    });

    // Delete a message
    ipcMain.handle(ChatIpcChannels.CHAT_DELETE_MESSAGE, (_event, payload: ChatDeleteMessagePayload) => {
      return this.chatManager.deleteMessage(payload.sessionId, payload.messageId);
    });
  }

  private wireManagerEvents(): void {
    this.chatManager.on('message', (sessionId, message) => {
      this.send(ChatIpcChannels.CHAT_MESSAGE, { sessionId, message });
    });

    this.chatManager.on('messageStatus', (sessionId, messageId, status) => {
      this.send(ChatIpcChannels.CHAT_MESSAGE_STATUS, { sessionId, messageId, status });
    });

    this.chatManager.on('sessionUpdated', (session) => {
      this.send(ChatIpcChannels.CHAT_SESSION_UPDATED, { session });
    });

    this.chatManager.on('invite', (sessionId, peerId, peerName) => {
      this.send(ChatIpcChannels.CHAT_INVITE, { sessionId, peerId, peerName });
    });

    this.chatManager.on('requestPending', (sessionId, peerId, peerName) => {
      this.send(ChatIpcChannels.CHAT_REQUEST_PENDING, { sessionId, peerId, peerName });
    });

    this.chatManager.on('requestResolved', (sessionId, outcome) => {
      this.send(ChatIpcChannels.CHAT_REQUEST_RESOLVED, { sessionId, outcome });
    });

    this.chatManager.on('messageEdited', (sessionId, messageId, newText, editedAt) => {
      this.send(ChatIpcChannels.CHAT_MESSAGE_EDITED, { sessionId, messageId, newText, editedAt });
    });

    this.chatManager.on('messageDeleted', (sessionId, messageId) => {
      this.send(ChatIpcChannels.CHAT_MESSAGE_DELETED, { sessionId, messageId });
    });
  }
}
