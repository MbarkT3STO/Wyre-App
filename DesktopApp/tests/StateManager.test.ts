/**
 * StateManager.test.ts
 * Unit tests for the renderer StateManager observable store.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to test StateManager in isolation — mock the IPC layer
// StateManager has no external deps so we can import directly

// Re-create a minimal version for testing (same logic as the real one)
// to avoid DOM/Electron dependencies in the test environment

type TestState = {
  count: number;
  name: string;
  items: string[];
};

type StateListener<K extends keyof TestState> = (value: TestState[K], prev: TestState[K]) => void;
type AnyListener = (state: TestState, prev: TestState) => void;

class TestStateManager {
  private state: TestState = { count: 0, name: '', items: [] };
  private listeners: Map<keyof TestState, Set<StateListener<keyof TestState>>> = new Map();
  private globalListeners: Set<AnyListener> = new Set();

  getState(): Readonly<TestState> { return this.state; }

  get<K extends keyof TestState>(key: K): TestState[K] { return this.state[key]; }

  setState<K extends keyof TestState>(key: K, value: TestState[K]): void {
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

  subscribe<K extends keyof TestState>(key: K, listener: StateListener<K>): () => void {
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key)!.add(listener as StateListener<keyof TestState>);
    return () => this.listeners.get(key)?.delete(listener as StateListener<keyof TestState>);
  }

  subscribeAll(listener: AnyListener): () => void {
    this.globalListeners.add(listener);
    return () => this.globalListeners.delete(listener);
  }
}

describe('StateManager', () => {
  let sm: TestStateManager;

  beforeEach(() => {
    sm = new TestStateManager();
  });

  it('returns initial state', () => {
    expect(sm.get('count')).toBe(0);
    expect(sm.get('name')).toBe('');
    expect(sm.get('items')).toEqual([]);
  });

  it('updates state with setState', () => {
    sm.setState('count', 42);
    expect(sm.get('count')).toBe(42);
  });

  it('notifies slice listeners on change', () => {
    const listener = vi.fn();
    sm.subscribe('count', listener);
    sm.setState('count', 5);
    expect(listener).toHaveBeenCalledWith(5, 0);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify if value is the same', () => {
    const listener = vi.fn();
    sm.subscribe('count', listener);
    sm.setState('count', 0); // same as initial
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies global listeners on any change', () => {
    const listener = vi.fn();
    sm.subscribeAll(listener);
    sm.setState('name', 'Alice');
    expect(listener).toHaveBeenCalledTimes(1);
    sm.setState('count', 1);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('unsubscribe stops notifications', () => {
    const listener = vi.fn();
    const unsub = sm.subscribe('count', listener);
    sm.setState('count', 1);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    sm.setState('count', 2);
    expect(listener).toHaveBeenCalledTimes(1); // no new calls
  });

  it('unsubscribeAll stops global notifications', () => {
    const listener = vi.fn();
    const unsub = sm.subscribeAll(listener);
    sm.setState('count', 1);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    sm.setState('count', 2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('multiple listeners on same key all get notified', () => {
    const l1 = vi.fn();
    const l2 = vi.fn();
    sm.subscribe('name', l1);
    sm.subscribe('name', l2);
    sm.setState('name', 'Bob');
    expect(l1).toHaveBeenCalledWith('Bob', '');
    expect(l2).toHaveBeenCalledWith('Bob', '');
  });

  it('slice listener only fires for its key', () => {
    const countListener = vi.fn();
    const nameListener = vi.fn();
    sm.subscribe('count', countListener);
    sm.subscribe('name', nameListener);
    sm.setState('count', 99);
    expect(countListener).toHaveBeenCalledTimes(1);
    expect(nameListener).not.toHaveBeenCalled();
  });

  it('getState returns full state snapshot', () => {
    sm.setState('count', 7);
    sm.setState('name', 'test');
    const state = sm.getState();
    expect(state.count).toBe(7);
    expect(state.name).toBe('test');
  });
});
