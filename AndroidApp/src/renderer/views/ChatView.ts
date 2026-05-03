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
  private attachBtn: HTMLButtonElement | null = null;
  private fileInput: HTMLInputElement | null = null;
  private inputAreaEl: HTMLElement | null = null;
  /** Track how many messages have been rendered to do incremental appends */
  private renderedMsgCount = 0;
  private renderedSessionId: string | null = null;

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
    this.attachBtn = this.element.querySelector('#chat-attach-btn') as HTMLButtonElement;
    this.fileInput = this.element.querySelector('#chat-file-input') as HTMLInputElement;
    this.inputAreaEl = this.element.querySelector('.chat-view__input-area') as HTMLElement;

    void this.loadSessions();

    const unsubSessions = StateManager.subscribe('chatSessions', () => {
      this.renderSessionList();
      if (this.activeSessionId) this.appendNewMessages(this.activeSessionId);
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

    // ── Keyboard avoidance (Android soft keyboard) ──────────────────────────
    // When the virtual keyboard appears, visualViewport shrinks. We push the
    // thread panel up so the input area stays above the keyboard.
    if (window.visualViewport) {
      const onViewportResize = (): void => {
        const threadPanel = this.element?.querySelector('#chat-thread-panel') as HTMLElement | null;
        if (!threadPanel || threadPanel.style.display === 'none') return;
        const offsetFromBottom = window.innerHeight - (window.visualViewport?.height ?? window.innerHeight)
          - (window.visualViewport?.offsetTop ?? 0);
        threadPanel.style.paddingBottom = offsetFromBottom > 0 ? `${offsetFromBottom}px` : '';
        // Scroll to bottom so latest message stays visible
        if (this.messageListEl) {
          this.messageListEl.scrollTop = this.messageListEl.scrollHeight;
        }
      };
      window.visualViewport.addEventListener('resize', onViewportResize);
      window.visualViewport.addEventListener('scroll', onViewportResize);
      this.addCleanup(() => {
        window.visualViewport?.removeEventListener('resize', onViewportResize);
        window.visualViewport?.removeEventListener('scroll', onViewportResize);
      });
    }  }

  private async loadSessions(): Promise<void> {
    try {
      const sessions = await AppBridge.chatGetSessions();
      // Batch-update state; the chatSessions subscriber will call renderSessionList()
      for (const session of sessions) StateManager.updateChatSession(session);
      // Only render directly if there are no sessions (subscriber won't fire on empty map)
      if (sessions.length === 0) this.renderSessionList();
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
    this.renderedMsgCount = 0;
    this.renderedSessionId = sessionId;
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
    this.renderedMsgCount = 0;
    this.renderedSessionId = sessionId;

    if (session.messages.length === 0) {
      this.messageListEl.innerHTML = `
        <div class="chat-view__messages-empty" id="chat-messages-empty">
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
        this.renderedMsgCount++;
      }
    }

    this.messageListEl.scrollTop = this.messageListEl.scrollHeight;
    this.setInputDisabled(!session.connected);
  }

  /** Incremental append — only adds messages not yet in the DOM */
  private appendNewMessages(sessionId: string): void {
    if (!this.messageListEl || sessionId !== this.renderedSessionId) return;
    const session = StateManager.get('chatSessions').get(sessionId);
    if (!session) return;

    // Update header status
    const statusEl = this.element?.querySelector('#chat-thread-status');
    if (statusEl) {
      statusEl.innerHTML = session.connected
        ? `<span class="chat-view__status-dot chat-view__status-dot--online"></span> Connected`
        : `<span class="chat-view__status-dot chat-view__status-dot--offline"></span> Disconnected`;
    }
    this.setInputDisabled(!session.connected);

    if (session.messages.length <= this.renderedMsgCount) {
      // No new messages — patch statuses on existing bubbles
      this.patchMessageStatuses(session);
      return;
    }

    // Remove empty state if present
    this.messageListEl.querySelector('#chat-messages-empty')?.remove();

    const wasAtBottom = this.isScrolledToBottom();
    const newMsgs = session.messages.slice(this.renderedMsgCount);

    for (const msg of newMsgs) {
      this.messageListEl.appendChild(this.createMessageBubble(msg));
      this.renderedMsgCount++;
    }

    if (wasAtBottom) {
      this.messageListEl.scrollTop = this.messageListEl.scrollHeight;
    }
  }

  private patchMessageStatuses(session: ChatSession): void {
    if (!this.messageListEl) return;
    for (const msg of session.messages) {
      const el = this.messageListEl.querySelector(`[data-message-id="${msg.id}"]`) as HTMLElement | null;
      if (!el) continue;
      if (msg.deleted && !el.querySelector('.chat-message__bubble--deleted')) {
        el.replaceWith(this.createMessageBubble(msg));
        continue;
      }
      if (msg.isOwn) {
        const statusEl = el.querySelector('.chat-message__status-icon');
        if (statusEl) {
          const newIcon = this.getStatusIcon(msg.status);
          if (newIcon) statusEl.outerHTML = newIcon;
        }
        if (msg.editedAt) {
          const textEl = el.querySelector('.chat-message__text');
          if (textEl && msg.text) textEl.innerHTML = escapeHtml(msg.text).replace(/\n/g, '<br>');
          const meta = el.querySelector('.chat-message__meta');
          if (meta && !meta.querySelector('.chat-message__edited')) {
            const badge = document.createElement('span');
            badge.className = 'chat-message__edited';
            badge.textContent = 'edited';
            meta.prepend(badge);
          }
        }
      }
    }
  }

  private isScrolledToBottom(): boolean {
    if (!this.messageListEl) return true;
    const { scrollTop, scrollHeight, clientHeight } = this.messageListEl;
    return scrollHeight - scrollTop - clientHeight < 80;
  }

  private createMessageBubble(msg: ChatMessage): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = `chat-message ${msg.isOwn ? 'chat-message--own' : 'chat-message--peer'}`;
    wrapper.dataset['messageId'] = msg.id;

    // Deleted tombstone
    if (msg.deleted) {
      wrapper.innerHTML = `
        <div class="chat-message__bubble chat-message__bubble--deleted">
          <p class="chat-message__deleted-text">
            <i class="fa-solid fa-ban" aria-hidden="true"></i>
            Message deleted
          </p>
        </div>
      `;
      return wrapper;
    }

    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const statusIcon = msg.isOwn ? this.getStatusIcon(msg.status) : '';
    const editedBadge = msg.editedAt
      ? `<span class="chat-message__edited" title="Edited">edited</span>`
      : '';

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
          <img class="chat-message__image" src="data:${mime};base64,${msg.thumbnail}"
               alt="${escapeHtml(msg.fileName ?? 'Image')}" loading="lazy" />
          ${msg.fileName ? `<span class="chat-message__image-name">${escapeHtml(msg.fileName)}</span>` : ''}
        </div>
      `;
    } else if (msg.type === 'file' || (msg.type === 'image' && !msg.thumbnail)) {
      const sizeStr = msg.fileSize ? formatFileSize(msg.fileSize) : '';
      contentHtml = `
        <div class="chat-message__file">
          <i class="fa-solid fa-file chat-message__file-icon"></i>
          <div class="chat-message__file-info">
            <span class="chat-message__file-name">${escapeHtml(msg.fileName ?? 'File')}</span>
            ${sizeStr ? `<span class="chat-message__file-size">${sizeStr}</span>` : ''}
          </div>
          <button class="btn btn--ghost btn--icon btn--sm chat-message__file-open" aria-label="Open file">
            <i class="fa-solid fa-arrow-up-right-from-square"></i>
          </button>
        </div>
      `;
    }

    wrapper.innerHTML = `
      <div class="chat-message__bubble">
        ${contentHtml}
        <div class="chat-message__meta">
          ${editedBadge}
          <span class="chat-message__time">${time}</span>
          ${statusIcon}
        </div>
      </div>
    `;

    const openBtn = wrapper.querySelector('.chat-message__file-open') as HTMLButtonElement | null;
    if (openBtn) {
      openBtn.addEventListener('click', () => {
        if (msg.filePath) {
          void AppBridge.openFile(msg.filePath);
        } else if (msg.thumbnail && msg.fileName) {
          void this.openBase64File(msg.fileName, msg.thumbnail);
        }
      });
    }

    // Tap image to open full-size
    const img = wrapper.querySelector('.chat-message__image') as HTMLImageElement | null;
    if (img) {
      img.style.cursor = 'pointer';
      img.addEventListener('click', () => {
        if (msg.filePath) {
          void AppBridge.openFile(msg.filePath);
        } else if (msg.thumbnail && msg.fileName) {
          void this.openBase64File(msg.fileName, msg.thumbnail);
        }
      });
    }

    // ── Long-press context menu (touch) ──────────────────────────────────────
    const canCopy   = msg.type === 'text' && !!msg.text;
    const canEdit   = msg.isOwn && msg.type === 'text';
    const canDelete = msg.isOwn;

    if (canCopy || canEdit || canDelete) {
      this.wireLongPress(wrapper, msg, canCopy, canEdit, canDelete);
    }

    return wrapper;
  }

  // ── Long-press context menu ────────────────────────────────────────────────

  private wireLongPress(
    wrapper: HTMLElement,
    msg: ChatMessage,
    canCopy: boolean,
    canEdit: boolean,
    canDelete: boolean,
  ): void {
    let pressTimer: ReturnType<typeof setTimeout> | null = null;

    const openMenu = (x: number, y: number): void => {
      this.closeContextMenu();

      const menu = document.createElement('div');
      menu.className = 'chat-context-menu';
      menu.setAttribute('role', 'menu');

      const items: Array<{ icon: string; label: string; action: string; danger?: boolean }> = [];
      if (canCopy)   items.push({ icon: 'fa-regular fa-copy',  label: 'Copy',   action: 'copy' });
      if (canEdit)   items.push({ icon: 'fa-solid fa-pen',     label: 'Edit',   action: 'edit' });
      if (canDelete) items.push({ icon: 'fa-solid fa-trash',   label: 'Delete', action: 'delete', danger: true });

      menu.innerHTML = items.map(item => `
        <button class="chat-context-menu__item${item.danger ? ' chat-context-menu__item--danger' : ''}"
                data-action="${item.action}" role="menuitem">
          <i class="${item.icon}" aria-hidden="true"></i>
          <span>${item.label}</span>
        </button>
      `).join('');

      // Position near the touch point, keep inside viewport
      document.body.appendChild(menu);
      const menuW = 160;
      const menuH = items.length * 44;
      const left = Math.min(x, window.innerWidth - menuW - 8);
      const top  = Math.min(y, window.innerHeight - menuH - 8);
      menu.style.left = `${Math.max(8, left)}px`;
      menu.style.top  = `${Math.max(8, top)}px`;

      menu.querySelectorAll('.chat-context-menu__item').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = (btn as HTMLElement).dataset['action'];
          this.closeContextMenu();
          if (action === 'copy')   this.handleCopyMessage(msg);
          else if (action === 'edit')   this.handleEditMessage(msg, wrapper);
          else if (action === 'delete') void this.handleDeleteMessage(msg, wrapper);
        });
      });

      // Close on outside tap
      const dismiss = (e: Event): void => {
        if (!menu.contains(e.target as Node)) {
          this.closeContextMenu();
          document.removeEventListener('touchstart', dismiss, true);
          document.removeEventListener('mousedown', dismiss, true);
        }
      };
      setTimeout(() => {
        document.addEventListener('touchstart', dismiss, true);
        document.addEventListener('mousedown', dismiss, true);
      }, 0);

      this._contextMenu = menu;
    };

    wrapper.addEventListener('touchstart', (e) => {
      const touch = e.touches[0]!;
      pressTimer = setTimeout(() => {
        openMenu(touch.clientX, touch.clientY);
      }, 500);
    }, { passive: true });

    wrapper.addEventListener('touchend',   () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
    wrapper.addEventListener('touchmove',  () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
    wrapper.addEventListener('touchcancel',() => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
  }

  private _contextMenu: HTMLElement | null = null;

  private closeContextMenu(): void {
    this._contextMenu?.remove();
    this._contextMenu = null;
  }

  // ── Message action handlers ────────────────────────────────────────────────

  private handleCopyMessage(msg: ChatMessage): void {
    if (!msg.text) return;
    navigator.clipboard.writeText(msg.text)
      .then(() => this.toasts.success('Copied to clipboard'))
      .catch(() => this.toasts.error('Failed to copy'));
  }

  private handleEditMessage(msg: ChatMessage, wrapper: HTMLElement): void {
    if (!this.activeSessionId || !msg.isOwn || msg.type !== 'text') return;
    const bubble = wrapper.querySelector('.chat-message__bubble') as HTMLElement | null;
    if (!bubble) return;

    const originalText = msg.text ?? '';
    bubble.innerHTML = `
      <div class="chat-message__edit-wrap">
        <textarea class="chat-message__edit-input" aria-label="Edit message" maxlength="10000">${escapeHtml(originalText)}</textarea>
        <div class="chat-message__edit-actions">
          <button class="btn btn--ghost btn--sm" id="edit-cancel-${msg.id}">Cancel</button>
          <button class="btn btn--primary btn--sm" id="edit-save-${msg.id}">Save</button>
        </div>
      </div>
    `;

    const textarea = bubble.querySelector('textarea') as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    });

    const cancelEdit = (): void => {
      wrapper.replaceWith(this.createMessageBubble(msg));
    };

    const saveEdit = (): void => {
      const newText = textarea.value.trim();
      if (!newText || newText === originalText) { cancelEdit(); return; }
      if (!this.activeSessionId) return;

      void AppBridge.chatEditMessage({ sessionId: this.activeSessionId, messageId: msg.id, newText });

      // Optimistic update
      msg.text    = newText;
      msg.editedAt = Date.now();
      const sessions = StateManager.get('chatSessions');
      const session  = sessions.get(this.activeSessionId!);
      if (session) {
        const updated = session.messages.map(m => m.id === msg.id ? { ...m, text: newText, editedAt: msg.editedAt } : m);
        StateManager.updateChatSession({ ...session, messages: updated });
      }
      wrapper.replaceWith(this.createMessageBubble(msg));
    };

    bubble.querySelector(`#edit-cancel-${msg.id}`)?.addEventListener('click', cancelEdit);
    bubble.querySelector(`#edit-save-${msg.id}`)?.addEventListener('click', saveEdit);
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
    });
  }

  private async handleDeleteMessage(msg: ChatMessage, wrapper: HTMLElement): Promise<void> {
    if (!this.activeSessionId || !msg.isOwn) return;

    // Optimistic tombstone
    msg.deleted = true;
    wrapper.replaceWith(this.createMessageBubble(msg));

    const sessions = StateManager.get('chatSessions');
    const session  = sessions.get(this.activeSessionId);
    if (session) {
      const updated = session.messages.map(m => m.id === msg.id ? { ...m, deleted: true } : m);
      StateManager.updateChatSession({ ...session, messages: updated });
    }

    try {
      await AppBridge.chatDeleteMessage({ sessionId: this.activeSessionId, messageId: msg.id });
    } catch {
      // Revert
      msg.deleted = false;
      this.toasts.error('Could not delete message');
    }
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
  }  private async handleSend(): Promise<void> {
    if (!this.inputEl || !this.activeSessionId) return;
    const text = this.inputEl.value.trim();
    if (!text) return;

    const sessionId = this.activeSessionId;
    this.inputEl.value = '';
    this.inputEl.style.height = 'auto';
    this.updateSendButton(false);

    try {
      const result = await AppBridge.chatSendText({ sessionId, text });
      // Immediately add the sent message to state so it appears right away.
      // The native side also fires a chatMessage event but we deduplicate by id.
      if (result) {
        const sessions = StateManager.get('chatSessions');
        const session  = sessions.get(sessionId);
        if (session) {
          const alreadyExists = session.messages.some(m => m.id === (result as { messageId?: string }).messageId);
          if (!alreadyExists) {
            const settings = StateManager.get('settings');
            const newMsg: ChatMessage = {
              id:         (result as { messageId?: string }).messageId ?? crypto.randomUUID(),
              sessionId,
              senderId:   settings?.deviceId ?? '',
              senderName: settings?.deviceName ?? '',
              isOwn:      true,
              type:       'text',
              text,
              timestamp:  Date.now(),
              status:     'sent',
            };
            StateManager.updateChatSession({
              ...session,
              messages:     [...session.messages, newMsg],
              lastActivity: newMsg.timestamp,
            });
          }
        }
      }
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

    if (file.size > 4 * 1024 * 1024) {
      this.toasts.warning('File too large for chat (max 4 MB).');
      return;
    }

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const comma = result.indexOf(',');
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });

      const ext     = file.name.split('.').pop()?.toLowerCase() ?? '';
      const isImage = ['jpg','jpeg','png','gif','webp','bmp','svg'].includes(ext);
      const msgType = isImage ? 'image' : 'file';

      const result = await AppBridge.chatSendFile({
        sessionId,
        filePath: '',
        fileName: file.name,
        fileSize: file.size,
        base64,
      } as Parameters<typeof AppBridge.chatSendFile>[0]);

      // Immediately show the sent file/image in the thread
      const sessions = StateManager.get('chatSessions');
      const session  = sessions.get(sessionId);
      if (session) {
        const settings = StateManager.get('settings');
        const newMsg: ChatMessage = {
          id:         (result as unknown as { messageId?: string } | null)?.messageId ?? crypto.randomUUID(),
          sessionId,
          senderId:   settings?.deviceId ?? '',
          senderName: settings?.deviceName ?? '',
          isOwn:      true,
          type:       msgType as 'image' | 'file',
          fileName:   file.name,
          fileSize:   file.size,
          thumbnail:  isImage ? base64 : undefined,
          timestamp:  Date.now(),
          status:     'sent',
        };
        const alreadyExists = session.messages.some(m => m.id === newMsg.id);
        if (!alreadyExists) {
          StateManager.updateChatSession({
            ...session,
            messages:     [...session.messages, newMsg],
            lastActivity: newMsg.timestamp,
          });
        }
      }
    } catch (err) {
      this.toasts.error(err instanceof Error ? err.message : 'Failed to send file');
    }
  }

  private setInputDisabled(disabled: boolean): void {
    if (this.inputEl) {
      this.inputEl.disabled = disabled;
      this.inputEl.placeholder = disabled ? 'Chat session ended' : 'Type a message…';
    }
    if (this.sendBtn)   this.sendBtn.disabled   = disabled || !this.inputEl?.value.trim();
    if (this.attachBtn) this.attachBtn.disabled  = disabled;
    if (this.inputAreaEl) {
      this.inputAreaEl.classList.toggle('chat-view__input-area--disabled', disabled);
    }
  }

  private async handleCloseSession(): Promise<void> {
    if (!this.activeSessionId) return;
    const sessionId = this.activeSessionId;

    // Confirmation modal
    const confirmed = await this.showCloseConfirm();
    if (!confirmed) return;

    try { await AppBridge.chatCloseSession({ sessionId }); } catch { /* non-fatal */ }
    StateManager.removeChatSession(sessionId);
    this.activeSessionId = null;
    this.renderedSessionId = null;
    this.renderedMsgCount = 0;
    StateManager.setState('activeChatSessionId', null);
    this.showSessionList();
    this.renderSessionList();
  }

  private showCloseConfirm(): Promise<boolean> {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'chat-close-confirm-backdrop';
      backdrop.innerHTML = `
        <div class="chat-close-confirm" role="dialog" aria-modal="true" aria-label="Close chat">
          <div class="chat-close-confirm__icon">
            <i class="fa-solid fa-circle-xmark"></i>
          </div>
          <h3 class="chat-close-confirm__title">Close chat?</h3>
          <p class="chat-close-confirm__body">This will end the session. Messages won't be saved.</p>
          <div class="chat-close-confirm__actions">
            <button class="chat-invite-modal__btn chat-invite-modal__btn--decline" id="close-cancel-btn">Cancel</button>
            <button class="chat-invite-modal__btn chat-invite-modal__btn--accept chat-close-confirm__btn--danger" id="close-confirm-btn">Close</button>
          </div>
        </div>
      `;
      document.body.appendChild(backdrop);

      const cleanup = (result: boolean): void => {
        backdrop.classList.add('chat-close-confirm-backdrop--exit');
        setTimeout(() => backdrop.remove(), 220);
        resolve(result);
      };

      backdrop.querySelector('#close-confirm-btn')?.addEventListener('click', () => cleanup(true));
      backdrop.querySelector('#close-cancel-btn')?.addEventListener('click',  () => cleanup(false));
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) cleanup(false); });
    });
  }

  /** Save a base64 payload to the device's Downloads via native, then open it */
  private async openBase64File(fileName: string, base64: string): Promise<void> {
    try {
      // Use AppBridge.chatSaveAndOpen if available, otherwise fall back to a
      // data-URL anchor download (works in the WebView for images).
      const ext  = fileName.split('.').pop()?.toLowerCase() ?? '';
      const mime = ({
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf',
      } as Record<string, string>)[ext] ?? 'application/octet-stream';

      const a = document.createElement('a');
      a.href     = `data:${mime};base64,${base64}`;
      a.download = fileName;
      a.click();
    } catch (err) {
      this.toasts.error('Could not open file');
    }
  }

  protected onUnmount(): void {
    this.closeContextMenu();
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
