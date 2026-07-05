'use client';

/**
 * Guest (logged-out) wiring for the embeddable brain core.
 *
 * Mirrors `runtime.ts` (the authed config) but for a visitor with NO account:
 *   • transport → the same gateway, but authenticated with a short-lived GUEST
 *     token (getStoredGuestToken) instead of the tenant JWT. The gateway detects
 *     the `bfguest_` prefix and meters the call against a tiny anonymous cap.
 *   • persistence → a LOCAL, in-browser store (localStorage). Guest chats never
 *     hit `/api/brain` (which requires a tenant); they live only in the browser
 *     until the visitor signs up. This is the "usage-cap wall" model: try it
 *     here, sign up free to keep going and to persist your work.
 *
 * Kept as a module constant so BrainProvider's memoized runtime stays stable.
 */

import type { BrainConfig, BrainPersistenceAdapter, BrainChat, BrainMessage } from '@seanhogg/builderforce-brain-embedded';
import { AUTH_API_URL } from '../auth';
import { parseLlmError } from '../builderforceApi';
import { getModality } from '../modality';
import { getStoredGuestToken, clearGuestToken } from '../guestChatApi';

const CHATS_KEY = 'bf_guest_chats';
const MSGS_KEY = (chatId: number) => `bf_guest_msgs:${chatId}`;
const SEQ_KEY = 'bf_guest_seq';

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

/** Monotonic id source for local chats + messages (never collides across the two). */
function nextId(): number {
  const n = Number(readJson<number>(SEQ_KEY, 1));
  const next = Number.isFinite(n) ? n + 1 : Date.now();
  writeJson(SEQ_KEY, next);
  return next;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * A localStorage-backed persistence adapter — the whole point is that a guest's
 * conversation is ephemeral and client-only. Implements the full adapter surface
 * so the package hooks work unchanged; uploads are unsupported for guests.
 */
const guestPersistence: BrainPersistenceAdapter = {
  async listChats() {
    return readJson<BrainChat[]>(CHATS_KEY, []);
  },
  async getChat(id) {
    const chat = readJson<BrainChat[]>(CHATS_KEY, []).find((c) => c.id === id);
    if (!chat) throw new Error('Chat not found');
    return chat;
  },
  async createChat(body) {
    const chats = readJson<BrainChat[]>(CHATS_KEY, []);
    const chat: BrainChat = {
      id: nextId(),
      title: body.title ?? 'New chat',
      projectId: body.projectId ?? null,
      origin: 'guest',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    writeJson(CHATS_KEY, [chat, ...chats]);
    return chat;
  },
  async updateChat(id, body) {
    const chats = readJson<BrainChat[]>(CHATS_KEY, []);
    const next = chats.map((c) => (c.id === id ? { ...c, ...('title' in body ? { title: body.title! } : {}), updatedAt: nowIso() } : c));
    writeJson(CHATS_KEY, next);
    return next.find((c) => c.id === id)!;
  },
  async deleteChat(id) {
    const chats = readJson<BrainChat[]>(CHATS_KEY, []).filter((c) => c.id !== id);
    writeJson(CHATS_KEY, chats);
    if (typeof window !== 'undefined') { try { window.localStorage.removeItem(MSGS_KEY(id)); } catch { /* ignore */ } }
    return {};
  },
  async summarizeChat(id) {
    const msgs = readJson<BrainMessage[]>(MSGS_KEY(id), []);
    const firstUser = msgs.find((m) => m.role === 'user');
    const summary = (firstUser?.content ?? 'Chat').slice(0, 60);
    return { summary };
  },
  async getMessages(chatId) {
    return readJson<BrainMessage[]>(MSGS_KEY(chatId), []);
  },
  async sendMessages(chatId, messages) {
    const existing = readJson<BrainMessage[]>(MSGS_KEY(chatId), []);
    let seq = existing.length;
    const created: BrainMessage[] = messages.map((m) => ({
      id: nextId(),
      role: m.role,
      content: m.content,
      metadata: m.metadata ?? null,
      seq: seq++,
      createdAt: nowIso(),
    }));
    writeJson(MSGS_KEY(chatId), [...existing, ...created]);
    return created;
  },
  async setMessageFeedback() {
    return {}; // no feedback capture for guests
  },
  async upload() {
    throw new Error('Sign up to attach files.');
  },
  uploadUrl() {
    return '';
  },
};

export const guestBrainConfig: BrainConfig = {
  transport: {
    baseUrl: AUTH_API_URL,
    getToken: getStoredGuestToken,
    // A guest 401 means the token lapsed — drop it so the next send re-mints.
    onUnauthorized: () => { clearGuestToken(); },
    mapError: parseLlmError,
  },
  persistence: guestPersistence,
  resolveSystemPrompt: (modality) => getModality(modality).brainSystemPrompt,
};
