/**
 * ChatClient.ts
 * Initiates outgoing chat connections to peers.
 * Connects to the peer's TransferServer port and sends a chat_handshake header.
 */

import { connect, Socket } from 'net';
import { EventEmitter } from 'events';
import type { ChatHandshakeWireMessage } from '../../shared/models/ChatMessage';
import { Logger } from '../logging/Logger';

const CONNECT_TIMEOUT_MS = 10_000;

export interface ChatClientEvents {
  connected: (sessionId: string, socket: Socket) => void;
  declined: (sessionId: string) => void;
  error: (sessionId: string, err: Error) => void;
}

export declare interface ChatClient {
  on<K extends keyof ChatClientEvents>(event: K, listener: ChatClientEvents[K]): this;
  emit<K extends keyof ChatClientEvents>(event: K, ...args: Parameters<ChatClientEvents[K]>): boolean;
}

export class ChatClient extends EventEmitter {
  private logger: Logger | null = null;

  constructor() {
    super();
    try { this.logger = Logger.getInstance(); } catch { /* not yet initialised */ }
  }

  /**
   * Connect to a peer and initiate a chat session.
   * Emits 'connected' with the socket on success, 'declined' if peer refuses,
   * or 'error' on network failure.
   */
  connect(options: {
    sessionId: string;
    peerIp: string;
    peerPort: number;
    senderDeviceId: string;
    senderName: string;
  }): void {
    const { sessionId, peerIp, peerPort, senderDeviceId, senderName } = options;

    const socket = connect({ host: peerIp, port: peerPort });
    socket.setNoDelay(true);
    socket.setTimeout(CONNECT_TIMEOUT_MS);

    socket.once('timeout', () => {
      socket.destroy(new Error('Connection timed out'));
    });

    socket.once('error', (err) => {
      this.logger?.warn('ChatClient: connection error', { sessionId, err: err.message });
      this.emit('error', sessionId, err);
    });

    socket.once('connect', () => {
      socket.setTimeout(0); // clear timeout after connect

      // Send handshake
      const handshake: ChatHandshakeWireMessage = {
        type: 'chat_handshake',
        senderDeviceId,
        senderName,
      };
      socket.write(JSON.stringify(handshake) + '\n');

      // Wait for accept/decline response
      let responseBuffer = '';

      const onData = (chunk: Buffer): void => {
        responseBuffer += chunk.toString('utf8');
        const newlineIdx = responseBuffer.indexOf('\n');
        if (newlineIdx === -1) return;

        socket.removeListener('data', onData);
        socket.pause();

        const line = responseBuffer.slice(0, newlineIdx);
        const remaining = Buffer.from(responseBuffer.slice(newlineIdx + 1), 'utf8');

        try {
          const response = JSON.parse(line) as { accepted: boolean };
          if (response.accepted) {
            this.emit('connected', sessionId, socket);
            // Pass remaining bytes back via a synthetic data event after resume
            if (remaining.length > 0) {
              socket.unshift(remaining);
            }
          } else {
            socket.destroy();
            this.emit('declined', sessionId);
          }
        } catch (err) {
          socket.destroy(err instanceof Error ? err : new Error(String(err)));
          this.emit('error', sessionId, new Error('Invalid handshake response'));
        }
      };

      socket.on('data', onData);
    });
  }
}
