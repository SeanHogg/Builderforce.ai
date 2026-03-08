/**
 * API client for api.builderforce.ai app endpoints:
 * Brain (chats, messages), Claws (list, register).
 * Uses tenant JWT from auth.
 */

import { getStoredTenantToken } from './auth';
import { AUTH_API_URL } from './auth';

function authHeaders(): Record<string, string> {
  const token = getStoredTenantToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${AUTH_API_URL}${path}`, {
    ...opts,
    headers: { ...authHeaders(), ...(opts.headers as Record<string, string>) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || res.statusText || 'Request failed');
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Brain (Brain Storm)
// ---------------------------------------------------------------------------

export interface BrainChat {
  id: number;
  title: string;
  projectId: number | null;
  /** Where the chat was created: 'brainstorm' | 'ide' | 'project'. Tells the page which tools to load. */
  origin?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BrainMessage {
  id: number;
  role: string;
  content: string;
  metadata: string | null;
  seq: number;
  createdAt: string;
}

export const brain = {
  listChats: (params?: { projectId?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.projectId) q.set('projectId', params.projectId);
    if (params?.limit != null) q.set('limit', String(params.limit));
    if (params?.offset != null) q.set('offset', String(params.offset));
    const query = q.toString();
    return request<{ chats: BrainChat[] }>(`/api/brain/chats${query ? `?${query}` : ''}`).then((r) => r.chats);
  },

  createChat: (body: { title?: string; projectId?: number | null }) =>
    request<BrainChat>('/api/brain/chats', { method: 'POST', body: JSON.stringify(body) }),

  getChat: (id: number) => request<BrainChat>(`/api/brain/chats/${id}`),

  updateChat: (id: number, body: { title?: string; projectId?: number | null }) =>
    request<BrainChat>(`/api/brain/chats/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteChat: (id: number) =>
    request<{ archived: boolean }>(`/api/brain/chats/${id}`, { method: 'DELETE' }),

  /** Summarize chat and store summary on the chat. Returns { summary } or { error }. */
  summarizeChat: (chatId: number) =>
    request<{ summary: string } | { error: string }>(`/api/brain/chats/${chatId}/summarize`, { method: 'POST' }),

  getMessages: (chatId: number, limit?: number) => {
    const q = limit != null ? `?limit=${limit}` : '';
    return request<{ messages: BrainMessage[] }>(`/api/brain/chats/${chatId}/messages${q}`).then((r) => r.messages);
  },

  sendMessages: (chatId: number, messages: Array<{ role: string; content: string; metadata?: string }>) =>
    request<{ messages: BrainMessage[] }>(`/api/brain/chats/${chatId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ messages }),
    }).then((r) => r.messages),

  /** Set thumbs up/down on a message. feedback: 'up' | 'down' | null. */
  setMessageFeedback: (messageId: number, feedback: 'up' | 'down' | null) =>
    request<{ ok: boolean }>(`/api/brain/messages/${messageId}/feedback`, {
      method: 'PATCH',
      body: JSON.stringify({ feedback }),
    }),

  /** Upload a file for use as an attachment in chat. Returns key, name, type. */
  upload: async (file: File): Promise<{ key: string; name: string; type: string }> => {
    const token = getStoredTenantToken();
    const form = new FormData();
    form.append('file', file);
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${AUTH_API_URL}/api/brain/upload`, {
      method: 'POST',
      headers,
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || res.statusText || 'Upload failed');
    }
    const data = (await res.json()) as { key: string; name: string; type: string };
    return data;
  },

  /** URL to view/download an uploaded file by key. */
  uploadUrl: (key: string) => `${AUTH_API_URL}/api/brain/uploads/${key}`,
};

/** OpenAI-compatible chat completion (uses tenant JWT for billing). */
export async function llmChat(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: { temperature?: number; maxTokens?: number }
): Promise<{ content: string }> {
  const res = await fetch(`${AUTH_API_URL}/llm/v1/chat/completions`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      model: 'openai/gpt-4o-mini',
      messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 4096,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message || res.statusText || 'LLM request failed');
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim() ?? '';
  return { content };
}

// ---------------------------------------------------------------------------
// Claws (Workforce / Agent registration)
// ---------------------------------------------------------------------------

export interface Claw {
  id: number;
  name: string;
  tenantId: number;
  apiKeyHash?: string;
  connectedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClawRegistration extends Claw {
  apiKey: string;
}

export const claws = {
  list: () => request<{ claws: Claw[] }>('/api/claws').then((r) => r.claws),

  register: (name: string) =>
    request<{ claw: Claw; apiKey: string }>('/api/claws', {
      method: 'POST',
      body: JSON.stringify({ name: name.trim() }),
    }).then((r) => ({ ...r.claw, apiKey: r.apiKey } as ClawRegistration)),
};
