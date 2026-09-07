import { describe, it, expect } from 'vitest';
import { canvasPresenceFrame, CANVAS_PRESENCE_FRAME } from '@builderforce/creation-canvas-contract';
import {
  applyPresenceFrame, dropPresence, expirePresence, isPresenceFrame, mergeLivePresence,
  spatialPeers, LIVE_PRESENCE_TTL_MS, type LivePresenceMap,
} from './livePresence';

const frame = (over: Record<string, unknown> = {}) => ({ type: CANVAS_PRESENCE_FRAME, ...over } as never);

describe('canvasPresenceFrame (the shape the relay carries)', () => {
  it('keeps a cursor, a viewport and a typing flag', () => {
    expect(canvasPresenceFrame({ cursor: { x: 3, y: 4 }, viewport: { x: 1, y: 2, zoom: 0.5 }, typing: true }))
      .toEqual({ cursor: { x: 3, y: 4 }, viewport: { x: 1, y: 2, zoom: 0.5 }, typing: true });
  });

  it('drops every field that is not presence, however it is dressed up', () => {
    expect(canvasPresenceFrame({ cursor: { x: 1, y: 1 }, objects: [{ title: 'secret' }], tenantId: 4 }))
      .toEqual({ cursor: { x: 1, y: 1 } });
  });

  it('treats NaN, Infinity and an out-of-range coordinate as no pointer', () => {
    expect(canvasPresenceFrame({ cursor: { x: Number.NaN, y: 0 } })).toEqual({ cursor: null });
    expect(canvasPresenceFrame({ cursor: { x: Number.POSITIVE_INFINITY, y: 0 } })).toEqual({ cursor: null });
    expect(canvasPresenceFrame({ cursor: { x: 1e12, y: 0 } })).toEqual({ cursor: null });
  });

  it('preserves an explicit retraction and refuses a zero zoom', () => {
    expect(canvasPresenceFrame({ cursor: null })).toEqual({ cursor: null });
    expect(canvasPresenceFrame({ viewport: { x: 0, y: 0, zoom: 0 } })).toBeNull();
  });

  it('returns null when there is nothing to relay', () => {
    expect(canvasPresenceFrame({ type: CANVAS_PRESENCE_FRAME })).toBeNull();
    expect(canvasPresenceFrame('nope')).toBeNull();
    expect(canvasPresenceFrame(null)).toBeNull();
  });
});

describe('the live presence map', () => {
  it('recognises only the relay frame', () => {
    expect(isPresenceFrame({ type: CANVAS_PRESENCE_FRAME })).toBe(true);
    expect(isPresenceFrame({ type: 'canvas.changed' })).toBe(false);
    expect(isPresenceFrame(null)).toBe(false);
  });

  it('folds a frame in under the SERVER-stamped user id', () => {
    const next = applyPresenceFrame({}, frame({ userId: 'u1', from: 'p1', cursor: { x: 5, y: 6 } }), 1_000);
    expect(next.u1).toEqual({ cursor: { x: 5, y: 6 }, atMs: 1_000, socketId: 'p1' });
  });

  it('ignores an unattributed frame rather than drawing an anonymous cursor', () => {
    const map: LivePresenceMap = {};
    expect(applyPresenceFrame(map, frame({ cursor: { x: 1, y: 1 } }), 1)).toBe(map);
  });

  it('merges partial frames — a viewport frame does not erase the cursor', () => {
    const first = applyPresenceFrame({}, frame({ userId: 'u1', cursor: { x: 5, y: 6 } }), 1_000);
    const second = applyPresenceFrame(first, frame({ userId: 'u1', viewport: { x: 0, y: 0, zoom: 2 } }), 1_100);
    expect(second.u1).toMatchObject({ cursor: { x: 5, y: 6 }, viewport: { x: 0, y: 0, zoom: 2 }, atMs: 1_100 });
  });

  it('expires a peer that stopped talking, and keeps one that has not', () => {
    const map = applyPresenceFrame({}, frame({ userId: 'u1', cursor: { x: 1, y: 1 } }), 0);
    expect(expirePresence(map, LIVE_PRESENCE_TTL_MS - 1)).toBe(map);
    expect(expirePresence(map, LIVE_PRESENCE_TTL_MS + 1)).toEqual({});
  });

  it('drops a peer outright, and is a no-op for one it never had', () => {
    const map = applyPresenceFrame({}, frame({ userId: 'u1', cursor: { x: 1, y: 1 } }), 0);
    expect(dropPresence(map, 'u1')).toEqual({});
    expect(dropPresence(map, 'someone-else')).toBe(map);
  });
});

describe('mergeLivePresence', () => {
  const roster = [
    { userId: 'me', displayName: 'Me', cursor: { x: 0, y: 0 } },
    { userId: 'u1', displayName: 'Ada', cursor: { x: 100, y: 100 } },
  ];

  it('overlays the live position on the roster row that owns the name', () => {
    const live = applyPresenceFrame({}, frame({ userId: 'u1', cursor: { x: 7, y: 8 } }), 0);
    const merged = mergeLivePresence(roster, live, 'me');
    expect(merged[1]).toMatchObject({ userId: 'u1', displayName: 'Ada', cursor: { x: 7, y: 8 } });
  });

  it('never overwrites the reader with a relayed copy of their own pointer', () => {
    const live = applyPresenceFrame({}, frame({ userId: 'me', cursor: { x: 9, y: 9 } }), 0);
    expect(mergeLivePresence(roster, live, 'me')[0]).toBe(roster[0]);
  });

  it('appends a peer who joined between two polls, unnamed until the poll names them', () => {
    const live = applyPresenceFrame({}, frame({ userId: 'u2', cursor: { x: 3, y: 3 } }), 0);
    const merged = mergeLivePresence(roster, live, 'me');
    expect(merged).toHaveLength(3);
    expect(merged[2]).toMatchObject({ userId: 'u2', cursor: { x: 3, y: 3 } });
  });

  it('carries a retraction through, so a pointer that left the board stops being drawn', () => {
    const live = applyPresenceFrame({}, frame({ userId: 'u1', cursor: null }), 0);
    expect(mergeLivePresence(roster, live, 'me')[1]).toMatchObject({ cursor: null });
  });
});

/**
 * The spatial half. It rides the SAME frame as the pointer deliberately — a
 * cursor and a body are one question asked by two surfaces — so these cases are
 * really about one thing: a room and a board can never disagree about whether
 * somebody is still connected, because there is only one record to disagree with.
 */
describe('spatial presence (the body a room surface draws)', () => {
  const body = { position: [1, 0, 2] as [number, number, number], yaw: 0.5, seat: 3 };

  it('carries a position, a yaw and a seat', () => {
    expect(canvasPresenceFrame({ spatial: body })).toEqual({ spatial: body });
  });

  it('lets a body ride alongside a pointer without either erasing the other', () => {
    const live = applyPresenceFrame({}, frame({ userId: 'u1', spatial: body }), 0);
    const both = applyPresenceFrame(live, frame({ userId: 'u1', cursor: { x: 2, y: 2 } }), 1);
    expect(both.u1).toMatchObject({ spatial: body, cursor: { x: 2, y: 2 } });
  });

  it('treats a malformed body as having left, rather than freezing it where it stood', () => {
    expect(canvasPresenceFrame({ spatial: { position: [1, 2], yaw: 0 } })).toEqual({ spatial: null });
    expect(canvasPresenceFrame({ spatial: { position: [1, Number.NaN, 2], yaw: 0 } })).toEqual({ spatial: null });
    expect(canvasPresenceFrame({ spatial: { position: [1, 0, 2], yaw: Number.POSITIVE_INFINITY } })).toEqual({ spatial: null });
  });

  it('refuses a body outside any plausible room', () => {
    expect(canvasPresenceFrame({ spatial: { position: [1e6, 0, 0], yaw: 0 } })).toEqual({ spatial: null });
  });

  it('drops a seat that is not a ring index, keeping the body', () => {
    expect(canvasPresenceFrame({ spatial: { position: [0, 0, 0], yaw: 0, seat: -1 } }))
      .toEqual({ spatial: { position: [0, 0, 0], yaw: 0 } });
    expect(canvasPresenceFrame({ spatial: { position: [0, 0, 0], yaw: 0, seat: 1.5 } }))
      .toEqual({ spatial: { position: [0, 0, 0], yaw: 0 } });
  });

  it('preserves an explicit retraction, so leaving the room removes the avatar', () => {
    expect(canvasPresenceFrame({ spatial: null })).toEqual({ spatial: null });
  });

  it('lists only peers with a body, never the reader, in a stable order', () => {
    let live: LivePresenceMap = {};
    live = applyPresenceFrame(live, frame({ userId: 'u2', spatial: body }), 0);
    live = applyPresenceFrame(live, frame({ userId: 'u1', spatial: body }), 0);
    live = applyPresenceFrame(live, frame({ userId: 'me', spatial: body }), 0);
    // Somebody on the flat board: present, but not in the room.
    live = applyPresenceFrame(live, frame({ userId: 'u3', cursor: { x: 1, y: 1 } }), 0);

    expect(spatialPeers(live, 'me').map((peer) => peer.userId)).toEqual(['u1', 'u2']);
  });

  it('stops listing a peer the board has already expired, so the two readings agree', () => {
    const live = applyPresenceFrame({}, frame({ userId: 'u1', spatial: body }), 0);
    expect(spatialPeers(expirePresence(live, LIVE_PRESENCE_TTL_MS + 1), 'me')).toEqual([]);
  });
});
