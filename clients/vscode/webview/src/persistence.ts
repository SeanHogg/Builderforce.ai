/**
 * The VS Code webview's Brain persistence — a thin `/api/brain` REST client, the
 * SAME endpoints the web app's `brain` client uses. The webview talks to the API
 * directly (CORS allows the `vscode-webview://` origin), so a VS Code chat is the
 * exact same server-side conversation as on the web: one unified brain.
 */

import type { BrainPersistenceAdapter, BrainChat, BrainMessage } from '@seanhogg/builderforce-brain-embedded';
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
    sendMessages: (id, msgs) =>
      req<{ messages: BrainMessage[] }>(`/api/brain/chats/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ messages: msgs }),
      }).then((r) => r.messages),
    setMessageFeedback: (mid, fb) =>
      req(`/api/brain/messages/${mid}/feedback`, { method: 'PATCH', body: JSON.stringify({ feedback: fb }) }),
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
