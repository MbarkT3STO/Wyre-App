/**
 * ChatView.ts
 * Full-featured chat view.
 * Left panel: list of active sessions.
 * Right panel: message thread for the selected session.
 * Supports text, images, file attachments, and drag-and-drop.
 *
 * Performance: messages are appended incrementally — no full re-render on
 * every state update. Full re-render only happens when switching sessions.
 */

import { Component } from '../components/base/Component';
import { StateManager } from '../core/StateManager';
import { IpcClient } from '../core/IpcClient';
import { appRouter } from '../core/Router';
import type { ToastContainer } from '../components/ToastContainer';
import type { ChatSession, ChatMessage } from '../../shared/models/ChatMessage';
import { formatFileSize } from '../../shared/utils/formatters';

const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4 MB inline limit

export class ChatView extends Component {
  private toasts: ToastContainer;
  private activeSessionId: string | null = null;
  private messageListEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private attachBtn: HTMLButtonElement | null = null;
  private inputAreaEl: HTMLElement | null = null;
  private sessionListEl: HTMLElement | null = null;
  private emptyStateEl: HTMLElement | null = null;
  private threadEl: HTMLElement | null = null;
  private fileInput: HTMLInputElement | null = null;
  private dropOverlayEl: HTMLElement | null = null;
  private dragCounter = 0;

  // Incremental render tracking — avoids full re-render on every state update
  private renderedSessionId: string | null = null;
  private renderedMessageCount = 0;
  private lastRenderedDate = '';

  constructor(toasts: ToastContainer) {
    super();
    this.toasts = toasts;
  }

  render(): HTMLElement {
    const view = this.el('div', 'view chat-view');

    view.innerHTML = `
      <div class="chat-view__layout">

        <!-- Left: Session list -->
        <aside class="chat-view__sidebar" aria-label="Chat sessions">
          <div class="chat-view__sidebar-header">
            <span class="chat-view__sidebar-title">Chats</span>
            <button class="btn btn--ghost btn--icon btn--sm" id="chat-new-btn" title="Start new chat" aria-label="Start new chat">
              <i class="fa-solid fa-plus"></i>
            </button>
          </div>
          <div class="chat-view__session-list" id="chat-session-list" role="list">
            <div class="chat-view__sessions-empty" id="chat-sessions-empty">
              <i class="fa-regular fa-comment-dots chat-view__sessions-empty-icon"></i>
              <p>No active chats</p>
              <span>Select a device on the Home screen and click Chat</span>
            </div>
          </div>
        </aside>

        <!-- Right: Thread -->
        <div class="chat-view__thread" id="chat-thread">
          <!-- Empty state -->
          <div class="chat-view__thread-empty" id="chat-thread-empty">
            <i class="fa-regular fa-comments chat-view__thread-empty-icon"></i>
            <p>Select a chat to start messaging</p>
            <span>Messages are temporary and not stored after the session ends</span>
          </div>

          <!-- Active thread -->
          <div class="chat-view__thread-active" id="chat-thread-active" style="display:none">
            <!-- Header -->
            <div class="chat-view__thread-header" id="chat-thread-header">
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
              <div class="chat-view__thread-actions">
                <button class="btn btn--ghost btn--icon btn--sm" id="chat-close-btn" title="Close chat" aria-label="Close chat session">
                  <i class="fa-solid fa-xmark"></i>
                </button>
              </div>
            </div>

            <!-- Messages + drop overlay wrapper -->
            <div class="chat-view__messages-wrap" id="chat-messages-wrap">
              <div class="chat-view__messages" id="chat-messages" role="log" aria-live="polite" aria-label="Chat messages"></div>
              <!-- Drag-and-drop overlay -->
              <div class="chat-view__drop-overlay" id="chat-drop-overlay" aria-hidden="true">
                <div class="chat-view__drop-overlay-inner">
                  <i class="fa-solid fa-cloud-arrow-up chat-view__drop-overlay-icon" aria-hidden="true"></i>
                  <p class="chat-view__drop-overlay-label">Drop to send</p>
                  <span class="chat-view__drop-overlay-hint">Files up to 4 MB</span>
                </div>
              </div>
            </div>

            <!-- Input area -->
            <div class="chat-view__input-area">
              <button class="btn btn--ghost btn--icon btn--sm chat-view__attach-btn" id="chat-attach-btn" title="Attach file or image" aria-label="Attach file">
                <i class="fa-solid fa-paperclip"></i>
              </button>
              <input type="file" id="chat-file-input" style="display:none" accept="*/*" aria-hidden="true" />
              <textarea
                class="chat-view__input"
                id="chat-input"
                placeholder="Type a message… (Shift+Enter for new line)"
                rows="1"
                aria-label="Message input"
                maxlength="10000"
              ></textarea>
              <button class="btn btn--primary btn--icon chat-view__send-btn" id="chat-send-btn" disabled aria-label="Send message">
                <i class="fa-solid fa-paper-plane"></i>
              </button>
            </div>
          </div>
        </div>

      </div>
    `;

    return view;
  }

  protected onMount(): void {
    if (!this.element) return;

    this.sessionListEl = this.element.querySelector('#chat-session-list');
    this.messageListEl = this.element.querySelector('#chat-messages');
    this.inputEl = this.element.querySelector('#chat-input') as HTMLTextAreaElement;
    this.sendBtn = this.element.querySelector('#chat-send-btn') as HTMLButtonElement;
    this.attachBtn = this.element.querySelector('#chat-attach-btn') as HTMLButtonElement;
    this.inputAreaEl = this.element.querySelector('.chat-view__input-area') as HTMLElement;
    this.emptyStateEl = this.element.querySelector('#chat-thread-empty');
    this.threadEl = this.element.querySelector('#chat-thread-active');
    this.fileInput = this.element.querySelector('#chat-file-input') as HTMLInputElement;
    this.dropOverlayEl = this.element.querySelector('#chat-drop-overlay');

    // Load existing sessions
    void this.loadSessions();

    // Subscribe to session map changes — only update sidebar + header/status,
    // never do a full message re-render here (that causes the "refresh" flicker)
    const unsubSessions = StateManager.subscribe('chatSessions', (sessions) => {
      this.renderSessionList();
      if (this.activeSessionId) {
        const session = sessions.get(this.activeSessionId);
        if (session) {
          this.patchThreadHeader(session);
          this.appendNewMessages(session);
          this.setInputDisabled(!session.connected);
        }
      }
    });
    this.addCleanup(unsubSessions);

    // Subscribe to active session ID changes (e.g. from invite accept)
    const unsubActive = StateManager.subscribe('activeChatSessionId', (id) => {
      if (id && id !== this.activeSessionId) this.selectSession(id);
    });
    this.addCleanup(unsubActive);

    // Open pending session if set before this view mounted
    const pendingSessionId = StateManager.get('activeChatSessionId');
    if (pendingSessionId) this.selectSession(pendingSessionId);

    // Input events
    this.inputEl?.addEventListener('input', () => this.handleInputChange());
    this.inputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void this.handleSend(); }
    });
    this.sendBtn?.addEventListener('click', () => { void this.handleSend(); });
    this.attachBtn?.addEventListener('click', () => { this.fileInput?.click(); });
    this.fileInput?.addEventListener('change', () => { void this.handleFileAttach(); });

    // Close button
    this.element.querySelector('#chat-close-btn')?.addEventListener('click', () => {
      void this.handleCloseSession();
    });

    // New chat → go home
    this.element.querySelector('#chat-new-btn')?.addEventListener('click', () => {
      appRouter.navigate('/home');
    });

    // Mark read on click — but DON'T trigger a state update that causes re-render
    this.element.addEventListener('click', () => {
      if (!this.activeSessionId) return;
      const sessions = StateManager.get('chatSessions');
      const session = sessions.get(this.activeSessionId);
      if (session && session.unreadCount > 0) {
        // Mutate unreadCount directly on the stored object to avoid triggering
        // the chatSessions subscriber (which would cause a re-render)
        session.unreadCount = 0;
        void IpcClient.chatMarkRead({ sessionId: this.activeSessionId });
        // Only update the sidebar badge — not the whole thread
        this.renderSessionList();
      }
    });

    this.wireDragAndDrop();
  }

  private async loadSessions(): Promise<void> {
    try {
      const sessions = await IpcClient.chatGetSessions();
      for (const session of sessions) {
        StateManager.updateChatSession(session);
      }
      this.renderSessionList();
    } catch { /* non-fatal */ }
  }

  private renderSessionList(): void {
    if (!this.sessionListEl) return;

    const sessions = Array.from(StateManager.get('chatSessions').values())
      .sort((a, b) => b.lastActivity - a.lastActivity);

    const emptyEl = this.element?.querySelector('#chat-sessions-empty') as HTMLElement | null;

    if (sessions.length === 0) {
      if (emptyEl) emptyEl.style.display = 'flex';
      // Clear existing items
      const items = this.sessionListEl.querySelectorAll('.chat-session-item');
      items.forEach(el => el.remove());
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    // Diff: update existing, add new, remove stale
    const existingIds = new Set(
      Array.from(this.sessionListEl.querySelectorAll('.chat-session-item'))
        .map(el => (el as HTMLElement).dataset['sessionId'] ?? ''),
    );

    const currentIds = new Set(sessions.map(s => s.id));

    // Remove stale
    for (const id of existingIds) {
      if (!currentIds.has(id)) {
        this.sessionListEl.querySelector(`[data-session-id="${id}"]`)?.remove();
      }
    }

    // Add/update
    for (const session of sessions) {
      const existing = this.sessionListEl.querySelector(`[data-session-id="${session.id}"]`) as HTMLElement | null;
      if (existing) {
        this.updateSessionItem(existing, session);
      } else {
        const item = this.createSessionItem(session);
        this.sessionListEl.appendChild(item);
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
    const isActive = session.id === this.activeSessionId;

    el.className = `chat-session-item${isActive ? ' chat-session-item--active' : ''}`;
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

    // Update active state in sidebar list
    this.sessionListEl?.querySelectorAll('.chat-session-item').forEach(el => {
      const id = (el as HTMLElement).dataset['sessionId'];
      el.classList.toggle('chat-session-item--active', id === sessionId);
    });

    // Full re-render of the thread (only on session switch)
    this.fullRenderThread(sessionId);

    // Mark as read — mutate directly, no state broadcast
    const sessions = StateManager.get('chatSessions');
    const session = sessions.get(sessionId);
    if (session && session.unreadCount > 0) {
      session.unreadCount = 0;
      void IpcClient.chatMarkRead({ sessionId });
      this.renderSessionList();
    }

    setTimeout(() => this.inputEl?.focus(), 50);
  }

  /**
   * Full re-render of the thread — only called when switching sessions.
   * Resets incremental tracking counters.
   */
  private fullRenderThread(sessionId: string): void {
    const session = StateManager.get('chatSessions').get(sessionId);

    if (!session) { this.showEmptyState(); return; }

    this.showThread();
    this.patchThreadHeader(session);

    if (!this.messageListEl) return;

    // Wipe and rebuild
    this.messageListEl.innerHTML = '';
    this.renderedSessionId = sessionId;
    this.renderedMessageCount = 0;
    this.lastRenderedDate = '';

    if (session.messages.length === 0) {
      this.messageListEl.innerHTML = `
        <div class="chat-view__messages-empty" id="chat-messages-empty-state">
          <i class="fa-regular fa-comment chat-view__messages-empty-icon"></i>
          <p>Say hello to ${escapeHtml(session.peerName)}!</p>
        </div>
      `;
    } else {
      const frag = document.createDocumentFragment();
      for (const msg of session.messages) {
        const msgDate = new Date(msg.timestamp).toLocaleDateString();
        if (msgDate !== this.lastRenderedDate) {
          frag.appendChild(this.createDateDivider(msgDate));
          this.lastRenderedDate = msgDate;
        }
        frag.appendChild(this.createMessageBubble(msg));
        this.renderedMessageCount++;
      }
      this.messageListEl.appendChild(frag);
    }

    this.messageListEl.scrollTop = this.messageListEl.scrollHeight;
    this.setInputDisabled(!session.connected);
  }

  /**
   * Incremental append — only adds messages that haven't been rendered yet.
   * Called on every chatSessions state update for the active session.
   */
  private appendNewMessages(session: ChatSession): void {
    if (!this.messageListEl || session.id !== this.renderedSessionId) return;

    const messages = session.messages;
    if (messages.length <= this.renderedMessageCount) {
      // Update status icons on existing bubbles (delivery status changes)
      this.patchMessageStatuses(session);
      return;
    }

    // Remove empty state if present
    const emptyState = this.messageListEl.querySelector('#chat-messages-empty-state');
    if (emptyState) emptyState.remove();

    const newMessages = messages.slice(this.renderedMessageCount);
    const frag = document.createDocumentFragment();
    const wasAtBottom = this.isScrolledToBottom();

    for (const msg of newMessages) {
      const msgDate = new Date(msg.timestamp).toLocaleDateString();
      if (msgDate !== this.lastRenderedDate) {
        frag.appendChild(this.createDateDivider(msgDate));
        this.lastRenderedDate = msgDate;
      }
      frag.appendChild(this.createMessageBubble(msg));
      this.renderedMessageCount++;
    }

    this.messageListEl.appendChild(frag);

    // Auto-scroll only if user was already at the bottom
    if (wasAtBottom) {
      this.messageListEl.scrollTop = this.messageListEl.scrollHeight;
    }
  }

  /** Patch delivery status icons without re-rendering bubbles */
  private patchMessageStatuses(session: ChatSession): void {
    if (!this.messageListEl) return;
    for (const msg of session.messages) {
      const bubbleEl = this.messageListEl.querySelector(`[data-message-id="${msg.id}"]`) as HTMLElement | null;
      if (!bubbleEl) continue;

      // If message was deleted, replace with tombstone
      if (msg.deleted && !bubbleEl.querySelector('.chat-message__bubble--deleted')) {
        const tombstone = this.createMessageBubble(msg);
        bubbleEl.replaceWith(tombstone);
        continue;
      }

      // Patch status icon for own messages
      if (msg.isOwn && !msg.deleted) {
        const statusEl = bubbleEl.querySelector('.chat-message__status-icon');
        if (statusEl) {
          const newIcon = this.getStatusIcon(msg.status);
          if (newIcon && statusEl.outerHTML !== newIcon) {
            const tmp = document.createElement('span');
            tmp.innerHTML = newIcon;
            const newEl = tmp.firstElementChild;
            if (newEl) statusEl.replaceWith(newEl);
          }
        }

        // Patch edited text in-place
        if (msg.editedAt) {
          const textEl = bubbleEl.querySelector('.chat-message__text');
          if (textEl && msg.text) {
            const newHtml = escapeHtml(msg.text).replace(/\n/g, '<br>');
            if (textEl.innerHTML !== newHtml) textEl.innerHTML = newHtml;
          }
          // Add edited badge if missing
          const meta = bubbleEl.querySelector('.chat-message__meta');
          if (meta && !meta.querySelector('.chat-message__edited')) {
            const badge = document.createElement('span');
            badge.className = 'chat-message__edited';
            badge.title = 'Edited';
            badge.textContent = 'edited';
            meta.prepend(badge);
          }
        }
      }

      // Patch peer edited text
      if (!msg.isOwn && msg.editedAt && !msg.deleted) {
        const textEl = bubbleEl.querySelector('.chat-message__text');
        if (textEl && msg.text) {
          const newHtml = escapeHtml(msg.text).replace(/\n/g, '<br>');
          if (textEl.innerHTML !== newHtml) textEl.innerHTML = newHtml;
        }
        const meta = bubbleEl.querySelector('.chat-message__meta');
        if (meta && !meta.querySelector('.chat-message__edited')) {
          const badge = document.createElement('span');
          badge.className = 'chat-message__edited';
          badge.title = 'Edited';
          badge.textContent = 'edited';
          meta.prepend(badge);
        }
      }
    }
  }

  private isScrolledToBottom(): boolean {
    if (!this.messageListEl) return true;
    const { scrollTop, scrollHeight, clientHeight } = this.messageListEl;
    return scrollHeight - scrollTop - clientHeight < 60;
  }

  private createDateDivider(dateStr: string): HTMLElement {
    const div = document.createElement('div');
    div.className = 'chat-view__date-divider';
    div.textContent = dateStr;
    return div;
  }

  /** Patch only the header elements — no DOM wipe */
  private patchThreadHeader(session: ChatSession): void {
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
  }

  /** Enable or disable the entire input area + drag/drop */
  private setInputDisabled(disabled: boolean): void {
    if (this.inputEl) {
      this.inputEl.disabled = disabled;
      this.inputEl.placeholder = disabled
        ? 'Chat session ended'
        : 'Type a message… (Shift+Enter for new line)';
    }
    if (this.sendBtn) this.sendBtn.disabled = disabled || !this.inputEl?.value.trim();
    if (this.attachBtn) this.attachBtn.disabled = disabled;
    if (this.inputAreaEl) {
      this.inputAreaEl.classList.toggle('chat-view__input-area--disabled', disabled);
    }
    // Disable drag/drop overlay when disconnected
    if (this.dropOverlayEl) {
      this.dropOverlayEl.dataset['disabled'] = disabled ? 'true' : 'false';
    }
  }

  private createMessageBubble(msg: ChatMessage): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = `chat-message ${msg.isOwn ? 'chat-message--own' : 'chat-message--peer'}`;
    wrapper.dataset['messageId'] = msg.id;

    // Deleted message — show tombstone
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
        gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
      };
      const mime = mimeMap[ext] ?? 'image/png';
      const src = `data:${mime};base64,${msg.thumbnail}`;
      contentHtml = `
        <div class="chat-message__image-wrap">
          <img class="chat-message__image" src="${src}" alt="${escapeHtml(msg.fileName ?? 'Image')}" loading="lazy" />
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
            <button class="btn btn--ghost btn--icon btn--sm chat-message__file-open" data-path="${escapeHtml(msg.filePath)}" title="Open file" aria-label="Open file">
              <i class="fa-solid fa-arrow-up-right-from-square"></i>
            </button>
          ` : ''}
        </div>
      `;
    }

    // Build action bar — copy always available for text; edit/delete only for own
    const canCopy = msg.type === 'text' && !!(msg.text);
    const canEdit = msg.isOwn && msg.type === 'text';
    const canDelete = msg.isOwn;

    // ⋮ menu button — always visible on hover, opens a dropdown
    const menuItems: string[] = [];
    if (canCopy)   menuItems.push(`<button class="chat-message__menu-item" data-action="copy"><i class="fa-regular fa-copy"></i> Copy</button>`);
    if (canEdit)   menuItems.push(`<button class="chat-message__menu-item" data-action="edit"><i class="fa-solid fa-pen"></i> Edit</button>`);
    if (canDelete) menuItems.push(`<button class="chat-message__menu-item chat-message__menu-item--danger" data-action="delete"><i class="fa-solid fa-trash"></i> Delete</button>`);

    const actionBar = menuItems.length > 0 ? `
      <div class="chat-message__actions" role="toolbar" aria-label="Message actions">
        <button class="chat-message__action-btn chat-message__action-btn--menu" aria-label="Message options" aria-haspopup="true">
          <i class="fa-solid fa-ellipsis-vertical" aria-hidden="true"></i>
        </button>
        <div class="chat-message__menu" role="menu">
          ${menuItems.join('')}
        </div>
      </div>
    ` : '';

    wrapper.innerHTML = `
      ${actionBar}
      <div class="chat-message__bubble">
        ${contentHtml}
        <div class="chat-message__meta">
          ${editedBadge}
          <span class="chat-message__time">${time}</span>
          ${statusIcon}
        </div>
      </div>
    `;

    // Wire open file button
    const openBtn = wrapper.querySelector('.chat-message__file-open') as HTMLButtonElement | null;
    if (openBtn) {
      openBtn.addEventListener('click', () => {
        const path = openBtn.dataset['path'];
        if (path) void IpcClient.openFile(path);
      });
    }

    // Wire image click to open
    const img = wrapper.querySelector('.chat-message__image') as HTMLImageElement | null;
    if (img && msg.filePath) {
      img.style.cursor = 'pointer';
      img.addEventListener('click', () => {
        if (msg.filePath) void IpcClient.openFile(msg.filePath);
      });
    }

    // Wire ⋮ menu button toggle
    const menuBtn = wrapper.querySelector('.chat-message__action-btn--menu') as HTMLButtonElement | null;
    const menuEl  = wrapper.querySelector('.chat-message__menu') as HTMLElement | null;
    if (menuBtn && menuEl) {
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = menuEl.classList.toggle('chat-message__menu--open');
        menuBtn.setAttribute('aria-expanded', String(isOpen));
        if (isOpen) {
          // Close when clicking outside
          const close = (ev: MouseEvent): void => {
            if (!menuEl.contains(ev.target as Node) && ev.target !== menuBtn) {
              menuEl.classList.remove('chat-message__menu--open');
              menuBtn.setAttribute('aria-expanded', 'false');
            }
            document.removeEventListener('click', close, true);
          };
          setTimeout(() => document.addEventListener('click', close, true), 0);
        }
      });
    }

    // Wire menu item clicks
    wrapper.querySelectorAll('.chat-message__menu-item').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menuEl?.classList.remove('chat-message__menu--open');
        const action = (btn as HTMLElement).dataset['action'];
        if (action === 'copy')   this.handleCopyMessage(msg);
        else if (action === 'edit')   this.handleEditMessage(msg, wrapper);
        else if (action === 'delete') void this.handleDeleteMessage(msg, wrapper);
      });
    });

    return wrapper;
  }

  // ── Message actions ────────────────────────────────────────────────────────

  private handleCopyMessage(msg: ChatMessage): void {
    if (!msg.text) return;
    navigator.clipboard.writeText(msg.text).then(() => {
      this.toasts.success('Copied to clipboard');
    }).catch(() => {
      this.toasts.error('Failed to copy');
    });
  }

  private handleEditMessage(msg: ChatMessage, wrapper: HTMLElement): void {
    if (!this.activeSessionId || !msg.isOwn || msg.type !== 'text') return;

    const bubble = wrapper.querySelector('.chat-message__bubble') as HTMLElement | null;
    if (!bubble) return;

    const originalText = msg.text ?? '';

    // Replace bubble content with inline editor
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
    // Set cursor to end
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    // Auto-resize
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    });

    const cancelEdit = (): void => {
      // Restore original bubble
      const restored = this.createMessageBubble(msg);
      wrapper.replaceWith(restored);
    };

    const saveEdit = (): void => {
      const newText = textarea.value.trim();
      if (!newText || newText === originalText) { cancelEdit(); return; }
      if (!this.activeSessionId) return;

      void IpcClient.chatEditMessage({
        sessionId: this.activeSessionId,
        messageId: msg.id,
        newText,
      }).then((ok) => {
        if (ok) {
          // Update local state — the IpcListener will also fire but we patch immediately
          msg.text = newText;
          msg.editedAt = Date.now();
          const restored = this.createMessageBubble(msg);
          wrapper.replaceWith(restored);
        } else {
          this.toasts.error('Could not edit message');
          cancelEdit();
        }
      });
    };

    bubble.querySelector(`#edit-cancel-${msg.id}`)?.addEventListener('click', cancelEdit);
    bubble.querySelector(`#edit-save-${msg.id}`)?.addEventListener('click', saveEdit);

    // Keyboard shortcuts inside the edit textarea
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
    });
  }

  private async handleDeleteMessage(msg: ChatMessage, wrapper: HTMLElement): Promise<void> {
    if (!this.activeSessionId || !msg.isOwn) return;

    // Instant optimistic delete — replace with tombstone immediately
    msg.deleted = true;
    const tombstone = this.createMessageBubble(msg);
    wrapper.replaceWith(tombstone);

    try {
      await IpcClient.chatDeleteMessage({
        sessionId: this.activeSessionId,
        messageId: msg.id,
      });
    } catch {
      // Revert on failure
      msg.deleted = false;
      const restored = this.createMessageBubble(msg);
      tombstone.replaceWith(restored);
      this.toasts.error('Could not delete message');
    }
  }

  private getStatusIcon(status: ChatMessage['status']): string {
    switch (status) {
      case 'sending':
        return `<i class="fa-solid fa-clock chat-message__status-icon chat-message__status-icon--sending" title="Sending"></i>`;
      case 'sent':
        return `<i class="fa-solid fa-check chat-message__status-icon chat-message__status-icon--sent" title="Sent"></i>`;
      case 'delivered':
        return `<i class="fa-solid fa-check-double chat-message__status-icon chat-message__status-icon--delivered" title="Delivered"></i>`;
      case 'failed':
        return `<i class="fa-solid fa-triangle-exclamation chat-message__status-icon chat-message__status-icon--failed" title="Failed"></i>`;
      default:
        return '';
    }
  }

  private showEmptyState(): void {
    if (this.emptyStateEl) this.emptyStateEl.style.display = 'flex';
    if (this.threadEl) this.threadEl.style.display = 'none';
  }

  private showThread(): void {
    if (this.emptyStateEl) this.emptyStateEl.style.display = 'none';
    if (this.threadEl) this.threadEl.style.display = 'flex';
  }

  private handleInputChange(): void {
    if (!this.inputEl) return;
    // Auto-resize textarea
    this.inputEl.style.height = 'auto';
    this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight, 160)}px`;
    // Only update send button — don't call setInputDisabled (that would disable the input itself)
    if (this.sendBtn) {
      const connected = this.isSessionConnected();
      this.sendBtn.disabled = !connected || !this.inputEl.value.trim();
    }
  }

  private isSessionConnected(): boolean {
    if (!this.activeSessionId) return false;
    return StateManager.get('chatSessions').get(this.activeSessionId)?.connected ?? false;
  }

  private async handleSend(): Promise<void> {
    if (!this.inputEl || !this.activeSessionId) return;
    const text = this.inputEl.value.trim();
    if (!text || !this.isSessionConnected()) return;

    const sessionId = this.activeSessionId;
    this.inputEl.value = '';
    this.inputEl.style.height = 'auto';
    if (this.sendBtn) this.sendBtn.disabled = true;

    try {
      const message = await IpcClient.chatSendText({ sessionId, text });
      if (message) {
        // Optimistically add to state — the subscriber will call appendNewMessages
        const sessions = StateManager.get('chatSessions');
        const session = sessions.get(sessionId);
        if (session && !session.messages.some(m => m.id === message.id)) {
          session.messages.push(message);
          session.lastActivity = message.timestamp;
          // Trigger subscriber with a new Map reference so listeners fire
          StateManager.updateChatSession({ ...session });
        }
      }
    } catch (err) {
      this.toasts.error(err instanceof Error ? err.message : 'Failed to send');
    }

    if (this.sendBtn) this.sendBtn.disabled = !this.isSessionConnected();
    this.inputEl.focus();
  }

  private async handleFileAttach(): Promise<void> {
    if (!this.fileInput || !this.activeSessionId || !this.isSessionConnected()) return;
    const file = this.fileInput.files?.[0];
    if (!file) return;
    this.fileInput.value = '';
    await this.sendDroppedFile(file);
  }

  private async handleCloseSession(): Promise<void> {
    if (!this.activeSessionId) return;
    const session = StateManager.get('chatSessions').get(this.activeSessionId);
    const peerName = session?.peerName ?? 'this device';
    const msgCount = session?.messages.length ?? 0;

    const confirmed = await this.showCloseConfirmation(peerName, msgCount);
    if (!confirmed) return;

    const sessionId = this.activeSessionId;
    try {
      await IpcClient.chatCloseSession({ sessionId });
    } catch { /* non-fatal */ }

    // Reset incremental render state
    this.renderedSessionId = null;
    this.renderedMessageCount = 0;
    this.lastRenderedDate = '';

    StateManager.removeChatSession(sessionId);
    this.activeSessionId = null;
    StateManager.setState('activeChatSessionId', null);
    this.showEmptyState();
    this.renderSessionList();
  }

  private showCloseConfirmation(peerName: string, msgCount: number): Promise<boolean> {
    return new Promise((resolve) => {
      const dialogMount = document.getElementById('dialog-mount');
      if (!dialogMount) { resolve(true); return; }

      const backdrop = document.createElement('div');
      backdrop.className = 'chat-close-backdrop';
      backdrop.setAttribute('role', 'dialog');
      backdrop.setAttribute('aria-modal', 'true');
      backdrop.setAttribute('aria-label', 'Close chat confirmation');

      const msgNote = msgCount > 0
        ? `<p class="chat-close-modal__note"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ${msgCount} message${msgCount === 1 ? '' : 's'} will be lost — chat history is not saved</p>`
        : `<p class="chat-close-modal__note"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> Chat history is not saved</p>`;

      backdrop.innerHTML = `
        <div class="chat-close-modal">
          <div class="chat-close-modal__icon-wrap" aria-hidden="true">
            <i class="fa-solid fa-comment-slash chat-close-modal__icon"></i>
          </div>
          <h2 class="chat-close-modal__heading">End chat session?</h2>
          <p class="chat-close-modal__body">Your chat with <strong>${escapeHtml(peerName)}</strong> will be closed.</p>
          ${msgNote}
          <div class="chat-close-modal__actions">
            <button class="btn btn--secondary" id="chat-close-cancel">Keep chatting</button>
            <button class="btn btn--danger" id="chat-close-confirm">
              <i class="fa-solid fa-comment-slash btn__icon" aria-hidden="true"></i>
              End session
            </button>
          </div>
        </div>
      `;

      const cleanup = (): void => { backdrop.remove(); };

      backdrop.querySelector('#chat-close-confirm')?.addEventListener('click', () => { cleanup(); resolve(true); });
      backdrop.querySelector('#chat-close-cancel')?.addEventListener('click', () => { cleanup(); resolve(false); });
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { cleanup(); resolve(false); } });

      const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); cleanup(); resolve(false); }
        if (e.key === 'Enter')  { document.removeEventListener('keydown', onKey); cleanup(); resolve(true); }
      };
      document.addEventListener('keydown', onKey);
      dialogMount.appendChild(backdrop);
      setTimeout(() => (backdrop.querySelector('#chat-close-confirm') as HTMLButtonElement | null)?.focus(), 50);
    });
  }

  // ── Drag and drop ──────────────────────────────────────────────────────────

  private wireDragAndDrop(): void {
    const messagesWrap = this.element?.querySelector('#chat-messages-wrap') as HTMLElement | null;
    if (!messagesWrap || !this.dropOverlayEl) return;

    const overlay = this.dropOverlayEl;
    const showOverlay = (): void => overlay.classList.add('chat-view__drop-overlay--visible');
    const hideOverlay = (): void => overlay.classList.remove('chat-view__drop-overlay--visible');

    messagesWrap.addEventListener('dragenter', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.dragCounter++;
      if (this.activeSessionId && this.isSessionConnected() && this.dropOverlayEl?.dataset['disabled'] !== 'true') {
        showOverlay();
      }
    });

    messagesWrap.addEventListener('dragleave', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.dragCounter--;
      if (this.dragCounter <= 0) { this.dragCounter = 0; hideOverlay(); }
    });

    messagesWrap.addEventListener('dragover', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });

    messagesWrap.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.dragCounter = 0;
      hideOverlay();

      if (!this.activeSessionId || !this.isSessionConnected()) {
        this.toasts.warning('Connect to a chat session first.');
        return;
      }

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file) void this.sendDroppedFile(file);
      }
    });
  }

  private async sendDroppedFile(file: File): Promise<void> {
    if (!this.activeSessionId || !this.isSessionConnected()) return;

    const filePath = (file as File & { path?: string }).path;
    if (!filePath) {
      this.toasts.error(`Cannot read path for "${file.name}".`);
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      this.toasts.warning(`"${file.name}" is too large for chat (max 4 MB). Use Send Files instead.`);
      return;
    }

    const sessionId = this.activeSessionId;
    try {
      const message = await IpcClient.chatSendFile({ sessionId, filePath, fileName: file.name, fileSize: file.size });
      if (message) {
        const sessions = StateManager.get('chatSessions');
        const session = sessions.get(sessionId);
        if (session && !session.messages.some(m => m.id === message.id)) {
          session.messages.push(message);
          session.lastActivity = message.timestamp;
          StateManager.updateChatSession({ ...session });
        }
      } else {
        this.toasts.error(`Failed to send "${file.name}". It may be too large.`);
      }
    } catch (err) {
      this.toasts.error(err instanceof Error ? err.message : `Failed to send "${file.name}"`);
    }
  }

  protected onUnmount(): void {
    this.dragCounter = 0;
    this.renderedSessionId = null;
    this.renderedMessageCount = 0;
    this.lastRenderedDate = '';
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}