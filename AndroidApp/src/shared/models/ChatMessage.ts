/**
 * ChatMessage.ts
 * Chat message model and session types.
 */

export type ChatMessageType = 'text' | 'image' | 'file';
export type ChatMessageStatus = 'sending' | 'sent' | 'delivered' | 'failed';

export interface ChatMessage {
  /** Unique message ID (UUID) */
  id: string;
  /** ID of the chat session this message belongs to */
  sessionId: string;
  /** Device ID of the sender */
  senderId: string;
  /** Display name of the sender */
  senderName: string;
  /** Whether this message was sent by the local device */
  isOwn: boolean;
  /** Message type */
  type: ChatMessageType;
  /** Text content (for type='text') */
  text?: string;
  /** File name (for type='file' or 'image') */
  fileName?: string;
  /** File size in bytes (for type='file' or 'image') */
  fileSize?: number;
  /** Local file path (for type='file' or 'image') — only set after save */
  filePath?: string;
  /** Base64-encoded thumbnail (for type='image', small preview) */
  thumbnail?: string;
  /** Unix timestamp (ms) */
  timestamp: number;
  /** Delivery status */
  status: ChatMessageStatus;
}

export interface ChatSession {
  /** Unique session ID — derived from sorted pair of device IDs */
  id: string;
  /** Remote device ID */
  peerId: string;
  /** Remote device display name */
  peerName: string;
  /** Whether the session is currently connected */
  connected: boolean;
  /** All messages in this session */
  messages: ChatMessage[];
  /** Unix timestamp of last activity */
  lastActivity: number;
  /** Number of unread messages */
  unreadCount: number;
}

/** Payload sent over the wire for a chat message */
export interface ChatWireMessage {
  /** Protocol discriminator — always 'chat' */
  type: 'chat';
  /** Message ID */
  id: string;
  /** Sender device ID */
  senderDeviceId: string;
  /** Sender display name */
  senderName: string;
  /** Message type */
  msgType: ChatMessageType;
  /** Text content */
  text?: string;
  /** File name */
  fileName?: string;
  /** File size */
  fileSize?: number;
  /** Base64-encoded image thumbnail (≤ 32 KB) */
  thumbnail?: string;
  /** Unix timestamp */
  timestamp: number;
}

/** Sent over the wire to acknowledge a message */
export interface ChatAckWireMessage {
  type: 'chat_ack';
  id: string;
}

/** Sent over the wire to initiate a chat session */
export interface ChatHandshakeWireMessage {
  type: 'chat_handshake';
  senderDeviceId: string;
  senderName: string;
}

/** Sent over the wire to close a chat session */
export interface ChatCloseWireMessage {
  type: 'chat_close';
  senderDeviceId: string;
}
