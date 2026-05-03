/**
 * StateManager.ts — Android version.
 * Feature 3: selectedDeviceId → selectedDeviceIds (multi-device support).
 */

import type { Device } from '../../shared/models/Device';
import type { AppSettings } from '../../shared/models/AppSettings';
import type { Transfer, TransferRecord } from '../../shared/models/Transfer';
import type { IncomingRequestEvent, TransferQueueUpdatedEvent } from '../../bridge/WyrePlugin';
import type { ChatSession } from '../../shared/models/ChatMessage';

export interface AppState {
  devices: Device[];
  activeTransfers: Map<string, Transfer>;
  transferHistory: TransferRecord[];
  settings: AppSettings | null;
  currentRoute: string;
  /** Feature 3: multi-device selection */
  selectedDeviceIds: string[];
  pendingIncomingQueue: IncomingRequestEvent[];
  sendQueue: TransferQueueUpdatedEvent['queue'];
  isLoading: boolean;
  /** Chat sessions keyed by sessionId */
  chatSessions: Map<string, ChatSession>;
  /** Active chat session being viewed */
  activeChatSessionId: string | null;
  /** Pending chat invites */
  pendingChatInvites: Array<{ sessionId: string; peerId: string; peerName: string }>;
}

type StateListener<K extends keyof AppState> = (value: AppState[K], prev: AppState[K]) => void;
type AnyListener = (state: AppState, prev: AppState) => void;

const initialState: AppState = {
  devices: [],
  activeTransfers: new Map(),
  transferHistory: [],
  settings: null,
  currentRoute: '/home',
  selectedDeviceIds: [],
  pendingIncomingQueue: [],
  sendQueue: [],
  isLoading: false,
  chatSessions: new Map(),
  activeChatSessionId: null,
  pendingChatInvites: [],
};

class StateManagerClass {
  private state: AppState = { ...initialState };
  private listeners: Map<keyof AppState, Set<StateListener<keyof AppState>>> = new Map();
  private globalListeners: Set<AnyListener> = new Set();

  getState(): Readonly<AppState> { return this.state; }

  get<K extends keyof AppState>(key: K): AppState[K] { return this.state[key]; }

  setState<K extends keyof AppState>(key: K, value: AppState[K]): void {
    const prev = this.state[key];
    if (prev === value) return;
    const prevState = { ...this.state };
    this.state = { ...this.state, [key]: value };
    const sliceListeners = this.listeners.get(key);
    if (sliceListeners) {
      for (const listener of sliceListeners) {
        (listener as StateListener<K>)(value, prev);
      }
    }
    for (const listener of this.globalListeners) {
      listener(this.state, prevState);
    }
  }

  subscribe<K extends keyof AppState>(key: K, listener: StateListener<K>): () => void {
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key)!.add(listener as StateListener<keyof AppState>);
    return () => this.listeners.get(key)?.delete(listener as StateListener<keyof AppState>);
  }

  subscribeAll(listener: AnyListener): () => void {
    this.globalListeners.add(listener);
    return () => this.globalListeners.delete(listener);
  }

  updateTransfer(transfer: Transfer): void {
    const transfers = new Map(this.state.activeTransfers);
    transfers.set(transfer.id, transfer);
    this.setState('activeTransfers', transfers);
  }

  removeTransfer(transferId: string): void {
    const transfers = new Map(this.state.activeTransfers);
    transfers.delete(transferId);
    this.setState('activeTransfers', transfers);
  }

  updateChatSession(session: import('../../shared/models/ChatMessage').ChatSession): void {
    const sessions = new Map(this.state.chatSessions);
    sessions.set(session.id, session);
    this.setState('chatSessions', sessions);
  }

  removeChatSession(sessionId: string): void {
    const sessions = new Map(this.state.chatSessions);
    sessions.delete(sessionId);
    this.setState('chatSessions', sessions);
  }
}

export const StateManager = new StateManagerClass();
