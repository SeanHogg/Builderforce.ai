import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
import { Hono, type Context } from 'hono';
import type { Env, HonoEnv } from '../../env';
import { isValidVisitorId, type MarketingTouch } from '../../application/marketing/MarketingService';
import { GuestChatService } from '../../application/guest/GuestChatService';
import {
  signGuestToken, guestIdentityFromRequest, guestBrainEnabled, isValidRoomCode, newRoomCode,
} from '../../application/guest/guestToken';
import {
  guestRoomsEnabled, openGuestRoom, joinGuestRoom, guestRoomState, guestRoomMessages,
  appendGuestRoomMessages, setGuestRoomTitle, leaveGuestRoom, relayToGuestRoom,
  guestRoomCanvas, putGuestRoomCanvas,
} from '../../application/guest/guestRoomClient';
import { GUEST_CHAT_LIMITS, GUEST_ROOM_LIMITS } from '../../domain/tenant/PlanLimits';
import {
  consumeGuestResearchCall, guestWebSearch, guestWebFetch, guestGeocode,
} from '../../application/guest/guestResearch';
import { GUEST_SAFE_CAREER_TOOLS, guestCareerTool } from '../../application/llm/careerToolCatalog';
import { advertisedName } from '../../application/llm/toolNaming';
import { isGuestCanvasToolName } from '@builderforce/creation-canvas-contract';
import { iceServers } from '../../application/meetings/iceServers';
import { applyMediaPrivacyMode } from '../../domain/meetings/mediaPrivacy';
import type { GuestPromptService } from '../../application/marketing/GuestPromptService';
import {
  BROADCAST_EVENTS,
  BROADCAST_ROOM,
  type BroadcastEvent,
  type PlatformBroadcastService,
} from '../../application/marketing/PlatformBroadcastService';
import { relayToRoom } from './realtimeRelay';

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
 *
 * `POST /prompt` and `GET /messages` are the two halves of the conversion loop
 * around all of that: what the visitor asked for on the way in, and what we are
 * saying to them while they are here. Both are unauthenticated by necessity —
 * the first fires before a guest token exists, and the second runs on marketing
 * pages that never mint one — so both are bounded, and neither trusts anything
 * the caller claims about themselves beyond the opaque `visitorId`.
 */
const GUEST_TOKEN_TTL_SECONDS = 3600;

/** The verified guest behind a room request. */
type GuestAuth = { visitorId: string; roomCode: string | null };

/** Body of `POST /rooms` (open) and `POST /rooms/:code/join`. */
interface RoomEntryBody {
  visitorId?: string;
  name?: string;
  title?: string;
  /** Which surface opened the room — decides where its invite link points. */
  surface?: string;
  touch?: MarketingTouch;
}

export function createGuestRoutes(
  guest: GuestChatService,
  prompts: GuestPromptService,
  broadcasts: PlatformBroadcastService,
): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  /** Resolve the caller's guest identity, requiring membership of `code` when given. */
  async function authenticate(c: Context<HonoEnv>, code?: string): Promise<GuestAuth | null> {
    const identity = await guestIdentityFromRequest(c.req.raw, c.env.JWT_SECRET);
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

  // ── Intent capture ─────────────────────────────────────────────────────────
  //
  // The landing composer submits HERE before it navigates. It has to: the session
  // it opens is created in the browser (`createLocalCreationSession`) and the
  // first model call happens a page later, so waiting for the gateway to harvest
  // the prompt would lose every visitor who bounced on the way — which is exactly
  // the drop-off worth measuring. In-session turns are harvested from the gateway
  // instead (see `handleGuestChat`) and never come through here.
  //
  // Unauthenticated on purpose and therefore bounded: a per-visitor and per-IP
  // daily ceiling inside the service, a length cap in the domain, and nothing
  // stored but the text and where it was typed.
  router.post('/prompt', async (c) => {
    const body = await c.req
      .json<{ visitorId?: string; prompt?: string; surface?: string; sessionRef?: string; visitId?: string; mode?: string; touch?: MarketingTouch }>()
      .catch((): Record<string, never> => ({}));
    if (!isValidVisitorId(body.visitorId)) return c.json({ error: 'Invalid visitor id' }, 400);
    const visitorId = body.visitorId;

    // The lead row must exist before the prompt lands, or the very first prompt a
    // visitor ever types belongs to nobody. Awaited rather than deferred for that
    // reason — this is the one place the ordering is load-bearing.
    await guest.ensureLead(visitorId, body.touch).catch((error) => {
      reportCaughtError(error, { source: 'presentation/routes/guestRoutes.ts', operation: 'recordGuestPrompt' });
    });

    const result = await prompts.record(c.env as Env, {
      visitorId,
      prompt: body.prompt,
      surface: body.surface,
      sessionRef: body.sessionRef,
      visitId: body.visitId,
      mode: body.mode,
      ip: c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null,
    });

    // 202 for every outcome including the refusals: this is telemetry riding
    // alongside a navigation, and a visitor who has hit an abuse ceiling must
    // still get into the product. The status is reported, not enforced.
    return c.json({ recorded: result.status === 'recorded', status: result.status }, 202);
  });

  // ── Platform broadcasts ────────────────────────────────────────────────────
  //
  // What a superadmin is currently saying to THIS visitor. Targeting is resolved
  // server-side from their lead row, so the response contains only the messages
  // they are entitled to and nothing about the rule that selected them.

  router.get('/messages', async (c) => {
    const visitorId = c.req.query('visitorId');
    if (!isValidVisitorId(visitorId)) return c.json({ error: 'Invalid visitor id' }, 400);
    return c.json({ messages: await broadcasts.deliverTo(c.env as Env, visitorId) });
  });

  // Seen / clicked / dismissed. Idempotent per (broadcast, visitor, kind), so a
  // component that remounts cannot inflate a campaign's reach.
  router.post('/messages/:id/event', async (c) => {
    const broadcastId = Number(c.req.param('id'));
    if (!Number.isInteger(broadcastId) || broadcastId <= 0) return c.json({ error: 'Invalid message id' }, 400);
    const body = await c.req
      .json<{ visitorId?: string; kind?: string }>()
      .catch((): Record<string, never> => ({}));
    if (!isValidVisitorId(body.visitorId)) return c.json({ error: 'Invalid visitor id' }, 400);
    if (!BROADCAST_EVENTS.includes(body.kind as BroadcastEvent)) {
      return c.json({ error: 'Unknown event kind' }, 400);
    }
    await broadcasts.recordEvent(c.env as Env, {
      broadcastId, visitorId: body.visitorId, kind: body.kind as BroadcastEvent,
    });
    return c.body(null, 204);
  });

  /**
   * The live channel. ONE room for the whole platform, carrying the same
   * `{type:'changed'}` frame every other realtime surface uses — clients then
   * re-fetch `GET /messages`, which is where targeting is applied.
   *
   * Deliberately open: no message text, no audience and no visitor id crosses
   * this socket, so there is nothing on it a public listener should not hear.
   * Making it a targeted per-visitor channel would mean one Durable Object per
   * anonymous visitor to deliver a single word.
   */
  router.get('/messages/ws', (c) => relayToRoom(c, c.env?.SESSION_ROOM, BROADCAST_ROOM));

  // ── Research ───────────────────────────────────────────────────────────────
  //
  // The logged-out canvas's `builtin_web_search` / `builtin_web_fetch` /
  // `builtin_geo_geocode` tools. A guest has no tenant, so they cannot reach the MCP
  // catalog that owns these for authed users — without this surface an anonymous
  // "research X and chart it" turn answers from the model's weights and invents its
  // numbers. Guarded by the signed guest token, charged against a per-visitor and
  // per-IP daily call allowance, and backed only by the PLATFORM search backing (a
  // guest can never reach a tenant's BYO key). See application/guest/guestResearch.ts.

  /** Shared guard: verified guest + one charged anonymous call, or the refusal to send.
   *  Used by BOTH the research and career surfaces — one visitor, one daily allowance,
   *  because "how much free compute does an anonymous visitor get today" is one question
   *  and two counters would be two answers to it. */
  async function chargeGuestCall(c: Context<HonoEnv>): Promise<{ visitorId: string } | Response> {
    if (!guestBrainEnabled(c.env)) {
      return c.json({ error: 'Guest research is disabled.', code: 'guest_brain_disabled' }, 503);
    }
    const auth = await authenticate(c);
    if (!auth) return c.json({ error: 'A guest session is required.', code: 'guest_forbidden' }, 401);
    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null;
    const cap = await consumeGuestResearchCall(c.env as Env, auth.visitorId, ip);
    if (!cap.allowed) {
      // 429, and `terminal` so the canvas stops retrying: like the chat cap, a guest
      // has no plan to upgrade — the next step is signing up, not paying.
      return c.json({
        error: cap.reason === 'ip'
          ? 'This device has reached its free research limit for today. Sign up free to keep going.'
          : `You've used your ${cap.limit} free research lookups for today. Sign up free to keep going.`,
        code: 'guest_research_limit_reached',
        reason: cap.reason,
        limit: cap.limit,
        terminal: true,
      }, 429);
    }
    return { visitorId: auth.visitorId };
  }

  router.post('/research/search', async (c) => {
    const charged = await chargeGuestCall(c);
    if (charged instanceof Response) return charged;
    const { query } = await c.req.json<{ query?: string }>().catch((): { query?: string } => ({}));
    if (typeof query !== 'string' || !query.trim()) return c.json({ error: 'A query is required' }, 400);
    return c.json(await guestWebSearch(c.env as Env, query.trim().slice(0, 400)));
  });

  router.post('/research/fetch', async (c) => {
    const charged = await chargeGuestCall(c);
    if (charged instanceof Response) return charged;
    const { url } = await c.req.json<{ url?: string }>().catch((): { url?: string } => ({}));
    if (typeof url !== 'string' || !url.trim()) return c.json({ error: 'A url is required' }, 400);
    try {
      return c.json(await guestWebFetch(c.env as Env, url.trim()));
    } catch (error) {
      // An SSRF refusal or an unreachable origin — a 400 the model can relay verbatim.
      return c.json({ error: error instanceof Error ? error.message : 'Could not fetch the URL' }, 400);
    }
  });

  router.post('/research/geocode', async (c) => {
    const charged = await chargeGuestCall(c);
    if (charged instanceof Response) return charged;
    const body = await c.req
      .json<{ queries?: unknown; context?: string; countryCodes?: string; outline?: boolean }>()
      .catch((): Record<string, never> => ({}));
    // Deliberately NOT sliced here: `geocodeBatch` owns the cap and REPORTS it as
    // `truncated`, and a silent slice in the route would turn a half-plotted map into
    // one that claims to be whole.
    const queries = Array.isArray(body.queries)
      ? body.queries.filter((v): v is string => typeof v === 'string' && !!v.trim())
      : [];
    if (!queries.length) return c.json({ error: 'At least one place name is required' }, 400);
    return c.json(await guestGeocode(c.env as Env, queries, {
      ...(body.context?.trim() ? { context: body.context.trim() } : {}),
      ...(body.countryCodes?.trim() ? { countryCodes: body.countryCodes.trim().toLowerCase() } : {}),
      ...(body.outline === true ? { outline: true } : {}),
    }));
  });

  // ── Career ─────────────────────────────────────────────────────────────────
  //
  // The logged-out canvas's `builtin_recruiter_*` / `builtin_hr_*` / `builtin_listing_*`
  // tools. Same argument as the research surface above, one need over: a guest has no
  // tenant, so they cannot reach the MCP catalog that owns these for authed users — and
  // the visitor most likely to arrive logged-out and type their situation into the first
  // box they see is someone out of work.
  //
  // What makes this cheap to expose is that the implementations are PURE. Every tool
  // reachable here runs over text the visitor supplied, touches no tenant resource, no
  // network and no clock, and is the SAME function the signed-in catalog dispatches —
  // `GUEST_SAFE_CAREER_TOOLS` is derived from that half of the catalog module rather
  // than hand-listed, so a tenant tool cannot leak in by someone forgetting a list.
  //
  // Charged against the same anonymous allowance as research, because it is the same
  // question — how much free compute one visitor gets in a day — and two counters would
  // be two answers to it.

  // The guest canvas has to ADVERTISE these tools to the model, and the browser must not
  // own a second copy of twenty-three descriptions and parameter schemas — that is
  // precisely the drift `packages/creation-canvas-contract/src/canvasTools.ts` was
  // written to document, one layer up. So the client asks the catalog what it may call
  // and builds its action list from the answer: one source, no divergence possible.
  //
  // Unauthenticated and uncharged: it is static metadata about the same tools the
  // contract already names publicly, and requiring a token to learn the shape of a tool
  // you are allowed to call would only mean the canvas fetches a token to render.
  router.get('/career/tools', (c) => c.json({
    tools: GUEST_SAFE_CAREER_TOOLS.map((tool) => {
      const impl = guestCareerTool(tool);
      return {
        name: advertisedName(tool),
        description: impl?.description ?? '',
        parameters: impl?.parameters ?? { type: 'object', properties: {} },
      };
    }),
  }));

  router.post('/career/:tool', async (c) => {
    const charged = await chargeGuestCall(c);
    if (charged instanceof Response) return charged;

    // The path segment is the ADVERTISED name (`builtin_hr_runway`), because that is
    // what the model was given and what it will call. Resolve it back through the same
    // contract the gateway filters on, so the two cannot disagree about the vocabulary.
    const advertised = c.req.param('tool');
    if (!isGuestCanvasToolName(advertised)) {
      return c.json({ error: `"${advertised}" is not available without an account.`, code: 'guest_tool_forbidden' }, 403);
    }
    const entry = GUEST_SAFE_CAREER_TOOLS.find((tool) => advertisedName(tool) === advertised);
    if (!entry) {
      return c.json({ error: `"${advertised}" is not a career tool.`, code: 'guest_tool_unknown' }, 404);
    }
    const impl = guestCareerTool(entry);
    if (!impl) return c.json({ error: `"${advertised}" is unavailable.`, code: 'guest_tool_unknown' }, 404);

    const args = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
    try {
      // These tools take no context: they are pure over their arguments, which is the
      // property that made them guest-safe. The cast supplies the shape the signature
      // asks for without handing an anonymous caller a database or a tenant.
      const result = await impl.run(undefined as never, args ?? {});
      return c.json(result as Record<string, unknown>);
    } catch (error) {
      // A validation refusal ("paste your résumé first") is information the model should
      // relay, not a failed turn — same contract as the research surface.
      return c.json({ error: error instanceof Error ? error.message : 'The career tool could not run.' }, 400);
    }
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
    const state = await openGuestRoom(
      c.env as Env, code, visitorId, body.name ?? '', body.title ?? '',
      body.surface === 'canvas' ? 'canvas' : 'chat',
    );
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

  /**
   * The shared Creation Canvas board. GET is how a late joiner (or a reconnecting
   * peer) gets the board at all; POST is the debounced write from whoever last
   * changed it. Deliberately UNCACHED: this is per-room mutable state read by a
   * handful of people who are actively editing it, so any cache layer in front of
   * it would serve exactly the stale board the sync exists to prevent — and the
   * read is a single Durable Object hit, not a database query.
   */
  router.get('/rooms/:code/canvas', async (c) => {
    const code = c.req.param('code');
    if (!isValidRoomCode(code)) return c.json({ error: 'Invalid room code' }, 400);
    const auth = await authenticate(c, code);
    if (!auth) return c.json({ error: 'Not a member of this session.', code: 'guest_room_forbidden' }, 401);
    const canvas = await guestRoomCanvas(c.env as Env, code);
    if (!canvas) return c.json({ error: 'This shared session has ended.', code: 'guest_room_unavailable' }, 410);
    return c.json(canvas);
  });

  router.post('/rooms/:code/canvas', async (c) => {
    const code = c.req.param('code');
    if (!isValidRoomCode(code)) return c.json({ error: 'Invalid room code' }, 400);
    const auth = await authenticate(c, code);
    if (!auth) return c.json({ error: 'Not a member of this session.', code: 'guest_room_forbidden' }, 401);
    const { snapshot } = await c.req.json<{ snapshot?: string }>().catch((): { snapshot?: string } => ({}));
    if (typeof snapshot !== 'string') return c.json({ error: 'snapshot is required' }, 400);
    const result = await putGuestRoomCanvas(c.env as Env, code, snapshot);
    if (!result) return c.json({ error: 'This shared session has ended.', code: 'guest_room_unavailable' }, 410);
    return c.json(result);
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
