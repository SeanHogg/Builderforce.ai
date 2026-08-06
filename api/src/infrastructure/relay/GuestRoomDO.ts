import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
import { verifyGuestToken } from '../../application/guest/guestToken';
import { GUEST_CHAT_LIMITS, GUEST_ROOM_LIMITS } from '../../domain/tenant/PlanLimits';

/**
 * GuestRoomDO — a SHARED, invitable free session for LOGGED-OUT visitors.
 *
 * A solo guest chat is metered per visitorId and lives in their browser's
 * localStorage (see GuestChatService + guestRuntime). A guest ROOM is the
 * multi-person version of the same thing: one visitor opens a room, shares the
 * link, and everyone who joins talks to the same Brain, sees the same transcript,
 * and can turn on their camera to meet each other. One DO instance per room,
 * keyed `guestroom:<code>`.
 *
 * The DO owns three things no client can be trusted with:
 *
 *  1. THE COMBINED TURN ALLOWANCE. The room gets exactly the same daily turn
 *     budget a single guest gets (`GUEST_CHAT_LIMITS.messagesDailyLimit`) and the
 *     whole room spends it together — inviting people never multiplies anonymous
 *     LLM spend. Reservation is serialized here because a Durable Object is the
 *     only place two simultaneous sends can be ordered against one counter.
 *  2. THE SHARED TRANSCRIPT. Bounded (last `maxMessages`, each truncated), memory
 *     + storage backed, so a late joiner sees the conversation so far.
 *  3. THE RELAY. Every participant holds a WebSocket, on one of two channels:
 *     `chat` (presence + "someone is asking Brain" + transcript invalidation) and
 *     `media` (WebRTC offers/answers/ICE for the camera meeting). Frames relay
 *     only within their own channel, so signaling never lands in the chat UI.
 *
 * Auth: a socket must present a guest token whose signed `rid` equals this room's
 * code — the room code in the URL alone is not enough to be relayed, and internal
 * HTTP calls (from the gateway, which has already verified the token) pass the
 * visitorId directly.
 *
 * Rooms self-expire `ttlMinutes` after creation; an expired room answers 410 and
 * wipes its storage, so nothing anonymous lingers.
 *
 * Frame protocol (JSON, `type` discriminator) — mirrors CeremonyRoomDO:
 *  - server→client on connect: `{type:'hello', id, self:{visitorId,name}}` then `{type:'roster', peers:[…]}`
 *  - client→server `{type:'join', name}` → relayed as `{type:'presence', action:'join', peer:{…}}`
 *  - client→server anything else → relayed verbatim to the SAME channel, stamped `from:<peerId>`
 *  - server→chat channel `{type:'changed'}` when the transcript changed (clients refetch)
 *  - server→chat channel `{type:'turns', used, remaining, limit}` after a turn is charged
 *  - on disconnect: `{type:'presence', action:'leave', peer:{id}}`
 */

type Channel = 'chat' | 'media';

interface RoomMeta {
  code: string;
  title: string;
  /** ISO timestamp — the TTL clock starts here. */
  createdAt: string;
  hostVisitorId: string;
  /** UTC day (`YYYY-MM-DD`) the turn counter belongs to. */
  day: string;
  /** Combined turns spent by everyone in the room today. */
  turns: number;
  /** Recently charged turn ids — makes a re-send of the same turn idempotent. */
  turnIds: string[];
}

interface RoomMessage {
  id: number;
  role: string;
  content: string;
  metadata: string | null;
  seq: number;
  createdAt: string;
}

interface Participant {
  visitorId: string;
  name: string;
  joinedAt: string;
  lastSeenAt: string;
}

interface Peer {
  ws: WebSocket;
  id: string;
  channel: Channel;
  visitorId: string;
  name: string;
}

/** Public room state handed to a participant's UI. */
interface RoomState {
  code: string;
  title: string;
  createdAt: string;
  expiresAt: string;
  isHost: boolean;
  participants: Array<{ name: string; isHost: boolean; joinedAt: string }>;
  maxParticipants: number;
  used: number;
  remaining: number;
  limit: number;
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

export class GuestRoomDO implements DurableObject {
  // Required brand for the DurableObjectNamespace<T> generic constraint.
  declare readonly '__DURABLE_OBJECT_BRAND': never;

  private peers = new Map<WebSocket, Peer>();
  /** Monotonic message id. Seeded from the retained window's HIGHEST id, not its
   *  length — after trimming, `length` would re-issue ids that are still in use. */
  private seq = 0;
  /** Separate counter for socket ids so connecting never consumes message ids. */
  private peerSeq = 0;
  private meta: RoomMeta | null = null;
  private messages: RoomMessage[] = [];
  private participants: Participant[] = [];
  /** Visitors who have already converted this room into a real account chat. */
  private claimedBy: string[] = [];

  constructor(private state: DurableObjectState, private env: { JWT_SECRET?: string }) {
    // Hydrate before ANY request is served — the turn counter must never restart
    // at zero just because the DO was evicted between two sends.
    this.state.blockConcurrencyWhile(async () => {
      this.meta = (await this.state.storage.get<RoomMeta>('meta')) ?? null;
      this.messages = (await this.state.storage.get<RoomMessage[]>('messages')) ?? [];
      this.participants = (await this.state.storage.get<Participant[]>('participants')) ?? [];
      this.claimedBy = (await this.state.storage.get<string[]>('claimed')) ?? [];
      this.seq = this.messages.reduce((max, m) => Math.max(max, m.id), 0);
    });
  }

  // ── Lifetime ───────────────────────────────────────────────────────────────

  private expiresAtMs(meta: RoomMeta): number {
    return Date.parse(meta.createdAt) + GUEST_ROOM_LIMITS.ttlMinutes * 60_000;
  }

  /** The live room, or null when it was never opened / has expired (storage wiped). */
  private async live(): Promise<RoomMeta | null> {
    const meta = this.meta;
    if (!meta) return null;
    if (Date.now() < this.expiresAtMs(meta)) return meta;
    await this.wipe();
    return null;
  }

  private async wipe(): Promise<void> {
    this.meta = null;
    this.messages = [];
    this.participants = [];
    this.claimedBy = [];
    this.seq = 0;
    await this.state.storage.deleteAll().catch((error) => {
      reportCaughtError(error, { source: 'infrastructure/relay/GuestRoomDO.ts', operation: 'wipe' });
    });
    for (const [ws] of this.peers) {
      try {
        ws.close(1000, 'room expired');
      } catch (error) {
        // The socket was already torn down by the client — the room is closing
        // either way, so this is nothing to recover from, only to record.
        reportCaughtError(error, { source: 'infrastructure/relay/GuestRoomDO.ts', operation: 'wipe' });
      }
    }
    this.peers.clear();
  }

  // ── Turn accounting (the combined allowance) ────────────────────────────────

  /** Roll the counter onto today when the stored day is stale. Mutates `meta`. */
  private rollDay(meta: RoomMeta): RoomMeta {
    const today = utcDay();
    if (meta.day !== today) { meta.day = today; meta.turns = 0; meta.turnIds = []; }
    return meta;
  }

  private stateFor(meta: RoomMeta, visitorId: string): RoomState {
    const limit = GUEST_CHAT_LIMITS.messagesDailyLimit;
    const used = meta.day === utcDay() ? meta.turns : 0;
    return {
      code: meta.code,
      title: meta.title,
      createdAt: meta.createdAt,
      expiresAt: new Date(this.expiresAtMs(meta)).toISOString(),
      isHost: meta.hostVisitorId === visitorId,
      participants: this.participants.map((p) => ({
        name: p.name, isHost: p.visitorId === meta.hostVisitorId, joinedAt: p.joinedAt,
      })),
      maxParticipants: GUEST_ROOM_LIMITS.maxParticipants,
      used,
      remaining: Math.max(limit - used, 0),
      limit,
    };
  }

  // ── Roster ─────────────────────────────────────────────────────────────────

  /**
   * Record (or refresh) a participant. Returns false when the room is full.
   * Re-admitting an existing visitor is deliberately idempotent: that is also the
   * path a participant takes when their short-lived guest token is renewed
   * mid-session, and renewing a token must never cost them their seat.
   */
  private async admit(visitorId: string, name: string): Promise<boolean> {
    const now = new Date().toISOString();
    const existing = this.participants.find((p) => p.visitorId === visitorId);
    if (existing) {
      existing.lastSeenAt = now;
      if (name) existing.name = name;
    } else {
      if (this.participants.length >= GUEST_ROOM_LIMITS.maxParticipants) return false;
      this.participants.push({ visitorId, name: name || 'Guest', joinedAt: now, lastSeenAt: now });
    }
    await this.state.storage.put('participants', this.participants);
    return true;
  }

  // ── HTTP + WebSocket ───────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^.*?(\/[^/]*)$/, '$1');

    if (request.headers.get('Upgrade') === 'websocket') return this.onUpgrade(request, url);

    switch (path) {
      case '/open':   return this.handleOpen(request);
      case '/join':   return this.handleJoin(request);
      case '/state':  return this.handleState(request);
      case '/turn':   return this.handleTurn(request);
      case '/messages': return request.method === 'POST' ? this.handleAppend(request) : this.handleMessages(request);
      case '/title':  return this.handleTitle(request);
      case '/leave':  return this.handleLeave(request);
      case '/claim':  return this.handleClaim(request);
      default:        return new Response('Not found', { status: 404 });
    }
  }

  private async body<T>(request: Request): Promise<T> {
    return (await request.json().catch(() => ({}))) as T;
  }

  /** Create the room if it does not exist yet, then admit the caller as host. */
  private async handleOpen(request: Request): Promise<Response> {
    const { code, visitorId, name, title } = await this.body<{ code?: string; visitorId?: string; name?: string; title?: string }>(request);
    if (!code || !visitorId) return Response.json({ error: 'code and visitorId are required' }, { status: 400 });
    let meta = await this.live();
    if (!meta) {
      meta = {
        code,
        title: clean(title, 120) || 'Guest session',
        createdAt: new Date().toISOString(),
        hostVisitorId: visitorId,
        day: utcDay(),
        turns: 0,
        turnIds: [],
      };
      this.meta = meta;
      await this.state.storage.put('meta', meta);
    }
    if (!(await this.admit(visitorId, clean(name, 40)))) {
      return Response.json({ error: 'room_full' }, { status: 409 });
    }
    this.broadcastRoster();
    return Response.json({ state: this.stateFor(meta, visitorId) });
  }

  private async handleJoin(request: Request): Promise<Response> {
    const { visitorId, name } = await this.body<{ visitorId?: string; name?: string }>(request);
    if (!visitorId) return Response.json({ error: 'visitorId is required' }, { status: 400 });
    const meta = await this.live();
    if (!meta) return Response.json({ error: 'room_gone' }, { status: 410 });
    if (!(await this.admit(visitorId, clean(name, 40)))) {
      return Response.json({ error: 'room_full' }, { status: 409 });
    }
    this.broadcastRoster();
    return Response.json({ state: this.stateFor(meta, visitorId) });
  }

  private async handleState(request: Request): Promise<Response> {
    const visitorId = new URL(request.url).searchParams.get('visitorId') ?? '';
    const meta = await this.live();
    if (!meta) return Response.json({ error: 'room_gone' }, { status: 410 });
    return Response.json({ state: this.stateFor(meta, visitorId) });
  }

  private async handleTitle(request: Request): Promise<Response> {
    const { title } = await this.body<{ title?: string }>(request);
    const meta = await this.live();
    if (!meta) return Response.json({ error: 'room_gone' }, { status: 410 });
    const next = clean(title, 120);
    if (next) {
      meta.title = next;
      await this.state.storage.put('meta', meta);
      this.broadcast('chat', JSON.stringify({ type: 'room', title: next }), null);
    }
    return Response.json({ ok: true });
  }

  private async handleLeave(request: Request): Promise<Response> {
    const { visitorId } = await this.body<{ visitorId?: string }>(request);
    const meta = await this.live();
    if (!meta || !visitorId) return Response.json({ ok: true });
    this.participants = this.participants.filter((p) => p.visitorId !== visitorId);
    await this.state.storage.put('participants', this.participants);
    this.broadcastRoster();
    return Response.json({ ok: true });
  }

  /**
   * Hand this room's transcript to a participant who has just created an account,
   * so the work survives the room instead of expiring with it.
   *
   * Membership is checked HERE, against the persisted roster, because the caller
   * arrives holding a tenant JWT — which proves who they are now, not that they
   * were ever in this room. Claiming is once per visitor and recorded, so a
   * repeated sign-in cannot fork the same conversation into a second chat; the
   * room itself is left alone, since other people may still be talking in it.
   */
  private async handleClaim(request: Request): Promise<Response> {
    const { visitorId } = await this.body<{ visitorId?: string }>(request);
    const meta = await this.live();
    if (!meta) return Response.json({ error: 'room_gone' }, { status: 410 });
    if (!visitorId || !this.participants.some((p) => p.visitorId === visitorId)) {
      return Response.json({ error: 'not_a_member' }, { status: 403 });
    }
    if (this.claimedBy.includes(visitorId)) {
      return Response.json({ alreadyClaimed: true, title: meta.title, messages: [] });
    }
    this.claimedBy = [...this.claimedBy, visitorId];
    await this.state.storage.put('claimed', this.claimedBy);
    return Response.json({ alreadyClaimed: false, title: meta.title, messages: this.messages });
  }

  /**
   * Check (and optionally charge) ONE turn against the room's combined allowance.
   * `commit:false` is the pre-flight the gateway runs before dispatching, so a
   * vendor failure never burns a turn; `commit:true` runs once an upstream has
   * accepted the request. Charging is idempotent per `turnId`, so the tool-loop
   * continuations of one user submit cost one turn, not one per model call.
   */
  private async handleTurn(request: Request): Promise<Response> {
    const { turnId, commit } = await this.body<{ turnId?: string; commit?: boolean }>(request);
    const live = await this.live();
    if (!live) return Response.json({ error: 'room_gone' }, { status: 410 });
    const meta = this.rollDay(live);
    const limit = GUEST_CHAT_LIMITS.messagesDailyLimit;
    const id = clean(turnId, 128);

    if (id && meta.turnIds.includes(id)) {
      return Response.json({ allowed: true, alreadyConsumed: true, used: meta.turns, remaining: Math.max(limit - meta.turns, 0), limit });
    }
    if (meta.turns >= limit) {
      await this.state.storage.put('meta', meta);
      return Response.json({ allowed: false, reason: 'room', used: meta.turns, remaining: 0, limit });
    }
    if (commit) {
      meta.turns += 1;
      if (id) meta.turnIds = [...meta.turnIds.slice(-39), id];
    }
    await this.state.storage.put('meta', meta);
    const remaining = Math.max(limit - meta.turns, 0);
    if (commit) this.broadcast('chat', JSON.stringify({ type: 'turns', used: meta.turns, remaining, limit }), null);
    return Response.json({ allowed: true, alreadyConsumed: false, used: meta.turns, remaining, limit });
  }

  private async handleMessages(request: Request): Promise<Response> {
    void request;
    const meta = await this.live();
    if (!meta) return Response.json({ error: 'room_gone' }, { status: 410 });
    return Response.json({ messages: this.messages });
  }

  /** Append one or more transcript messages, then tell every chat peer to refetch. */
  private async handleAppend(request: Request): Promise<Response> {
    const { messages } = await this.body<{ messages?: Array<{ role?: string; content?: string; metadata?: string | null }> }>(request);
    const meta = await this.live();
    if (!meta) return Response.json({ error: 'room_gone' }, { status: 410 });
    if (!Array.isArray(messages) || messages.length === 0) return Response.json({ created: [] });

    const now = new Date().toISOString();
    const created: RoomMessage[] = messages.slice(0, 20).map((m) => ({
      id: ++this.seq,
      role: clean(m.role, 24) || 'user',
      content: clean(m.content, GUEST_ROOM_LIMITS.maxMessageChars),
      metadata: typeof m.metadata === 'string' ? m.metadata.slice(0, 4_000) : null,
      seq: 0,
      createdAt: now,
    }));
    this.messages = [...this.messages, ...created].slice(-GUEST_ROOM_LIMITS.maxMessages);
    // `seq` is the position in the retained window — the timeline orders by it.
    this.messages.forEach((m, i) => { m.seq = i; });
    await this.state.storage.put('messages', this.messages);
    this.broadcast('chat', JSON.stringify({ type: 'changed' }), null);
    return Response.json({ created: this.messages.slice(-created.length) });
  }

  // ── Relay ──────────────────────────────────────────────────────────────────

  private async onUpgrade(request: Request, url: URL): Promise<Response> {
    const meta = await this.live();
    if (!meta) return new Response('Room is closed', { status: 410 });

    // The signed `rid` is the membership proof — a room code pasted into the URL
    // without a token bound to it gets nothing.
    const token = url.searchParams.get('token') ?? '';
    const identity = await verifyGuestToken(token, this.env.JWT_SECRET ?? '');
    if (!identity || identity.roomCode !== meta.code) return new Response('Not a member of this room', { status: 401 });

    if (this.peers.size >= GUEST_ROOM_LIMITS.maxSockets) return new Response('Room is full', { status: 409 });
    const channel: Channel = url.searchParams.get('channel') === 'media' ? 'media' : 'chat';
    const known = this.participants.find((p) => p.visitorId === identity.visitorId);

    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    const peer: Peer = {
      ws: server,
      id: `g${++this.peerSeq}`,
      channel,
      visitorId: identity.visitorId,
      name: known?.name ?? 'Guest',
    };
    this.peers.set(server, peer);

    server.addEventListener('message', (ev) => this.onMessage(peer, ev));
    server.addEventListener('close', () => this.onClose(peer));
    server.addEventListener('error', () => this.onClose(peer));

    this.send(peer, { type: 'hello', id: peer.id, self: { name: peer.name } });
    this.send(peer, { type: 'roster', peers: this.rosterFor(channel) });
    this.broadcast(channel, JSON.stringify({ type: 'presence', action: 'join', peer: this.publicPeer(peer) }), server);

    return new Response(null, { status: 101, webSocket: client });
  }

  private onMessage(peer: Peer, ev: MessageEvent): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
    } catch {
      return; // ignore non-JSON frames
    }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'join') {
      const name = clean(msg.name, 40);
      if (name) {
        peer.name = name;
        // Keep the persisted roster in step so a late joiner sees real names.
        const known = this.participants.find((p) => p.visitorId === peer.visitorId);
        if (known && known.name !== name) {
          known.name = name;
          void this.state.storage.put('participants', this.participants).catch(() => undefined);
        }
      }
      this.send(peer, { type: 'roster', peers: this.rosterFor(peer.channel) });
      this.broadcast(peer.channel, JSON.stringify({ type: 'presence', action: 'join', peer: this.publicPeer(peer) }), peer.ws);
      return;
    }

    // Everything else (typing, busy, rtc-offer/answer/ice, m-state, …) relays
    // verbatim to the OTHER peers ON THE SAME CHANNEL, stamped with the sender.
    this.broadcast(peer.channel, JSON.stringify({ ...msg, from: peer.id, name: peer.name }), peer.ws);
  }

  private onClose(peer: Peer): void {
    if (!this.peers.delete(peer.ws)) return;
    this.broadcast(peer.channel, JSON.stringify({ type: 'presence', action: 'leave', peer: { id: peer.id } }), peer.ws);
  }

  private rosterFor(channel: Channel) {
    return [...this.peers.values()].filter((p) => p.channel === channel).map((p) => this.publicPeer(p));
  }

  private publicPeer(p: Peer) {
    // `ref` mirrors the ceremony/meeting relay contract so the SHARED media hook
    // (useMediaRoom) can attribute tiles without a guest-specific branch.
    return { id: p.id, name: p.name, kind: 'human', ref: p.id };
  }

  private send(peer: Peer, frame: unknown): void {
    try { peer.ws.send(JSON.stringify(frame)); } catch { this.peers.delete(peer.ws); }
  }

  /** Send `data` to every peer on `channel` except `except` (null = all of them). */
  private broadcast(channel: Channel, data: string, except: WebSocket | null): void {
    for (const [ws, peer] of this.peers) {
      if (ws === except || peer.channel !== channel) continue;
      try { ws.send(data); } catch { this.peers.delete(ws); }
    }
  }

  /** Someone joined/left via HTTP — refresh both channels' participant lists. */
  private broadcastRoster(): void {
    const frame = JSON.stringify({
      type: 'participants',
      participants: this.participants.map((p) => ({ name: p.name, isHost: p.visitorId === this.meta?.hostVisitorId, joinedAt: p.joinedAt })),
    });
    this.broadcast('chat', frame, null);
    this.broadcast('media', frame, null);
  }
}
