import { apiRequest } from './apiClient';

/**
 * The direct-message client — `/api/messages`.
 *
 * Deliberately thin: the hub re-fetches on a `changed` frame rather than
 * mutating a local cache, which is the same contract poker, retros and the board
 * use. It means a message sent from another tab, another device or by the other
 * person all arrive by exactly one path.
 */

export interface MessageParticipant {
  userId: string;
  name: string | null;
  email: string;
  isSuperadmin: boolean;
}

export interface MessageThread {
  id: string;
  subject: string;
  lastMessageAtISO: string | null;
  messageCount: number;
  unread: number;
  participants: MessageParticipant[];
}

export interface DirectMessage {
  id: number;
  threadId: string;
  authorUserId: string;
  authorName: string | null;
  body: string;
  createdAtISO: string;
  mine: boolean;
}

export const messagesApi = {
  contacts: () => apiRequest<{ contacts: MessageParticipant[] }>('/api/messages/contacts', { auth: 'web' }),
  threads: () => apiRequest<{ threads: MessageThread[]; unread: number }>('/api/messages/threads', { auth: 'web' }),
  open: (userId: string, subject = '') => apiRequest<MessageThread>('/api/messages/threads', {
    method: 'POST', auth: 'web', body: JSON.stringify({ userId, subject }),
  }),
  messages: (threadId: string) => apiRequest<{ messages: DirectMessage[] }>(
    `/api/messages/threads/${encodeURIComponent(threadId)}`, { auth: 'web' },
  ),
  send: (threadId: string, body: string) => apiRequest<DirectMessage>(
    `/api/messages/threads/${encodeURIComponent(threadId)}`,
    { method: 'POST', auth: 'web', body: JSON.stringify({ body }) },
  ),
  markRead: (threadId: string) => apiRequest<{ ok: true }>(
    `/api/messages/threads/${encodeURIComponent(threadId)}/read`, { method: 'POST', auth: 'web' },
  ),
};

/** The websocket path for one conversation (append without polling). */
export const messageThreadWsPath = (threadId: string): string =>
  `/api/messages/threads/${encodeURIComponent(threadId)}/ws`;

/** The websocket path for THIS person — every conversation reports here, so the
 *  top-bar badge lights up with nothing open. */
export const MESSAGE_INBOX_WS_PATH = '/api/messages/ws';
