/**
 * IpcListeners.ts
 * Wires all IpcClient event listeners to StateManager updates and toast notifications.
 */

import { IpcClient } from '../core/IpcClient';
import { StateManager } from '../core/StateManager';
import type { ToastContainer } from '../components/ToastContainer';
import type { Router } from '../core/Router';
import { TransferStatus } from '../../shared/models/Transfer';
import type { Transfer } from '../../shared/models/Transfer';
import { IncomingDialog } from '../components/IncomingDialog';
import type { IncomingRequestPayload } from '../../shared/ipc/IpcContracts';
import { ChatInviteDialog } from '../components/ChatInviteDialog';
import { ChatPendingDialog } from '../components/ChatPendingDialog';

function showIncomingDialog(payload: IncomingRequestPayload, toasts: ToastContainer): void {
  const dialogMount = document.getElementById('dialog-mount');
  if (!dialogMount) return;

  const settings = StateManager.get('settings');
  const timeout = settings?.autoDeclineTimeout ?? 30;

  const dialog = new IncomingDialog(payload, timeout);

  const originalUnmount = dialog.unmount.bind(dialog);
  dialog.unmount = () => {
    originalUnmount();
    showNextIncomingDialog(toasts);
  };

  dialog.mount(dialogMount);
}

function showNextIncomingDialog(toasts: ToastContainer): void {
  const queue = StateManager.get('pendingIncomingQueue');
  if (queue.length === 0) return;

  const [, ...remaining] = queue;
  StateManager.setState('pendingIncomingQueue', remaining);

  if (remaining.length > 0) {
    showIncomingDialog(remaining[0], toasts);
  }
}

/**
 * Registers all IpcClient event listeners. Call once during bootstrap.
 */
export function wireIpcListeners(toasts: ToastContainer, _router: Router): void {
  // Device updates
  const unsubDevices = IpcClient.onDevicesUpdated(({ devices }) => {
    StateManager.setState('devices', devices);
  });

  // Transfer started — seeds the renderer state so progress events can land.
  const unsubStarted = IpcClient.onTransferStarted((payload) => {
    const existing = StateManager.get('activeTransfers').get(payload.transferId);
    if (!existing) {
      StateManager.updateTransfer({
        id: payload.transferId,
        direction: payload.direction,
        status: payload.status,
        peerId: payload.peerId,
        peerName: payload.peerName,
        fileName: payload.fileName,
        fileSize: payload.fileSize,
        filePath: '',
        bytesTransferred: 0,
        progress: 0,
        speed: 0,
        eta: 0,
        startedAt: Date.now(),
        checksum: '',
      });
    } else {
      StateManager.updateTransfer({
        ...existing,
        status: payload.status,
        peerName: payload.peerName,
        fileName: payload.fileName,
        fileSize: payload.fileSize,
      });
    }
  });

  // Transfer progress
  const unsubProgress = IpcClient.onTransferProgress((payload) => {
    const existing = StateManager.get('activeTransfers').get(payload.transferId);
    if (existing) {
      StateManager.updateTransfer({
        ...existing,
        status: TransferStatus.Active,
        bytesTransferred: payload.bytesTransferred,
        progress: payload.progress,
        speed: payload.speed,
        eta: payload.eta,
      });
    } else {
      StateManager.updateTransfer({
        id: payload.transferId,
        direction: 'send',
        status: TransferStatus.Active,
        peerId: '',
        peerName: '',
        fileName: '',
        fileSize: payload.totalBytes,
        filePath: '',
        bytesTransferred: payload.bytesTransferred,
        progress: payload.progress,
        speed: payload.speed,
        eta: payload.eta,
        startedAt: Date.now(),
        checksum: '',
      });
    }
  });

  // Transfer complete
  const unsubComplete = IpcClient.onTransferComplete((payload) => {
    const existing = StateManager.get('activeTransfers').get(payload.transferId);
    if (existing) {
      const completed: Transfer = {
        ...existing,
        status: TransferStatus.Completed,
        progress: 100,
        completedAt: Date.now(),
        savedPath: payload.savedPath,
      };
      StateManager.updateTransfer(completed);
      if (existing.direction === 'receive') {
        toasts.success(
          `${existing.fileName} transferred`,
          'Show in folder',
          payload.savedPath
            ? () => window.dispatchEvent(new CustomEvent('filedrop:show-in-folder', { detail: { path: payload.savedPath } }))
            : undefined,
        );
      } else {
        toasts.success(`${existing.fileName} sent successfully`);
      }
    }
    IpcClient.getHistory().then(h => StateManager.setState('transferHistory', h)).catch(() => { /* non-fatal */ });
  });

  // Transfer error
  const unsubError = IpcClient.onTransferError((payload) => {
    const existing = StateManager.get('activeTransfers').get(payload.transferId);
    if (existing) {
      StateManager.updateTransfer({
        ...existing,
        status: TransferStatus.Failed,
        completedAt: Date.now(),
        errorMessage: payload.error,
        errorCode: payload.code,
      });
    }
    if (payload.code !== 'CANCELLED' && payload.code !== 'DECLINED') {
      toasts.error(`Transfer failed: ${payload.error}`);
    }
    IpcClient.getHistory().then(h => StateManager.setState('transferHistory', h)).catch(() => { /* non-fatal */ });
  });

  // Incoming request
  const unsubIncoming = IpcClient.onIncomingRequest((payload) => {
    const queue = StateManager.get('pendingIncomingQueue');
    StateManager.setState('pendingIncomingQueue', [...queue, payload]);
    if (queue.length === 0) {
      showIncomingDialog(payload, toasts);
    }
  });

  // Outgoing send queue
  const unsubSendQueue = IpcClient.onTransferQueueUpdated((payload) => {
    StateManager.setState('sendQueue', payload.queue);
  });

  // Clipboard received
  const unsubClipboard = IpcClient.onClipboardReceived(({ senderName, text, truncated }) => {
    const preview = text.length > 120 ? text.slice(0, 120) + '…' : text;
    const truncNote = truncated ? ' (truncated to 5000 chars)' : '';
    toasts.show({
      type: 'info',
      message: `${senderName}: "${preview}"${truncNote}`,
      actionLabel: 'Copy',
      onAction: () => { void navigator.clipboard.writeText(text); },
      duration: 8000,
    });
  });

  // Transfer paused
  const unsubPaused = IpcClient.onTransferPaused((payload) => {
    const existing = StateManager.get('activeTransfers').get(payload.transferId);
    if (existing) {
      StateManager.updateTransfer({
        ...existing,
        status: TransferStatus.Paused,
        bytesTransferred: payload.bytesTransferred,
        resumeOffset: payload.bytesTransferred,
      });
    }
  });

  // ── Chat listeners ────────────────────────────────────────────────────────

  // Chat message received
  const unsubChatMessage = IpcClient.onChatMessage(({ sessionId, message }) => {
    const sessions = StateManager.get('chatSessions');
    const session = sessions.get(sessionId);
    if (session) {
      // Avoid duplicates (message may already be in state from optimistic send)
      const exists = session.messages.some(m => m.id === message.id);
      if (!exists) {
        const updated = {
          ...session,
          messages: [...session.messages, message],
          lastActivity: message.timestamp,
          unreadCount: message.isOwn ? session.unreadCount : session.unreadCount + 1,
        };
        StateManager.updateChatSession(updated);
      }
    }
  });

  // Chat message status updated
  const unsubChatStatus = IpcClient.onChatMessageStatus(({ sessionId, messageId, status }) => {
    const sessions = StateManager.get('chatSessions');
    const session = sessions.get(sessionId);
    if (session) {
      const updated = {
        ...session,
        messages: session.messages.map(m =>
          m.id === messageId ? { ...m, status } : m,
        ),
      };
      StateManager.updateChatSession(updated);
    }
  });

  // Chat session updated
  const unsubChatSession = IpcClient.onChatSessionUpdated(({ session }) => {
    StateManager.updateChatSession(session);
  });

  // Chat invite received (receiver side)
  const unsubChatInvite = IpcClient.onChatInvite((payload) => {
    const invites = StateManager.get('pendingChatInvites');
    if (!invites.some(i => i.sessionId === payload.sessionId)) {
      StateManager.setState('pendingChatInvites', [...invites, payload]);
    }
    showChatInviteDialog(payload, _router);
  });

  // Chat request pending (sender side) — show the waiting modal
  const unsubChatPending = IpcClient.onChatRequestPending((payload) => {
    showChatPendingDialog(payload.sessionId, payload.peerName, _router);
  });

  // Cleanup on unload
  window.addEventListener('unload', () => {
    unsubDevices();
    unsubStarted();
    unsubProgress();
    unsubComplete();
    unsubError();
    unsubIncoming();
    unsubSendQueue();
    unsubClipboard();
    unsubPaused();
    unsubChatMessage();
    unsubChatStatus();
    unsubChatSession();
    unsubChatInvite();
    unsubChatPending();
  });
}

function showChatInviteDialog(
  payload: import('../../shared/ipc/ChatIpcContracts').ChatInvitePayload,
  router: Router,
): void {
  const dialogMount = document.getElementById('dialog-mount');
  if (!dialogMount) return;
  const dialog = new ChatInviteDialog(payload, router);
  dialog.mount(dialogMount);
}

function showChatPendingDialog(
  sessionId: string,
  peerName: string,
  router: Router,
): void {
  const dialogMount = document.getElementById('dialog-mount');
  if (!dialogMount) return;
  const dialog = new ChatPendingDialog(sessionId, peerName, router);
  dialog.mount(dialogMount);
}
