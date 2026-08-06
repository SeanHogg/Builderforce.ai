import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
import { Hono, type Context } from 'hono';
import type { Env, HonoEnv } from '../../env';
import { isValidVisitorId, type MarketingTouch } from '../../application/marketing/MarketingService';
import { GuestChatService } from '../../application/guest/GuestChatService';
import {
  signGuestToken, verifyGuestToken, guestBrainEnabled, isValidRoomCode, newRoomCode,
} from '../../application/guest/guestToken';
import {
  guestRoomsEnabled, openGuestRoom, joinGuestRoom, guestRoomState, guestRoomMessages,
  appendGuestRoomMessages, setGuestRoomTitle, leaveGuestRoom, relayToGuestRoom,
} from '../../application/guest/guestRoomClient';
import { GUEST_CHAT_LIMITS, GUEST_ROOM_LIMITS } from '../../domain/tenant/PlanLimits';
import { iceServers } from '../../application/meetings/iceServers';
import { applyMediaPrivacyMode } from '../../domain/meetings/mediaPrivacy';

/**
 * Guest (logged-out) Brain chat — PUBLIC session, usage and shared-ROOM routes.
 *
 * `POST /session` mints a short-lived guest token the browser sends to the Brain
 * gateway (`/llm/v1/chat/completions` detects the `bfguest_` prefix and meters
 * the call — see llmRoutes handleGuestChat). It also ensures a lead row exists so
 * the guest is tracked as an active lead and converts cleanly on sign-up. No
 * tenant data is touched; the opaque `visitorId` is the whole key.
 *
 * `POST /rooms` and `/rooms/:code/*` are the SHARED version of that session: a
 * guest opens a room, sends the link to whoever they want, and everyone in it
 * talks to the same Brain over one transcript — and can turn their camera on and
 * meet. A room token is the same guest token with the room code in its signed
 * payload, so the room's COMBINED turn allowance (the same ten turns one guest
 * gets, spent together) cannot be dodged by editing a request. Room state lives
 * only in the room's Durable Object and evaporates with it — no tenant, no rows.
 */
const GUEST_TOKEN_TTL_SECONDS = 3600;

/** The verified guest behind a room request. */
type GuestAuth = { visitorId: string; roomCode: string | null };

/** Body of `POST /rooms` (open) and `POST /rooms/:code/join`. */
interface RoomEntryBody {
  visitorId?: string;
  name?: string;
  title?: string;
  touch?: MarketingTouch;
}

/** Bearer header first, `?token=` second (WebSocket upgrades cannot set headers). */
function readGuestToken(c: Context<HonoEnv>): string {
  const header = c.req.header('Authorization') ?? '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return c.req.query('token') ?? '';
}

export function createGuestRoutes(guest: GuestChatService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  /** Resolve the caller's guest identity, requiring membership of `code` when given. */
  async function authenticate(c: Context<HonoEnv>, code?: string): Promise<GuestAuth | null> {
    const identity = await verifyGuestToken(readGuestToken(c), c.env.JWT_SECRET);
    if (!identity) return null;
    if (code && identity.roomCode !== code) return null;
    return identity;
  }

  // Mint a guest chat token + record the lead. Returns the token and the guest's
  // remaining daily allowance so the UI can show the "N left / sign up for more".
  router.post('/session', async (c) => {
    if (!guestBrainEnabled(c.env)) {
      return c.json({ error: 'Guest chat is disabled.', code: 'guest_brain_disabled' }, 503);
    }
    const body = await c.req
      .json<{ visitorId?: string; touch?: MarketingTouch }>()
      .catch((): { visitorId?: string; touch?: MarketingTouch } => ({}));
    if (!isValidVisitorId(body.visitorId)) {
      return c.json({ error: 'Invalid visitor id' }, 400);
    }
    const visitorId = body.visitorId;

    // Record the lead now (don't block the response on it).
    c.executionCtx.waitUntil(guest.ensureLead(visitorId, body.touch).catch((error) => {
      reportCaughtError(error, { source: "presentation/routes/guestRoutes.ts", operation: "createGuestRoutes" });
    }));

    const token = await signGuestToken(visitorId, c.env.JWT_SECRET, GUEST_TOKEN_TTL_SECONDS);
    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null;
    const cap = await guest.checkCap(c.env as Env, visitorId, ip);

    return c.json({
      token,
      expiresInSeconds: GUEST_TOKEN_TTL_SECONDS,
      remaining: cap.remaining,
      limit: cap.limit,
      /** Whether this visitor can open a shared, invitable room. */
      roomsEnabled: guestRoomsEnabled(c.env as Env),
    });
  });

  // A guest's remaining daily allowance (for the composer's "N messages left").
  router.get('/usage/:visitorId', async (c) => {
    const visitorId = c.req.param('visitorId');
    if (!isValidVisitorId(visitorId)) return c.json({ error: 'Invalid visitor id' }, 400);
    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null;
    const cap = await guest.checkCap(c.env as Env, visitorId, ip);
    return c.json({
      remaining: cap.remaining,
      limit: cap.limit,
      enabled: guestBrainEnabled(c.env),
      messagesDailyLimit: GUEST_CHAT_LIMITS.messagesDailyLimit,
      roomsEnabled: guestRoomsEnabled(c.env as Env),
    });
  });

  // ── Shared rooms ───────────────────────────────────────────────────────────

  /** Guard shared by every room route: the feature must be on AND available. */
  function roomsAvailable(c: Context<HonoEnv>): Response | null {
    if (!guestBrainEnabled(c.env)) {
      return c.json({ error: 'Guest chat is disabled.', code: 'guest_brain_disabled' }, 503);
    }
    if (!guestRoomsEnabled(c.env as Env)) {
      return c.json({ error: 'Shared guest sessions are unavailable.', code: 'guest_rooms_disabled' }, 503);
    }
    return null;
  }

  /**
   * Open a shared session. The caller becomes the host, gets a room-bound token,
   * and the room code is the invite link — anyone holding it may join while there
   * is space. The room's turn allowance is the SAME allowance one guest gets; it
   * is simply spent by everybody together.
   */
  router.post('/rooms', async (c) => {
    const blocked = roomsAvailable(c);
    if (blocked) return blocked;
    const body = await c.req.json<RoomEntryBody>().catch((): RoomEntryBody => ({}));
    if (!isValidVisitorId(body.visitorId)) return c.json({ error: 'Invalid visitor id' }, 400);
    const visitorId = body.visitorId;

    c.executionCtx.waitUntil(guest.ensureLead(visitorId, body.touch).catch((error) => {
      reportCaughtError(error, { source: "presentation/routes/guestRoutes.ts", operation: "createGuestRoom" });
    }));

    const code = newRoomCode();
    const state = await openGuestRoom(c.env as Env, code, visitorId, body.name ?? '', body.title ?? '');
    if (!state) return c.json({ error: 'Could not open a shared session.', code: 'guest_room_unavailable' }, 503);
    const token = await signGuestToken(visitorId, c.env.JWT_SECRET, GUEST_TOKEN_TTL_SECONDS, code);
    return c.json({ token, expiresInSeconds: GUEST_TOKEN_TTL_SECONDS, state }, 201);
  });

  /**
   * Accept an invite. Anyone with the link joins — that IS the credential — but
   * the room is capped, expires, and shares one allowance, so the link cannot be
   * turned into free capacity.
   */
  router.post('/rooms/:code/join', async (c) => {
    const blocked = roomsAvailable(c);
    if (blocked) return blocked;
    const code = c.req.param('code');
    if (!isValidRoomCode(code)) return c.json({ error: 'Invalid room code' }, 400);
    const body = await c.req.json<RoomEntryBody>().catch((): RoomEntryBody => ({}));
    if (!isValidVisitorId(body.visitorId)) return c.json({ error: 'Invalid visitor id' }, 400);
    const visitorId = body.visitorId;

    c.executionCtx.waitUntil(guest.ensureLead(visitorId, body.touch).catch((error) => {
      reportCaughtError(error, { source: "presentation/routes/guestRoutes.ts", operation: "joinGuestRoom" });
    }));

    const state = await joinGuestRoom(c.env as Env, code, visitorId, body.name ?? '');
    if (!state) {
      // One code covers both misses on purpose: "expired" and "full" are the only
      // two, and the UI offers the same next step (start your own free session).
      return c.json({
        error: 'This shared session has ended or is full.',
        code: 'guest_room_unavailable',
        maxParticipants: GUEST_ROOM_LIMITS.maxParticipants,
      }, 410);
    }
    const token = await signGuestToken(visitorId, c.env.JWT_SECRET, GUEST_TOKEN_TTL_SECONDS, code);
    return c.json({ token, expiresInSeconds: GUEST_TOKEN_TTL_SECONDS, state });
  });

  // Current room state — roster + the COMBINED remaining turns.
  router.get('/rooms/:code', async (c) => {
    const code = c.req.param('code');
    if (!isValidRoomCode(code)) return c.json({ error: 'Invalid room code' }, 400);
    const auth = await authenticate(c, code);
    if (!auth) return c.json({ error: 'Not a member of this session.', code: 'guest_room_forbidden' }, 401);
    const state = await guestRoomState(c.env as Env, code, auth.visitorId);
    if (!state) return c.json({ error: 'This shared session has ended.', code: 'guest_room_unavailable' }, 410);
    return c.json({ state });
  });

  // The shared transcript. Every participant reads the same list.
  router.get('/rooms/:code/messages', async (c) => {
    const code = c.req.param('code');
    if (!isValidRoomCode(code)) return c.json({ error: 'Invalid room code' }, 400);
    const auth = await authenticate(c, code);
    if (!auth) return c.json({ error: 'Not a member of this session.', code: 'guest_room_forbidden' }, 401);
    const messages = await guestRoomMessages(c.env as Env, code);
    if (!messages) return c.json({ error: 'This shared session has ended.', code: 'guest_room_unavailable' }, 410);
    return c.json({ messages });
  });

  // Append to the shared transcript (the sender persists their own turn + the reply).
  router.post('/rooms/:code/messages', async (c) => {
    const code = c.req.param('code');
    if (!isValidRoomCode(code)) return c.json({ error: 'Invalid room code' }, 400);
    const auth = await authenticate(c, code);
    if (!auth) return c.json({ error: 'Not a member of this session.', code: 'guest_room_forbidden' }, 401);
    const body = await c.req
      .json<{ messages?: Array<{ role?: string; content?: string; metadata?: string | null }> }>()
      .catch((): { messages?: [] } => ({}));
    const messages = (body.messages ?? [])
      .filter((m) => typeof m?.content === 'string')
      .map((m) => ({ role: typeof m.role === 'string' ? m.role : 'user', content: m.content as string, metadata: m.metadata ?? null }));
    const created = await appendGuestRoomMessages(c.env as Env, code, messages);
    if (!created) return c.json({ error: 'This shared session has ended.', code: 'guest_room_unavailable' }, 410);
    return c.json({ created });
  });

  // Rename the session (any participant — this is a shared scratchpad, not an org).
  router.post('/rooms/:code/title', async (c) => {
    const code = c.req.param('code');
    if (!isValidRoomCode(code)) return c.json({ error: 'Invalid room code' }, 400);
    const auth = await authenticate(c, code);
    if (!auth) return c.json({ error: 'Not a member of this session.', code: 'guest_room_forbidden' }, 401);
    const { title } = await c.req.json<{ title?: string }>().catch((): { title?: string } => ({}));
    await setGuestRoomTitle(c.env as Env, code, title ?? '');
    return c.json({ ok: true });
  });

  // Leave — drops the participant so the seat frees up immediately.
  router.post('/rooms/:code/leave', async (c) => {
    const code = c.req.param('code');
    if (!isValidRoomCode(code)) return c.json({ error: 'Invalid room code' }, 400);
    const auth = await authenticate(c, code);
    if (!auth) return c.json({ error: 'Not a member of this session.', code: 'guest_room_forbidden' }, 401);
    await leaveGuestRoom(c.env as Env, code, auth.visitorId);
    return c.body(null, 204);
  });

  /**
   * The room's live relay. `?channel=chat` carries presence + "someone is asking
   * Brain" + transcript invalidation; `?channel=media` carries WebRTC signaling
   * for the camera meeting. The DO verifies the token's signed `rid` itself, so a
   * pasted room code without a matching token is relayed nothing.
   */
  router.get('/rooms/:code/ws', async (c) => {
    const code = c.req.param('code');
    if (!isValidRoomCode(code)) return c.text('Invalid room code', 400);
    if (c.req.header('Upgrade') !== 'websocket') return c.text('Expected WebSocket', 426);
    if (!guestRoomsEnabled(c.env as Env)) return c.text('Realtime unavailable', 503);
    return relayToGuestRoom(c.env as Env, code, c.req.raw);
  });

  /**
   * ICE configuration for the room's camera meeting — the same STUN/TURN answer
   * authenticated meetings get, but only for a verified member of a live room, so
   * anonymous traffic can never mint relay credentials on its own.
   */
  router.get('/rooms/:code/ice', async (c) => {
    const code = c.req.param('code');
    if (!isValidRoomCode(code)) return c.json({ error: 'Invalid room code' }, 400);
    const auth = await authenticate(c, code);
    if (!auth) return c.json({ error: 'Not a member of this session.', code: 'guest_room_forbidden' }, 401);
    const state = await guestRoomState(c.env as Env, code, auth.visitorId);
    if (!state) return c.json({ error: 'This shared session has ended.', code: 'guest_room_unavailable' }, 410);
    const directOnly = c.req.query('mode') === 'direct-only';
    const servers = await iceServers(c.env as Env);
    return c.json(applyMediaPrivacyMode(servers, directOnly));
  });

  return router;
}
