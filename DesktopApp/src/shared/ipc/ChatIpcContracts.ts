/**
 * ChatIpcContracts.ts
 * IPC channel names and payload types for the chat feature.
 * Imported by both main process and renderer.
 */

import type { ChatMessage, ChatSession } from '../models/ChatMessage';

// ─── Channel Names ────────────────────────────────────────────────────────────

export const ChatIpcChannels = {
  /** Renderer → main: open/create a chat session with a device */
  CHAT_SESSION_OPEN: 'chat:session:open',
  /** Renderer → main: close a chat session */
  CHAT_SESSION_CLOSE: 'chat:session:close',
  /** Renderer → main: send a text message */
  CHAT_SEND_TEXT: 'chat:send:text',
  /** Renderer → main: send a file or image in chat */
  CHAT_SEND_FILE: 'chat:send:file',
  /** Main → renderer: a new message arrived or was sent */
  CHAT_MESSAGE: 'chat:message',
  /** Main → renderer: message delivery status updated */
  CHAT_MESSAGE_STATUS: 'chat:message:status',
  /** Main → renderer: session state changed (connected/disconnected) */
  CHAT_SESSION_UPDATED: 'chat:session:updated',
  /** Main → renderer: a peer wants to start a chat (receiver side) */
  CHAT_INVITE: 'chat:invite',
  /** Renderer → main: accept a chat invite */
  CHAT_INVITE_ACCEPT: 'chat:invite:accept',
  /** Renderer → main: decline a chat invite */
  CHAT_INVITE_DECLINE: 'chat:invite:decline',
  /** Renderer → main: get all sessions */
  CHAT_SESSIONS_GET: 'chat:sessions:get',
  /** Renderer → main: mark messages as read */
  CHAT_MARK_READ: 'chat:mark:read',
  /** Main → renderer: sender's outgoing request is pending (waiting for receiver) */
  CHAT_REQUEST_PENDING: 'chat:request:pending',
  /** Main → renderer: sender's outgoing request was resolved (accepted/declined/cancelled) */
  CHAT_REQUEST_RESOLVED: 'chat:request:resolved',
  /** Renderer → main: sender cancels their outgoing request */
  CHAT_REQUEST_CANCEL: 'chat:request:cancel',
} as const;

export type ChatIpcChannel = (typeof ChatIpcChannels)[keyof typeof ChatIpcChannels];

// ─── Payload Types ────────────────────────────────────────────────────────────

/** Renderer → main: open a chat session with a peer */
export interface ChatSessionOpenPayload {
  deviceId: string;
}

/** Renderer → main: close a chat session */
export interface ChatSessionClosePayload {
  sessionId: string;
}

/** Renderer → main: send a text message */
export interface ChatSendTextPayload {
  sessionId: string;
  text: string;
}

/** Renderer → main: send a file or image */
export interface ChatSendFilePayload {
  sessionId: string;
  filePath: string;
  fileName: string;
  fileSize: number;
}

/** Main → renderer: a message was sent or received */
export interface ChatMessagePayload {
  sessionId: string;
  message: ChatMessage;
}

/** Main → renderer: message status updated */
export interface ChatMessageStatusPayload {
  sessionId: string;
  messageId: string;
  status: ChatMessage['status'];
}

/** Main → renderer: session state changed */
export interface ChatSessionUpdatedPayload {
  session: ChatSession;
}

/** Main → renderer: a peer wants to chat */
export interface ChatInvitePayload {
  sessionId: string;
  peerId: string;
  peerName: string;
}

/** Renderer → main: accept a chat invite */
export interface ChatInviteAcceptPayload {
  sessionId: string;
}

/** Renderer → main: decline a chat invite */
export interface ChatInviteDeclinePayload {
  sessionId: string;
}

/** Renderer → main: mark messages as read */
export interface ChatMarkReadPayload {
  sessionId: string;
}

/** Main → renderer: all sessions (response to CHAT_SESSIONS_GET) */
export type ChatSessionsGetResponse = ChatSession[];

/** Main → renderer: sender's outgoing request is pending */
export interface ChatRequestPendingPayload {
  sessionId: string;
  peerName: string;
  peerId: string;
}

/** Main → renderer: sender's outgoing request was resolved */
export interface ChatRequestResolvedPayload {
  sessionId: string;
  /** 'accepted' | 'declined' | 'cancelled' | 'timeout' */
  outcome: 'accepted' | 'declined' | 'cancelled' | 'timeout';
}

/** Renderer → main: sender cancels their outgoing request */
export interface ChatRequestCancelPayload {
  sessionId: string;
}
