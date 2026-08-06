import { describe, it, expect, beforeEach } from 'vitest';
import { GuestRoomDO } from './GuestRoomDO';
import { GUEST_CHAT_LIMITS, GUEST_ROOM_LIMITS } from '../../domain/tenant/PlanLimits';
import { newRoomCode } from '../../application/guest/guestToken';

/**
 * The load-bearing promise of a shared guest session: inviting people in does NOT
 * multiply the free allowance. Everyone in the room spends ONE budget — the same
 * budget a lone guest gets — and it must survive the DO being evicted between two
 * sends, because "the counter restarted" is indistinguishable from "the cap does
 * not exist".
 */

/** Minimal in-memory DurableObjectState (storage + blockConcurrencyWhile). */
function fakeState(store = new Map<string, unknown>()) {
  return {
    storage: {
      get: async <T>(key: string) => store.get(key) as T | undefined,
      put: async (key: string, value: unknown) => { store.set(key, structuredClone(value)); },
      deleteAll: async () => { store.clear(); },
    },
    blockConcurrencyWhile: async (fn: () => Promise<void>) => { await fn(); },
    waitUntil: () => {},
    store,
  };
}

type Fake = ReturnType<typeof fakeState>;

function makeRoom(state: Fake) {
  return new GuestRoomDO(state as unknown as DurableObjectState, { JWT_SECRET: 'secret' });
}

async function post(room: GuestRoomDO, path: string, body: unknown) {
  const res = await room.fetch(new Request(`https://guest-room${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  return { status: res.status, data: await res.json() as Record<string, unknown> };
}

const LIMIT = GUEST_CHAT_LIMITS.messagesDailyLimit;

describe('GuestRoomDO combined turn allowance', () => {
  let state: Fake;
  let room: GuestRoomDO;
  let code: string;

  beforeEach(async () => {
    state = fakeState();
    room = makeRoom(state);
    code = newRoomCode();
    await post(room, '/open', { code, visitorId: 'host-1', name: 'Ada', title: 'Launch plan' });
  });

  it('spends ONE budget across different participants, not one each', async () => {
    // Alternate senders — the counter must not care who is spending.
    for (let i = 0; i < LIMIT; i++) {
      const turn = await post(room, '/turn', { turnId: `turn-${i}`, commit: true });
      expect(turn.data.allowed).toBe(true);
      expect(turn.data.remaining).toBe(LIMIT - (i + 1));
    }
    const overflow = await post(room, '/turn', { turnId: 'turn-extra', commit: true });
    expect(overflow.data.allowed).toBe(false);
    expect(overflow.data.reason).toBe('room');
    expect(overflow.data.remaining).toBe(0);
  });

  it('charges one turn per user submit, however many model calls it takes', async () => {
    // A tool loop replays the same turnId for each continuation.
    await post(room, '/turn', { turnId: 'submit-1', commit: true });
    for (let i = 0; i < 4; i++) {
      const again = await post(room, '/turn', { turnId: 'submit-1', commit: true });
      expect(again.data.alreadyConsumed).toBe(true);
    }
    const check = await post(room, '/turn', { turnId: 'submit-2', commit: false });
    expect(check.data.remaining).toBe(LIMIT - 1);
  });

  it('does not charge a pre-flight check, only a committed turn', async () => {
    await post(room, '/turn', { turnId: 'submit-1', commit: false });
    await post(room, '/turn', { turnId: 'submit-1', commit: false });
    const state1 = await room.fetch(new Request('https://guest-room/state?visitorId=host-1'));
    const { state: view } = await state1.json() as { state: { used: number; remaining: number } };
    expect(view.used).toBe(0);
    expect(view.remaining).toBe(LIMIT);
  });

  it('survives eviction — a reconstructed room resumes the same counter', async () => {
    for (let i = 0; i < 4; i++) await post(room, '/turn', { turnId: `turn-${i}`, commit: true });

    // Same storage, brand-new instance: exactly what an eviction looks like.
    const revived = makeRoom(fakeState(state.store));
    const turn = await post(revived, '/turn', { turnId: 'turn-after-evict', commit: false });
    expect(turn.data.remaining).toBe(LIMIT - 4);
  });

  it('caps the roster and keeps re-entry idempotent so a token renewal keeps its seat', async () => {
    for (let i = 1; i < GUEST_ROOM_LIMITS.maxParticipants; i++) {
      const join = await post(room, '/join', { visitorId: `guest-${i}`, name: `Guest ${i}` });
      expect(join.status).toBe(200);
    }
    const full = await post(room, '/join', { visitorId: 'one-too-many', name: 'Late' });
    expect(full.status).toBe(409);

    // The host renewing their hour-old token must not be treated as a new arrival.
    const renew = await post(room, '/join', { visitorId: 'host-1', name: 'Ada' });
    expect(renew.status).toBe(200);
    const roster = (renew.data.state as { participants: unknown[] }).participants;
    expect(roster).toHaveLength(GUEST_ROOM_LIMITS.maxParticipants);
  });

  it('answers 410 once the room has outlived its TTL, and forgets its transcript', async () => {
    await post(room, '/messages', { messages: [{ role: 'user', content: 'hello' }] });

    // Age the room past its lifetime, then rebuild from that storage.
    const meta = state.store.get('meta') as { createdAt: string };
    meta.createdAt = new Date(Date.now() - (GUEST_ROOM_LIMITS.ttlMinutes + 1) * 60_000).toISOString();
    state.store.set('meta', meta);
    const expired = makeRoom(fakeState(state.store));

    const turn = await post(expired, '/turn', { turnId: 'x', commit: true });
    expect(turn.status).toBe(410);
    expect(state.store.size).toBe(0);
  });
});

describe('GuestRoomDO transcript claim (surviving sign-up)', () => {
  let state: Fake;
  let room: GuestRoomDO;

  beforeEach(async () => {
    state = fakeState();
    room = makeRoom(state);
    await post(room, '/open', { code: newRoomCode(), visitorId: 'host-1', name: 'Ada', title: 'Launch plan' });
    await post(room, '/join', { visitorId: 'guest-2', name: 'Bo' });
    await post(room, '/messages', { messages: [{ role: 'user', content: 'what should we build?' }, { role: 'assistant', content: 'start here' }] });
  });

  it('hands the transcript to a participant — a tenant JWT alone is not membership', async () => {
    const claim = await post(room, '/claim', { visitorId: 'guest-2' });
    expect(claim.status).toBe(200);
    expect(claim.data.alreadyClaimed).toBe(false);
    expect(claim.data.title).toBe('Launch plan');
    expect((claim.data.messages as unknown[])).toHaveLength(2);

    // Someone who was never in this room cannot take its conversation, however
    // legitimately signed-in they are.
    const stranger = await post(room, '/claim', { visitorId: 'never-here' });
    expect(stranger.status).toBe(403);
  });

  it('claims once per visitor, so signing in again cannot fork a second copy', async () => {
    await post(room, '/claim', { visitorId: 'host-1' });
    const again = await post(room, '/claim', { visitorId: 'host-1' });
    expect(again.data.alreadyClaimed).toBe(true);
    expect(again.data.messages).toEqual([]);

    // …and the record survives eviction, or "again" would just mean "a while later".
    const revived = makeRoom(fakeState(state.store));
    const later = await post(revived, '/claim', { visitorId: 'host-1' });
    expect(later.data.alreadyClaimed).toBe(true);
  });

  it('leaves the room running — other people may still be talking in it', async () => {
    await post(room, '/claim', { visitorId: 'host-1' });
    const stillThere = await post(room, '/claim', { visitorId: 'guest-2' });
    expect(stillThere.data.alreadyClaimed).toBe(false);
    expect((stillThere.data.messages as unknown[])).toHaveLength(2);
  });

  it('answers 410 for an expired room rather than resurrecting a wiped transcript', async () => {
    const meta = state.store.get('meta') as { createdAt: string };
    meta.createdAt = new Date(Date.now() - (GUEST_ROOM_LIMITS.ttlMinutes + 1) * 60_000).toISOString();
    state.store.set('meta', meta);
    const expired = makeRoom(fakeState(state.store));
    expect((await post(expired, '/claim', { visitorId: 'host-1' })).status).toBe(410);
  });
});

describe('GuestRoomDO shared transcript', () => {
  it('gives every participant the same ordered list, bounded so it cannot grow forever', async () => {
    const state = fakeState();
    const room = makeRoom(state);
    const code = newRoomCode();
    await post(room, '/open', { code, visitorId: 'host-1', name: 'Ada' });

    await post(room, '/messages', { messages: [{ role: 'user', content: 'first', metadata: '{"guestAuthor":"Ada"}' }] });
    await post(room, '/messages', { messages: [{ role: 'assistant', content: 'reply' }] });

    const res = await room.fetch(new Request('https://guest-room/messages'));
    const { messages } = await res.json() as { messages: Array<{ role: string; content: string; seq: number; metadata: string | null }> };
    expect(messages.map((m) => m.content)).toEqual(['first', 'reply']);
    expect(messages.map((m) => m.seq)).toEqual([0, 1]);
    expect(messages[0]?.metadata).toContain('Ada');

    // Overflow the retention window; the oldest entries fall off, ids stay unique.
    for (let i = 0; i < GUEST_ROOM_LIMITS.maxMessages; i++) {
      await post(room, '/messages', { messages: [{ role: 'user', content: `m${i}` }] });
    }
    const after = await (await room.fetch(new Request('https://guest-room/messages'))).json() as { messages: Array<{ id: number }> };
    expect(after.messages).toHaveLength(GUEST_ROOM_LIMITS.maxMessages);
    expect(new Set(after.messages.map((m) => m.id)).size).toBe(GUEST_ROOM_LIMITS.maxMessages);
  });
});
