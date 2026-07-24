/**
 * The VS Code webview's Brain persistence — a thin `/api/brain` REST client, the
 * SAME endpoints the web app's `brain` client uses. The webview talks to the API
 * directly (CORS allows the `vscode-webview://` origin), so a VS Code chat is the
 * exact same server-side conversation as on the web: one unified brain.
 */

import type { BrainPersistenceAdapter, BrainChat, BrainMessage, EvermindLearnOutcome } from '@seanhogg/builderforce-brain-embedded';
import { attachEvermindLearn, subscribeToChatMessages } from '@seanhogg/builderforce-brain-embedded';
import { authedFetch } from './authedFetch';

export function createPersistence(
  baseUrl: string,
  getToken: () => string | null,
  onUnauthorized: () => void,
): BrainPersistenceAdapter {
  const req = authedFetch(baseUrl, getToken, onUnauthorized);

  return {
    listChats: (p) => {
      const q = new URLSearchParams();
      if (p?.projectId) q.set('projectId', p.projectId);
      if (p?.limit != null) q.set('limit', String(p.limit));
      if (p?.offset != null) q.set('offset', String(p.offset));
      const s = q.toString();
      return req<{ chats: BrainChat[] }>(`/api/brain/chats${s ? `?${s}` : ''}`).then((r) => r.chats);
    },
    getChat: (id) => req<BrainChat>(`/api/brain/chats/${id}`),
    createChat: (b) => req<BrainChat>('/api/brain/chats', { method: 'POST', body: JSON.stringify(b) }),
    updateChat: (id, b) => req<BrainChat>(`/api/brain/chats/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
    deleteChat: (id) => req(`/api/brain/chats/${id}`, { method: 'DELETE' }),
    summarizeChat: (id) => req(`/api/brain/chats/${id}/summarize`, { method: 'POST' }),
    getMessages: (id, limit) =>
      req<{ messages: BrainMessage[] }>(`/api/brain/chats/${id}/messages${limit != null ? `?limit=${limit}` : ''}`).then((r) => r.messages),
    subscribeMessages: (id, onChanged) => subscribeToChatMessages(baseUrl, getToken, id, onChanged),
    // Reading a chat here clears its unread badge on the web too — one unified
    // server conversation. Best-effort; the run loop never blocks on it.
    markChatRead: (id, seq) =>
      req(`/api/brain/chats/${id}/read`, { method: 'POST', body: JSON.stringify(seq != null ? { seq } : {}) }),
    sendMessages: (id, msgs) =>
      req<{ messages: BrainMessage[]; evermindLearn?: EvermindLearnOutcome }>(`/api/brain/chats/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ messages: msgs }),
        // Attach the server's TRUTHFUL learn-gate outcome (transient) to the assistant
        // turn(s) this POST persisted, so the run loop renders a learn step when the
        // server contributed — and an EXPLAINED skip step (with reason) when it did not.
        // WITHOUT this the VSIX dropped the outcome and every turn was silent about
        // learning, leaving "Connected, yet nothing learned" an unexplained mystery.
      }).then((r) => attachEvermindLearn(r.messages, r.evermindLearn)),
    setMessageFeedback: (mid, fb) =>
      req(`/api/brain/messages/${mid}/feedback`, { method: 'PATCH', body: JSON.stringify({ feedback: fb }) }),
    requestAgentReply: (id, input) =>
      req<{ message: BrainMessage }>(`/api/brain/chats/${id}/agent-reply`, {
        method: 'POST',
        body: JSON.stringify(input),
      }).then((r) => r.message),
    upload: async (file) => {
      const token = getToken();
      const form = new FormData();
      form.append('file', file);
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${baseUrl}/api/brain/upload`, { method: 'POST', headers, body: form });
      if (res.status === 401) onUnauthorized();
      if (!res.ok) throw new Error((await res.text().catch(() => '')) || 'Upload failed');
      return (await res.json()) as { key: string; name: string; type: string };
    },
    uploadUrl: (key) => `${baseUrl}/api/brain/uploads/${key}`,
    signedUploadUrl: async (key) => {
      const { exp, sig } = await req<{ exp: number; sig: string }>('/api/brain/uploads/sign', {
        method: 'POST',
        body: JSON.stringify({ key }),
      });
      return `${baseUrl}/api/brain-files/${key}?exp=${exp}&sig=${encodeURIComponent(sig)}`;
    },
  };
}
