'use client';

/**
 * Shared guest ROOMS — the free, logged-out session a visitor can invite other
 * people into.
 *
 * A solo guest chat is one browser talking to the Brain with a tiny per-visitor
 * allowance (see guestChatApi). A room is the same thing with more chairs: one
 * transcript everyone reads and writes, one COMBINED turn allowance (the same ten
 * turns a lone guest gets, spent together — inviting people is not a way to get
 * more), and an optional camera meeting between the participants.
 *
 * Membership is carried by the guest token itself: joining swaps the browser's
 * guest token for one whose SIGNED payload names the room, so every LLM call it
 * makes is metered against the room. Which is why the room code and the token are
 * stored and cleared together here — a token without its room, or a room without
 * its token, is a state the rest of the app should never have to reason about.
 */

import { apiRequestStream } from './apiClient';
import { apiSocketUrl } from './apiSocket';
import { getVisitorId, getExistingVisitorId, getFirstTouch } from './visitor';
import { storeGuestToken, clearGuestToken, getStoredGuestToken, mintGuestSession } from './guestChatApi';
import type { MediaRoomTransport } from './useMediaRoom';

const ROOM_CODE_KEY = 'bf_guest_room';
const ROOM_NAME_KEY = 'bf_guest_room_name';

export interface GuestRoomParticipant {
  name: string;
  isHost: boolean;
  joinedAt: string;
}

/**
 * Which surface a room was opened from. It decides where the invite link points —
 * share a canvas and your invitee must land on the canvas, not in an empty chat.
 */
export type GuestRoomSurface = 'chat' | 'canvas';

export interface GuestRoomState {
  code: string;
  title: string;
  surface: GuestRoomSurface;
  createdAt: string;
  /** When the room (and its transcript) disappears. */
  expiresAt: string;
  isHost: boolean;
  participants: GuestRoomParticipant[];
  maxParticipants: number;
  /** Turns the whole room has spent today. */
  used: number;
  /** Turns the whole room has LEFT today — combined, not per person. */
  remaining: number;
  limit: number;
}

export interface GuestRoomMessage {
  id: number;
  role: string;
  content: string;
  metadata: string | null;
  seq: number;
  createdAt: string;
}

/** Errors a room entry can fail with, mapped to what the UI should say. */
export type GuestRoomError = 'unavailable' | 'gone' | 'network';

// ── Local room identity ──────────────────────────────────────────────────────

/** The room this browser is currently in, or null when chatting solo. */
export function getActiveGuestRoom(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(ROOM_CODE_KEY);
  } catch {
    return null;
  }
}

/** The display name this visitor joined as (they can change it before joining). */
export function getGuestDisplayName(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(ROOM_NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setGuestDisplayName(name: string): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(ROOM_NAME_KEY, name.slice(0, 40)); } catch { /* private mode */ }
}

function setActiveGuestRoom(code: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (code) window.localStorage.setItem(ROOM_CODE_KEY, code);
    else window.localStorage.removeItem(ROOM_CODE_KEY);
  } catch { /* private mode — the room lasts this page load */ }
}

/**
 * Leave the room locally: drop the room-bound token AND the room code together,
 * so the next send re-mints a plain solo guest token instead of replaying a token
 * for a room this browser is no longer in.
 */
export function clearActiveGuestRoom(): void {
  setActiveGuestRoom(null);
  clearGuestToken();
}

/**
 * The public link to share, routed to the surface the room was opened from:
 * a chat room lands invitees in the guest chat, a canvas room on a canvas bound
 * to that room. Built from the current origin so it works on any host.
 */
export function guestRoomInviteUrl(code: string, surface: GuestRoomSurface = 'chat'): string {
  if (typeof window === 'undefined') return '';
  const path = surface === 'canvas' ? '/create/new' : '/brainstorm';
  return `${window.location.origin}${path}?room=${encodeURIComponent(code)}`;
}

// ── Room API ─────────────────────────────────────────────────────────────────

interface EntryResponse {
  token: string;
  expiresInSeconds: number;
  state: GuestRoomState;
}

/** Adopt a room-bound token + code as this browser's guest identity. */
function adopt(data: EntryResponse): GuestRoomState {
  storeGuestToken(data.token, data.expiresInSeconds);
  setActiveGuestRoom(data.state.code);
  return data.state;
}

/** Open a new shared session. The caller is its host. */
export async function createGuestRoom(
  name: string, title?: string, surface: GuestRoomSurface = 'chat',
): Promise<GuestRoomState | GuestRoomError> {
  const visitorId = getVisitorId();
  if (!visitorId) return 'network';
  try {
    const res = await apiRequestStream('/api/guest/rooms', {
      method: 'POST',
      auth: 'none',
      body: JSON.stringify({ visitorId, name, title, surface, touch: getFirstTouch() }),
      expectedErrors: [400, 401, 403, 404, 410, 429, 503],
    });
    if (!res.ok) return res.status === 503 ? 'unavailable' : 'gone';
    return adopt((await res.json()) as EntryResponse);
  } catch {
    return 'network';
  }
}

/** Accept an invite. The link IS the credential — the room caps and expiry bound it. */
export async function joinGuestRoom(code: string, name: string): Promise<GuestRoomState | GuestRoomError> {
  const visitorId = getVisitorId();
  if (!visitorId) return 'network';
  try {
    const res = await apiRequestStream(`/api/guest/rooms/${encodeURIComponent(code)}/join`, {
      method: 'POST',
      auth: 'none',
      body: JSON.stringify({ visitorId, name, touch: getFirstTouch() }),
      expectedErrors: [400, 401, 403, 404, 410, 429, 503],
    });
    if (!res.ok) return res.status === 503 ? 'unavailable' : 'gone';
    return adopt((await res.json()) as EntryResponse);
  } catch {
    return 'network';
  }
}

/**
 * Ensure this browser holds a usable guest credential, minting one on demand.
 *
 * Room-aware on purpose: a guest in a shared session must be re-admitted to THAT
 * ROOM, not handed a fresh solo token. Minting a plain one would quietly move them
 * off the room's combined allowance and out of its relay, and the only symptom
 * would be that everyone else stopped seeing their work.
 */
export async function ensureGuestToken(): Promise<string | null> {
  const existing = getStoredGuestToken();
  if (existing) return existing;
  await refreshGuestCredentials();
  return getStoredGuestToken();
}

/**
 * Keep this browser's guest credentials alive.
 *
 * A guest token lasts an hour; a shared session — especially one with a meeting
 * running — routinely outlives that. When it lapses the transport silently has no
 * credential, and in a room that reads as being thrown out of the conversation. So
 * re-mint on a timer and on tab focus, taking the path that preserves identity:
 * re-joining a room is idempotent (the same visitorId keeps the same seat) and
 * returns a fresh ROOM-BOUND token, while a solo guest just re-mints a plain one.
 * Returns the refreshed room state when in a room.
 */
export async function refreshGuestCredentials(): Promise<GuestRoomState | null> {
  const code = getActiveGuestRoom();
  if (!code) {
    await mintGuestSession();
    return null;
  }
  const state = await joinGuestRoom(code, getGuestDisplayName());
  if (typeof state === 'string') {
    // The room is gone or full — stop replaying a token bound to it and fall back
    // to a solo session rather than leaving the browser stuck in a dead room.
    clearActiveGuestRoom();
    await mintGuestSession();
    return null;
  }
  return state;
}

/**
 * Authorized room request — the guest token IS the membership proof, so every
 * room call sends it as the Bearer. Returns null (never throws) when there is no
 * token yet or the request failed outright; callers treat that as "not in a live
 * room", which is the same branch they need for an expired one.
 */
async function roomRequest(path: string, init?: { method?: string; body?: string }): Promise<Response | null> {
  const token = getStoredGuestToken();
  if (!token) return null;
  try {
    return await apiRequestStream(path, {
      auth: 'none',
      method: init?.method,
      body: init?.body,
      headers: { Authorization: `Bearer ${token}` },
      expectedErrors: [400, 401, 403, 404, 410, 429, 503],
    });
  } catch {
    return null;
  }
}

/** Current room state (roster + the combined remaining turns). */
export async function fetchGuestRoomState(code: string): Promise<GuestRoomState | null> {
  const res = await roomRequest(`/api/guest/rooms/${encodeURIComponent(code)}`);
  if (!res?.ok) return null;
  const data = (await res.json()) as { state: GuestRoomState };
  return data.state;
}

export async function fetchGuestRoomMessages(code: string): Promise<GuestRoomMessage[] | null> {
  const res = await roomRequest(`/api/guest/rooms/${encodeURIComponent(code)}/messages`);
  if (!res?.ok) return null;
  const data = (await res.json()) as { messages: GuestRoomMessage[] };
  return data.messages;
}

export async function appendGuestRoomMessages(
  code: string,
  messages: Array<{ role: string; content: string; metadata?: string | null }>,
): Promise<GuestRoomMessage[] | null> {
  const res = await roomRequest(`/api/guest/rooms/${encodeURIComponent(code)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ messages }),
  });
  if (!res?.ok) return null;
  const data = (await res.json()) as { created: GuestRoomMessage[] };
  return data.created;
}

/**
 * The shared Creation Canvas board, as one opaque serialized snapshot.
 *
 * Sync is last-writer-wins on a debounce: whoever changed the board pushes it and
 * relays a `canvas` frame over their socket, and everyone else pulls. This slot is
 * what lets a LATE joiner see the board at all — a relay-only design would show
 * them an empty canvas until somebody happened to move something.
 */
export async function fetchGuestRoomCanvas(code: string): Promise<string | null> {
  const res = await roomRequest(`/api/guest/rooms/${encodeURIComponent(code)}/canvas`);
  if (!res?.ok) return null;
  const data = (await res.json()) as { snapshot: string | null };
  return data.snapshot;
}

/** Push the board. `false` means it outgrew the room's slot and did NOT sync. */
export async function pushGuestRoomCanvas(code: string, snapshot: string): Promise<boolean> {
  const res = await roomRequest(`/api/guest/rooms/${encodeURIComponent(code)}/canvas`, {
    method: 'POST',
    body: JSON.stringify({ snapshot }),
  });
  if (!res?.ok) return false;
  const data = (await res.json()) as { stored?: boolean };
  return !!data.stored;
}

export async function renameGuestRoom(code: string, title: string): Promise<void> {
  await roomRequest(`/api/guest/rooms/${encodeURIComponent(code)}/title`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

/** Tell the room this visitor is gone (frees their seat), then forget it locally. */
export async function leaveGuestRoom(code: string): Promise<void> {
  await roomRequest(`/api/guest/rooms/${encodeURIComponent(code)}/leave`, { method: 'POST' });
  clearActiveGuestRoom();
}

/**
 * Keep a shared session after signing up: copy the room's transcript into a real
 * Brain chat owned by the brand-new account, then stop being in the room locally.
 *
 * This runs with a TENANT token (the user has an account by now) and passes the
 * anonymous `visitorId` as the proof of membership — the room checks it against
 * its own roster, because being signed in says nothing about having been in a
 * given room. Returns the new chat id, or null when there was nothing to keep
 * (room expired, already claimed, or nobody said anything).
 */
export async function claimGuestRoomIntoAccount(): Promise<number | null> {
  const code = getActiveGuestRoom();
  const visitorId = getExistingVisitorId();
  if (!code || !visitorId) return null;
  try {
    const res = await apiRequestStream('/api/brain/chats/claim-guest-room', {
      method: 'POST',
      body: JSON.stringify({ code, visitorId }),
      expectedErrors: [400, 401, 403, 404, 410, 429, 503],
    });
    // Whether it converted or the room was already gone, this browser is done with
    // it — leaving the code behind would keep re-minting guest tokens for a room
    // the user has now outgrown.
    clearActiveGuestRoom();
    if (!res.ok) return null;
    const data = (await res.json()) as { claimed?: boolean; chat?: { id?: number } };
    return data.claimed && typeof data.chat?.id === 'number' ? data.chat.id : null;
  } catch {
    return null;
  }
}

// ── Live channels ────────────────────────────────────────────────────────────

/**
 * WebSocket URL for one of the room's two channels: `chat` (presence, transcript
 * invalidation, the combined turn counter) and `media` (WebRTC signaling for the
 * camera meeting). One room, one code, two fan-outs that never see each other's
 * frames.
 */
export function guestRoomSocketUrl(code: string, channel: 'chat' | 'media', token: string): string {
  return apiSocketUrl(`/api/guest/rooms/${encodeURIComponent(code)}/ws`, { channel, token });
}

/**
 * Guest wiring for the SHARED mesh-video hook (`useMediaRoom`) — the same hook
 * Standup and Planning use. Only auth and the two endpoints differ; there is no
 * guest-specific WebRTC anywhere. A module constant because the hook keys its
 * connect effect on this object's identity.
 */
export const guestMediaTransport: MediaRoomTransport = {
  getToken: getStoredGuestToken,
  signalingUrl: (code, token) => guestRoomSocketUrl(code, 'media', token),
  ice: async (mode) => {
    const code = getActiveGuestRoom();
    if (!code) return {};
    const res = await roomRequest(`/api/guest/rooms/${encodeURIComponent(code)}/ice?mode=${mode}`);
    if (!res?.ok) return {};
    return (await res.json()) as { iceServers?: unknown[] };
  },
};
