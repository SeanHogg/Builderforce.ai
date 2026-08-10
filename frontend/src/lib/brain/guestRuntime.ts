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
 * …UNLESS the visitor is in a shared ROOM. Then the conversation belongs to
 * everyone in it, not to one browser, so persistence switches to the room's
 * Durable Object (see guestRoomApi): the same hooks, the same transport, a
 * different store. The switch is decided PER CALL from the active room code
 * rather than by handing BrainProvider a second config — the provider memoizes
 * its runtime off the config object, so swapping configs mid-session would
 * remount the conversation and lose the in-flight turn.
 *
 * Kept as a module constant so BrainProvider's memoized runtime stays stable.
 */

import type { BrainConfig, BrainPersistenceAdapter, BrainChat, BrainMessage } from '@seanhogg/builderforce-brain-embedded';
import { AUTH_API_URL } from '../auth';
import { parseLlmError } from '../builderforceApi';
import { getModality } from '../modality';
import { getStoredGuestToken, clearGuestToken } from '../guestChatApi';
import {
  getActiveGuestRoom, getGuestDisplayName, fetchGuestRoomMessages, appendGuestRoomMessages,
  fetchGuestRoomState, renameGuestRoom, type GuestRoomMessage,
} from '../guestRoomApi';

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

/**
 * The single chat id a shared room exposes. A room IS one conversation — there is
 * no chat list to switch between — so the id is a constant the adapter maps onto
 * the room's transcript.
 */
export const GUEST_ROOM_CHAT_ID = 1;

/** Author attribution rides in message metadata so bubbles can be named. */
const AUTHOR_META_KEY = 'guestAuthor';

/** Read the display name a room message was written under, if any. */
export function guestMessageAuthor(metadata: string | null | undefined): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    const name = parsed[AUTHOR_META_KEY];
    return typeof name === 'string' && name ? name : null;
  } catch {
    return null;
  }
}

/** Stamp the sender's display name onto a message's metadata (preserving the rest). */
function withAuthor(metadata: string | null | undefined, name: string): string | null {
  if (!name) return metadata ?? null;
  let base: Record<string, unknown> = {};
  if (metadata) {
    try { base = JSON.parse(metadata) as Record<string, unknown>; } catch { base = {}; }
  }
  return JSON.stringify({ ...base, [AUTHOR_META_KEY]: name });
}

function toBrainMessage(m: GuestRoomMessage): BrainMessage {
  return {
    id: m.id,
    role: m.role as BrainMessage['role'],
    content: m.content,
    metadata: m.metadata,
    seq: m.seq,
    createdAt: m.createdAt,
  };
}

function roomChat(title: string, createdAt: string): BrainChat {
  return {
    id: GUEST_ROOM_CHAT_ID,
    title,
    projectId: null,
    origin: 'guest',
    createdAt,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Persistence for a SHARED guest room: the transcript lives in the room's Durable
 * Object so every participant reads and writes the same list. Only the person who
 * sent a turn persists it (and the reply it produced); everyone else learns about
 * it from the room's `changed` frame and refetches — which is exactly what the
 * localStorage adapter does for a solo guest, one browser at a time.
 */
const guestRoomPersistence: BrainPersistenceAdapter = {
  async listChats() {
    const code = getActiveGuestRoom();
    if (!code) return [];
    const state = await fetchGuestRoomState(code);
    return state ? [roomChat(state.title, state.createdAt)] : [];
  },
  async getChat() {
    const code = getActiveGuestRoom();
    const state = code ? await fetchGuestRoomState(code) : null;
    if (!state) throw new Error('This shared session has ended.');
    return roomChat(state.title, state.createdAt);
  },
  async createChat() {
    // A room already IS the conversation — "new chat" resolves to it rather than
    // forking a second transcript only the creator would see.
    const code = getActiveGuestRoom();
    const state = code ? await fetchGuestRoomState(code) : null;
    return roomChat(state?.title ?? 'Guest session', state?.createdAt ?? new Date().toISOString());
  },
  async updateChat(_id, body) {
    const code = getActiveGuestRoom();
    if (code && body.title) await renameGuestRoom(code, body.title);
    const state = code ? await fetchGuestRoomState(code) : null;
    return roomChat(state?.title ?? body.title ?? 'Guest session', state?.createdAt ?? new Date().toISOString());
  },
  async deleteChat() {
    // Nobody may delete a conversation other people are in; leaving is the exit
    // (see guestRoomApi.leaveGuestRoom), and the room expires on its own.
    return {};
  },
  async summarizeChat() {
    const code = getActiveGuestRoom();
    const messages = code ? await fetchGuestRoomMessages(code) : null;
    const firstUser = messages?.find((m) => m.role === 'user');
    return { summary: (firstUser?.content ?? 'Shared session').slice(0, 60) };
  },
  async getMessages() {
    const code = getActiveGuestRoom();
    if (!code) return [];
    const messages = await fetchGuestRoomMessages(code);
    return (messages ?? []).map(toBrainMessage);
  },
  async sendMessages(_chatId, messages) {
    const code = getActiveGuestRoom();
    if (!code) throw new Error('This shared session has ended.');
    const name = getGuestDisplayName();
    const created = await appendGuestRoomMessages(code, messages.map((m) => ({
      role: m.role,
      content: m.content,
      // Only a human turn carries a name — the Brain is the same voice for everyone.
      metadata: m.role === 'user' ? withAuthor(m.metadata, name) : (m.metadata ?? null),
    })));
    if (!created) throw new Error('This shared session has ended.');
    return created.map(toBrainMessage);
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

/**
 * Dispatch every persistence call to the store that owns the visitor's CURRENT
 * conversation: the shared room when they are in one, their own browser when they
 * are not. Resolved per call (not per mount) so joining or leaving a room takes
 * effect on the next read without rebuilding the runtime.
 */
function activeGuestPersistence(): BrainPersistenceAdapter {
  return getActiveGuestRoom() ? guestRoomPersistence : guestPersistence;
}

const dispatchingGuestPersistence: BrainPersistenceAdapter = {
  listChats: (...args) => activeGuestPersistence().listChats(...args),
  getChat: (...args) => activeGuestPersistence().getChat(...args),
  createChat: (...args) => activeGuestPersistence().createChat(...args),
  updateChat: (...args) => activeGuestPersistence().updateChat(...args),
  deleteChat: (...args) => activeGuestPersistence().deleteChat(...args),
  summarizeChat: (...args) => activeGuestPersistence().summarizeChat(...args),
  getMessages: (...args) => activeGuestPersistence().getMessages(...args),
  sendMessages: (...args) => activeGuestPersistence().sendMessages(...args),
  setMessageFeedback: (...args) => activeGuestPersistence().setMessageFeedback(...args),
  upload: (...args) => activeGuestPersistence().upload(...args),
  uploadUrl: (...args) => activeGuestPersistence().uploadUrl(...args),
};

export const guestBrainConfig: BrainConfig = {
  transport: {
    baseUrl: AUTH_API_URL,
    getToken: getStoredGuestToken,
    // A guest 401 means the token lapsed — drop it so the next send re-mints.
    onUnauthorized: () => { clearGuestToken(); },
    mapError: parseLlmError,
  },
  persistence: dispatchingGuestPersistence,
  resolveSystemPrompt: (modality) => getModality(modality).brainSystemPrompt,
};
