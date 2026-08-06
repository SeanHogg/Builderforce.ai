import type { Env } from '../../env';

/**
 * The ONE way the Worker talks to a {@link GuestRoomDO}.
 *
 * Two call sites need shared-guest-room state — the public room routes
 * (guestRoutes) and the LLM gateway's anonymous handler (llmRoutes, which charges
 * the room's COMBINED turn allowance). Both go through here so the DO's internal
 * URL shape, its "room is gone" contract, and the disabled-binding fallback are
 * defined once instead of drifting between them.
 *
 * Every helper returns `null` when the room does not exist / has expired / the DO
 * binding is unset, so callers branch on one thing: did I get state back?
 */

/** A room participant as shown to the people in it. */
export interface GuestRoomParticipant {
  name: string;
  isHost: boolean;
  joinedAt: string;
}

/** Which surface a room was opened from — decides where its invite link points. */
export type GuestRoomSurface = 'chat' | 'canvas';

/** Public room state — what a participant's UI renders. */
export interface GuestRoomState {
  code: string;
  title: string;
  surface: GuestRoomSurface;
  createdAt: string;
  expiresAt: string;
  isHost: boolean;
  participants: GuestRoomParticipant[];
  maxParticipants: number;
  /** Turns the room has spent together today. */
  used: number;
  /** Turns the room has LEFT today — combined, not per person. */
  remaining: number;
  limit: number;
}

/** One transcript entry in the shared room. */
export interface GuestRoomMessage {
  id: number;
  role: string;
  content: string;
  metadata: string | null;
  seq: number;
  createdAt: string;
}

/** The verdict on one turn against the room's combined allowance. */
export interface GuestRoomTurnResult {
  allowed: boolean;
  alreadyConsumed: boolean;
  used: number;
  remaining: number;
  limit: number;
  reason?: 'room';
}

/** True when shared guest rooms are available (the DO binding is configured). */
export function guestRoomsEnabled(env: Env): boolean {
  return !!env.GUEST_ROOM;
}

function stub(env: Env, code: string): DurableObjectStub | null {
  const ns = env.GUEST_ROOM;
  if (!ns) return null;
  return ns.get(ns.idFromName(`guestroom:${code}`));
}

async function call<T>(env: Env, code: string, path: string, init?: RequestInit): Promise<T | null> {
  const room = stub(env, code);
  if (!room) return null;
  const res = await room.fetch(`https://guest-room${path}`, {
    method: init?.body ? 'POST' : 'GET',
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  }).catch(() => null);
  if (!res || !res.ok) return null;
  return (await res.json().catch(() => null)) as T | null;
}

/**
 * Create the room if it doesn't exist and admit the caller as its host, or just
 * admit them when it already exists. Null when the room is full or unavailable.
 */
export async function openGuestRoom(
  env: Env, code: string, visitorId: string, name: string, title: string, surface: GuestRoomSurface,
): Promise<GuestRoomState | null> {
  const out = await call<{ state: GuestRoomState }>(env, code, '/open', {
    body: JSON.stringify({ code, visitorId, name, title, surface }),
  });
  return out?.state ?? null;
}

/** Admit an invited guest. Null when the room is gone or already full. */
export async function joinGuestRoom(
  env: Env, code: string, visitorId: string, name: string,
): Promise<GuestRoomState | null> {
  const out = await call<{ state: GuestRoomState }>(env, code, '/join', {
    body: JSON.stringify({ visitorId, name }),
  });
  return out?.state ?? null;
}

export async function guestRoomState(env: Env, code: string, visitorId: string): Promise<GuestRoomState | null> {
  const out = await call<{ state: GuestRoomState }>(env, code, `/state?visitorId=${encodeURIComponent(visitorId)}`);
  return out?.state ?? null;
}

/**
 * Check (`commit:false`) or charge (`commit:true`) one turn against the room's
 * combined allowance. Idempotent per `turnId`, so the tool-loop continuations of
 * a single user submit cost the room one turn.
 */
export async function guestRoomTurn(
  env: Env, code: string, turnId: string, commit: boolean,
): Promise<GuestRoomTurnResult | null> {
  return call<GuestRoomTurnResult>(env, code, '/turn', { body: JSON.stringify({ turnId, commit }) });
}

export async function guestRoomMessages(env: Env, code: string): Promise<GuestRoomMessage[] | null> {
  const out = await call<{ messages: GuestRoomMessage[] }>(env, code, '/messages');
  return out?.messages ?? null;
}

export async function appendGuestRoomMessages(
  env: Env, code: string, messages: Array<{ role: string; content: string; metadata?: string | null }>,
): Promise<GuestRoomMessage[] | null> {
  const out = await call<{ created: GuestRoomMessage[] }>(env, code, '/messages', {
    method: 'POST', body: JSON.stringify({ messages }),
  });
  return out?.created ?? null;
}

export async function setGuestRoomTitle(env: Env, code: string, title: string): Promise<boolean> {
  return !!(await call<{ ok: boolean }>(env, code, '/title', { body: JSON.stringify({ title }) }));
}

export async function leaveGuestRoom(env: Env, code: string, visitorId: string): Promise<void> {
  await call<{ ok: boolean }>(env, code, '/leave', { body: JSON.stringify({ visitorId }) });
}

/**
 * The shared Creation Canvas board, as one opaque serialized snapshot. The Worker
 * never interprets it — the shape belongs to the client that writes it, and a
 * server-side copy of that schema would be a second definition to keep in step.
 */
export async function guestRoomCanvas(env: Env, code: string): Promise<{ snapshot: string | null; updatedAt: string | null } | null> {
  return call<{ snapshot: string | null; updatedAt: string | null }>(env, code, '/canvas');
}

/** Store the board. `stored:false` means it outgrew the slot — tell the writer. */
export async function putGuestRoomCanvas(
  env: Env, code: string, snapshot: string,
): Promise<{ stored: boolean; reason?: string; limit?: number } | null> {
  return call<{ stored: boolean; reason?: string; limit?: number }>(env, code, '/canvas', {
    method: 'POST', body: JSON.stringify({ snapshot }),
  });
}

/** The transcript a just-signed-up participant is entitled to keep. */
export interface GuestRoomClaim {
  /** True when this visitor already converted the room — do not fork a second chat. */
  alreadyClaimed: boolean;
  title: string;
  messages: GuestRoomMessage[];
}

/**
 * Claim the room's transcript for a participant who has just created an account.
 * Null when the room has expired, the DO is unavailable, or the caller was never
 * in it — a tenant JWT proves who someone is, not that they were ever a member,
 * so the room is the one that decides.
 */
export async function claimGuestRoom(env: Env, code: string, visitorId: string): Promise<GuestRoomClaim | null> {
  return call<GuestRoomClaim>(env, code, '/claim', { body: JSON.stringify({ visitorId }) });
}

/**
 * Hand a WebSocket upgrade straight to the room DO, which verifies the guest
 * token's signed `rid` itself before relaying anything. Mirrors `relayToRoom`,
 * but the room — not the route — owns membership, because a guest has no session
 * the route middleware could check.
 */
export async function relayToGuestRoom(env: Env, code: string, request: Request): Promise<Response> {
  const room = stub(env, code);
  if (!room) return new Response('Realtime unavailable', { status: 503 });
  return room.fetch(request);
}
