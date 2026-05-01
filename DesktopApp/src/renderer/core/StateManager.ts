/**
 * StateManager.ts
 * Observable typed state store — ~80 lines.
 * Components subscribe to slices of state and receive updates.
 * No third-party library — implemented from scratch.
 */

import type { Device } from '../../shared/models/Device';
import type { AppSettings } from '../../shared/models/AppSettings';
import type { Transfer, TransferRecord } from '../../shared/models/Transfer';
import type { IncomingRequestPayload, TransferQueueUpdatedPayload } from '../../shared/ipc/IpcContracts';

export interface AppState {
  devices: Device[];
  activeTransfers: Map<string, Transfer>;
  transferHistory: TransferRecord[];
  settings: AppSettings | null;
  currentRoute: string;
  selectedDeviceId: string | null;
  /** Queue of pending incoming requests */
  pendingIncomingQueue: IncomingRequestPayload[];
  /** Pending outgoing sends waiting for the active transfer to finish */
  sendQueue: TransferQueueUpdatedPayload['queue'];
  isLoading: boolean;
}

type StateListener<K extends keyof AppState> = (value: AppState[K], prev: AppState[K]) => void;
type AnyListener = (state: AppState, prev: AppState) => void;

const initialState: AppState = {
  devices: [],
  activeTransfers: new Map(),
  transferHistory: [],
  settings: null,
  currentRoute: '/home',
  selectedDeviceId: null,
  pendingIncomingQueue: [],
  sendQueue: [],
  isLoading: false,
};

class StateManagerClass {
  private state: AppState = { ...initialState };
  private listeners: Map<keyof AppState, Set<StateListener<keyof AppState>>> = new Map();
  private globalListeners: Set<AnyListener> = new Set();

  getState(): Readonly<AppState> {
    return this.state;
  }

  get<K extends keyof AppState>(key: K): AppState[K] {
    return this.state[key];
  }

  setState<K extends keyof AppState>(key: K, value: AppState[K]): void {
    const prev = this.state[key];
    if (prev === value) return;

    const prevState = { ...this.state };
    this.state = { ...this.state, [key]: value };

    // Notify slice listeners
    const sliceListeners = this.listeners.get(key);
    if (sliceListeners) {
      for (const listener of sliceListeners) {
        (listener as StateListener<K>)(value, prev);
      }
    }

    // Notify global listeners
    for (const listener of this.globalListeners) {
      listener(this.state, prevState);
    }
  }

  /** Subscribe to a specific state slice */
  subscribe<K extends keyof AppState>(key: K, listener: StateListener<K>): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(listener as StateListener<keyof AppState>);
    return () => this.listeners.get(key)?.delete(listener as StateListener<keyof AppState>);
  }

  /** Subscribe to any state change */
  subscribeAll(listener: AnyListener): () => void {
    this.globalListeners.add(listener);
    return () => this.globalListeners.delete(listener);
  }

  /** Update a transfer in the activeTransfers map */
  updateTransfer(transfer: Transfer): void {
    const transfers = new Map(this.state.activeTransfers);
    transfers.set(transfer.id, transfer);
    this.setState('activeTransfers', transfers);
  }

  /** Remove a transfer from active map */
  removeTransfer(transferId: string): void {
    const transfers = new Map(this.state.activeTransfers);
    transfers.delete(transferId);
    this.setState('activeTransfers', transfers);
  }
}

// Export as singleton — one state tree for the renderer
export const StateManager = new StateManagerClass();
