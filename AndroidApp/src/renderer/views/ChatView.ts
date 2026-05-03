/**
 * ChatView.ts — Android version.
 * Full-featured chat view using AppBridge instead of IpcClient.
 * Adapted for mobile: single-panel with back navigation.
 */

import { Component } from '../components/base/Component';
import { StateManager } from '../core/StateManager';
import { AppBridge } from '../../bridge/AppBridge';
import type { ToastContainer } from '../components/ToastContainer';
import type { ChatSession, ChatMessage } from '../../shared/models/ChatMessage';
import { formatFileSize } from '../../shared/utils/formatters';

export class ChatView extends Component {
  private toasts: ToastContainer;
  private activeSessionId: string | null = null;
  private messageListEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private fileInput: HTMLInputElement | null = null;

  constructor(toasts: ToastContainer) {
    super();
    this.toasts = toasts;
  }

  render(): HTMLElement {
    const view = this.el('div', 'view chat-view chat-view--mobile');

    view.innerHTML = `
      <!-- Session list panel -->
      <div class="chat-view__mobile-panel chat-view__mobile-panel--sessions" id="chat-sessions-panel">
        <div class="chat-view__sidebar-header">
          <span class="chat-view__sidebar-title">Chats</span>
        </div>
        <div class="chat-view__session-list" id="chat-session-list" role="list">
          <div class="chat-view__sessions-empty" id="chat-sessions-empty">
            <i class="fa-regular fa-comment-dots chat-view__sessions-empty-icon"></i>
            <p>No active chats</p>
            <span>Tap a device on the Home screen and tap Chat</span>
          </div>
        </div>
      </div>

      <!-- Thread panel -->
      <div class="chat-view__mobile-panel chat-view__mobile-panel--thread" id="chat-thread-panel" style="display:none">
        <!-- Header -->
        <div class="chat-view__thread-header">
          <button class="btn btn--ghost btn--icon btn--sm" id="chat-back-btn" aria-label="Back to chats">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <div class="chat-view__thread-peer">
            <div class="chat-view__thread-avatar" id="chat-thread-avatar">?</div>
            <div class="chat-view__thread-peer-info">
              <span class="chat-view__thread-peer-name" id="chat-thread-peer-name">—</span>
              <span class="chat-view__thread-status" id="chat-thread-status">
                <span class="chat-view__status-dot chat-view__status-dot--offline"></span>
                Disconnected
              </span>
            </div>
          </div>
          <button class="btn btn--ghost btn--icon btn--sm" id="chat-close-btn" aria-label="Close chat">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <!-- Messages -->
        <div class="chat-view__messages" id="chat-messages" role="log" aria-live="polite"></div>

        <!-- Input -->
        <div class="chat-view__input-area">
          <button class="btn btn--ghost btn--icon btn--sm chat-view__attach-btn" id="chat-attach-btn" aria-label="Attach file">
            <i class="fa-solid fa-paperclip"></i>
          </button>
          <input type="file" id="chat-file-input" style="display:none" accept="*/*" aria-hidden="true" />
          <textarea
            class="chat-view__input"
            id="chat-input"
            placeholder="Type a message…"
            rows="1"
            aria-label="Message input"
            maxlength="10000"
          ></textarea>
          <button class="btn btn--primary btn--icon chat-view__send-btn" id="chat-send-btn" disabled aria-label="Send">
            <i class="fa-solid fa-paper-plane"></i>
          </button>
        </div>
      </div>
    `;

    return view;
  }

  protected onMount(): void {
    if (!this.element) return;

    this.messageListEl = this.element.querySelector('#chat-messages');
    this.inputEl = this.element.querySelector('#chat-input') as HTMLTextAreaElement;
    this.sendBtn = this.element.querySelector('#chat-send-btn') as HTMLButtonElement;
    this.fileInput = this.element.querySelector('#chat-file-input') as HTMLInputElement;

    void this.loadSessions();

    const unsubSessions = StateManager.subscribe('chatSessions', () => {
      this.renderSessionList();
      if (this.activeSessionId) this.renderThread(this.activeSessionId);
    });
    this.addCleanup(unsubSessions);

    const unsubActive = StateManager.subscribe('activeChatSessionId', (id) => {
      if (id) this.selectSession(id);
    });
    this.addCleanup(unsubActive);

    const pendingId = StateManager.get('activeChatSessionId');
    if (pendingId) this.selectSession(pendingId);

    this.inputEl?.addEventListener('input', () => this.handleInputChange());
    this.inputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void this.handleSend();
      }
    });

    this.sendBtn?.addEventListener('click', () => { void this.handleSend(); });
    this.element.querySelector('#chat-attach-btn')?.addEventListener('click', () => this.fileInput?.click());
    this.fileInput?.addEventListener('change', () => { void this.handleFileAttach(); });
    this.element.querySelector('#chat-back-btn')?.addEventListener('click', () => this.showSessionList());
    this.element.querySelector('#chat-close-btn')?.addEventListener('click', () => { void this.handleCloseSession(); });
  }

  private async loadSessions(): Promise<void> {
    try {
      const sessions = await AppBridge.chatGetSessions();
      for (const session of sessions) StateManager.updateChatSession(session);
      this.renderSessionList();
    } catch { /* non-fatal */ }
  }

  private renderSessionList(): void {
    const listEl = this.element?.querySelector('#chat-session-list');
    if (!listEl) return;

    const sessions = Array.from(StateManager.get('chatSessions').values())
      .sort((a, b) => b.lastActivity - a.lastActivity);

    const emptyEl = this.element?.querySelector('#chat-sessions-empty') as HTMLElement | null;

    if (sessions.length === 0) {
      if (emptyEl) emptyEl.style.display = 'flex';
      listEl.querySelectorAll('.chat-session-item').forEach(el => el.remove());
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    const currentIds = new Set(sessions.map(s => s.id));
    listEl.querySelectorAll('.chat-session-item').forEach(el => {
      if (!currentIds.has((el as HTMLElement).dataset['sessionId'] ?? '')) el.remove();
    });

    for (const session of sessions) {
      const existing = listEl.querySelector(`[data-session-id="${session.id}"]`) as HTMLElement | null;
      if (existing) {
        this.updateSessionItem(existing, session);
      } else {
        const item = this.createSessionItem(session);
        listEl.appendChild(item);
      }
    }
  }

  private createSessionItem(session: ChatSession): HTMLElement {
    const item = document.createElement('div');
    item.className = `chat-session-item${session.id === this.activeSessionId ? ' chat-session-item--active' : ''}`;
    item.setAttribute('role', 'listitem');
    item.dataset['sessionId'] = session.id;
    this.updateSessionItem(item, session);
    item.addEventListener('click', () => this.selectSession(session.id));
    return item;
  }

  private updateSessionItem(el: HTMLElement, session: ChatSession): void {
    const lastMsg = session.messages[session.messages.length - 1];
    const preview = lastMsg
      ? (lastMsg.type === 'text' ? (lastMsg.text ?? '') : `📎 ${lastMsg.fileName ?? 'File'}`)
      : 'No messages yet';
    const initial = session.peerName.charAt(0).toUpperCase();
    el.className = `chat-session-item${session.id === this.activeSessionId ? ' chat-session-item--active' : ''}`;
    el.innerHTML = `
      <div class="chat-session-item__avatar">${escapeHtml(initial)}</div>
      <div class="chat-session-item__info">
        <div class="chat-session-item__name-row">
          <span class="chat-session-item__name">${escapeHtml(session.peerName)}</span>
          <span class="chat-session-item__status-dot ${session.connected ? 'chat-session-item__status-dot--online' : 'chat-session-item__status-dot--offline'}"></span>
        </div>
        <span class="chat-session-item__preview">${escapeHtml(preview.slice(0, 60))}</span>
      </div>
      ${session.unreadCount > 0 ? `<span class="chat-session-item__badge">${session.unreadCount > 99 ? '99+' : session.unreadCount}</span>` : ''}
    `;
  }

  private selectSession(sessionId: string): void {
    this.activeSessionId = sessionId;
    StateManager.setState('activeChatSessionId', sessionId);
    this.renderThread(sessionId);
    this.showThread();
    void AppBridge.chatMarkRead({ sessionId });
    const sessions = StateManager.get('chatSessions');
    const session = sessions.get(sessionId);
    if (session && session.unreadCount > 0) {
      StateManager.updateChatSession({ ...session, unreadCount: 0 });
    }
    setTimeout(() => this.inputEl?.focus(), 50);
  }

  private renderThread(sessionId: string): void {
    const session = StateManager.get('chatSessions').get(sessionId);
    if (!session) return;

    const avatarEl = this.element?.querySelector('#chat-thread-avatar');
    const nameEl = this.element?.querySelector('#chat-thread-peer-name');
    const statusEl = this.element?.querySelector('#chat-thread-status');

    if (avatarEl) avatarEl.textContent = session.peerName.charAt(0).toUpperCase();
    if (nameEl) nameEl.textContent = session.peerName;
    if (statusEl) {
      statusEl.innerHTML = session.connected
        ? `<span class="chat-view__status-dot chat-view__status-dot--online"></span> Connected`
        : `<span class="chat-view__status-dot chat-view__status-dot--offline"></span> Disconnected`;
    }

    if (!this.messageListEl) return;
    this.messageListEl.innerHTML = '';

    if (session.messages.length === 0) {
      this.messageListEl.innerHTML = `
        <div class="chat-view__messages-empty">
          <i class="fa-regular fa-comment chat-view__messages-empty-icon"></i>
          <p>Say hello to ${escapeHtml(session.peerName)}!</p>
        </div>
      `;
    } else {
      let lastDate = '';
      for (const msg of session.messages) {
        const msgDate = new Date(msg.timestamp).toLocaleDateString();
        if (msgDate !== lastDate) {
          const divider = document.createElement('div');
          divider.className = 'chat-view__date-divider';
          divider.textContent = msgDate;
          this.messageListEl.appendChild(divider);
          lastDate = msgDate;
        }
        this.messageListEl.appendChild(this.createMessageBubble(msg));
      }
    }

    this.messageListEl.scrollTop = this.messageListEl.scrollHeight;
    this.updateSendButton(session.connected);
  }

  private createMessageBubble(msg: ChatMessage): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = `chat-message ${msg.isOwn ? 'chat-message--own' : 'chat-message--peer'}`;
    wrapper.dataset['messageId'] = msg.id;

    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const statusIcon = msg.isOwn ? this.getStatusIcon(msg.status) : '';

    let contentHtml = '';

    if (msg.type === 'text') {
      contentHtml = `<p class="chat-message__text">${escapeHtml(msg.text ?? '').replace(/\n/g, '<br>')}</p>`;
    } else if (msg.type === 'image' && msg.thumbnail) {
      const ext = (msg.fileName ?? '').split('.').pop()?.toLowerCase() ?? 'png';
      const mimeMap: Record<string, string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
      };
      const mime = mimeMap[ext] ?? 'image/png';
      contentHtml = `
        <div class="chat-message__image-wrap">
          <img class="chat-message__image" src="data:${mime};base64,${msg.thumbnail}" alt="${escapeHtml(msg.fileName ?? 'Image')}" loading="lazy" />
          ${msg.fileName ? `<span class="chat-message__image-name">${escapeHtml(msg.fileName)}</span>` : ''}
        </div>
      `;
    } else if (msg.type === 'file') {
      const sizeStr = msg.fileSize ? formatFileSize(msg.fileSize) : '';
      contentHtml = `
        <div class="chat-message__file">
          <i class="fa-solid fa-file chat-message__file-icon"></i>
          <div class="chat-message__file-info">
            <span class="chat-message__file-name">${escapeHtml(msg.fileName ?? 'File')}</span>
            ${sizeStr ? `<span class="chat-message__file-size">${sizeStr}</span>` : ''}
          </div>
          ${msg.filePath ? `
            <button class="btn btn--ghost btn--icon btn--sm chat-message__file-open" data-path="${escapeHtml(msg.filePath)}" aria-label="Open file">
              <i class="fa-solid fa-arrow-up-right-from-square"></i>
            </button>
          ` : ''}
        </div>
      `;
    }

    wrapper.innerHTML = `
      <div class="chat-message__bubble">
        ${contentHtml}
        <div class="chat-message__meta">
          <span class="chat-message__time">${time}</span>
          ${statusIcon}
        </div>
      </div>
    `;

    const openBtn = wrapper.querySelector('.chat-message__file-open') as HTMLButtonElement | null;
    if (openBtn) {
      openBtn.addEventListener('click', () => {
        const path = openBtn.dataset['path'];
        if (path) void AppBridge.openFile(path);
      });
    }

    return wrapper;
  }

  private getStatusIcon(status: ChatMessage['status']): string {
    switch (status) {
      case 'sending':   return `<i class="fa-solid fa-clock chat-message__status-icon chat-message__status-icon--sending"></i>`;
      case 'sent':      return `<i class="fa-solid fa-check chat-message__status-icon chat-message__status-icon--sent"></i>`;
      case 'delivered': return `<i class="fa-solid fa-check-double chat-message__status-icon chat-message__status-icon--delivered"></i>`;
      case 'failed':    return `<i class="fa-solid fa-triangle-exclamation chat-message__status-icon chat-message__status-icon--failed"></i>`;
      default:          return '';
    }
  }

  private showThread(): void {
    const sessionsPanel = this.element?.querySelector('#chat-sessions-panel') as HTMLElement | null;
    const threadPanel = this.element?.querySelector('#chat-thread-panel') as HTMLElement | null;
    if (sessionsPanel) sessionsPanel.style.display = 'none';
    if (threadPanel) threadPanel.style.display = 'flex';
  }

  private showSessionList(): void {
    const sessionsPanel = this.element?.querySelector('#chat-sessions-panel') as HTMLElement | null;
    const threadPanel = this.element?.querySelector('#chat-thread-panel') as HTMLElement | null;
    if (sessionsPanel) sessionsPanel.style.display = 'flex';
    if (threadPanel) threadPanel.style.display = 'none';
  }

  private handleInputChange(): void {
    if (!this.inputEl) return;
    this.inputEl.style.height = 'auto';
    this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight, 120)}px`;
    this.updateSendButton(this.isSessionConnected());
  }

  private isSessionConnected(): boolean {
    if (!this.activeSessionId) return false;
    return StateManager.get('chatSessions').get(this.activeSessionId)?.connected ?? false;
  }

  private updateSendButton(connected: boolean): void {
    if (!this.sendBtn || !this.inputEl) return;
    this.sendBtn.disabled = !connected || !this.inputEl.value.trim();
  }

  private async handleSend(): Promise<void> {
    if (!this.inputEl || !this.activeSessionId) return;
    const text = this.inputEl.value.trim();
    if (!text) return;

    const sessionId = this.activeSessionId;
    this.inputEl.value = '';
    this.inputEl.style.height = 'auto';
    this.updateSendButton(false);

    try {
      await AppBridge.chatSendText({ sessionId, text });
    } catch (err) {
      this.toasts.error(err instanceof Error ? err.message : 'Failed to send');
    }

    this.updateSendButton(this.isSessionConnected());
    this.inputEl.focus();
  }

  private async handleFileAttach(): Promise<void> {
    if (!this.fileInput || !this.activeSessionId) return;
    const file = this.fileInput.files?.[0];
    if (!file) return;
    this.fileInput.value = '';

    const sessionId = this.activeSessionId;
    const filePath = (file as File & { path?: string }).path;
    if (!filePath) {
      this.toasts.error('Cannot read file path.');
      return;
    }

    if (file.size > 4 * 1024 * 1024) {
      this.toasts.warning('File too large for chat (max 4 MB).');
      return;
    }

    try {
      await AppBridge.chatSendFile({ sessionId, filePath, fileName: file.name, fileSize: file.size });
    } catch (err) {
      this.toasts.error(err instanceof Error ? err.message : 'Failed to send file');
    }
  }

  private async handleCloseSession(): Promise<void> {
    if (!this.activeSessionId) return;
    const sessionId = this.activeSessionId;
    try { await AppBridge.chatCloseSession({ sessionId }); } catch { /* non-fatal */ }
    StateManager.removeChatSession(sessionId);
    this.activeSessionId = null;
    StateManager.setState('activeChatSessionId', null);
    this.showSessionList();
    this.renderSessionList();
  }

  protected onUnmount(): void { /* cleanup handled by addCleanup */ }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
