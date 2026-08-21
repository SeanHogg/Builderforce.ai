/**
 * Sharing a board, tested WITHOUT a browser, a socket or a canvas.
 *
 * Every assertion here used to require mounting `CreationCanvas.tsx` — 940 KB of
 * component, ~35 s per render — which is why none of them existed. The two rules
 * that decide whether a shared board works (echo suppression, the hydration
 * gate) were reachable only through a `useCallback` closed over three refs.
 */

import { describe, expect, it, vi } from 'vitest';
import { createSharedSession, serializeForRoom, type GuestRoomPort } from './ShareCanvasSession';

const t = (key: string) => key;

function room(overrides: Partial<GuestRoomPort> = {}) {
  return {
    open: vi.fn(async () => ({ code: 'ROOM1' })),
    fetchBoard: vi.fn(async () => null),
    pushBoard: vi.fn(async () => true),
    announce: vi.fn(),
    leave: vi.fn(async () => undefined),
    ...overrides,
  } satisfies GuestRoomPort;
}

describe('decidePush', () => {
  it('refuses to push a private board', () => {
    const session = createSharedSession(room());
    expect(session.decidePush('{"nodes":[]}')).toEqual({ push: false, reason: 'solo' });
  });

  it('HOLDS every push until this device has read the room', () => {
    // The bug this prevents: an invitee mounts on the default starter board and
    // the 300ms save debounce fires before the first pull lands, so the empty
    // starter board is pushed over the host's real one and joining wipes it.
    const session = createSharedSession(room());
    session.enter('ROOM1');
    expect(session.decidePush('{"nodes":[]}')).toEqual({ push: false, reason: 'hydrating' });
    session.markHydrated();
    expect(session.decidePush('{"nodes":[]}')).toMatchObject({ push: true, code: 'ROOM1' });
  });

  it('never pushes back the board it just pulled', () => {
    // Two peers echoing one board is a permanent round-trip over a canvas
    // neither of them is touching.
    const session = createSharedSession(room());
    session.enter('ROOM1');
    session.markHydrated();
    session.noteExchanged('{"nodes":[1]}');
    expect(session.decidePush('{"nodes":[1]}')).toEqual({ push: false, reason: 'echo' });
    expect(session.decidePush('{"nodes":[2]}')).toMatchObject({ push: true });
  });

  it('closes the gate again when the room changes', () => {
    // Entering a SECOND room means a second board that has not been read. Keeping
    // the gate open across the switch is the wipe again, one room along.
    const session = createSharedSession(room());
    session.enter('ROOM1');
    session.markHydrated();
    session.enter('ROOM2');
    expect(session.hydrated()).toBe(false);
    expect(session.decidePush('{"nodes":[]}')).toEqual({ push: false, reason: 'hydrating' });
  });
});

describe('push', () => {
  it('announces only a board the room actually stored', async () => {
    const gateway = room({ pushBoard: vi.fn(async () => false) });
    const session = createSharedSession(gateway);
    session.enter('ROOM1');
    session.markHydrated();

    const outcome = await session.push('{"nodes":[3]}', t);

    expect(outcome).toEqual({ stored: false, notice: 'sharedBoardTooLarge' });
    // Telling peers to come and read a board the room refused sends every one of
    // them to a stale copy.
    expect(gateway.announce).not.toHaveBeenCalled();
  });

  it('reports nothing at all when the decision was not to push', async () => {
    const gateway = room();
    const session = createSharedSession(gateway);
    expect(await session.push('{"nodes":[]}', t)).toBeNull();
    expect(gateway.pushBoard).not.toHaveBeenCalled();
  });
});

describe('pull', () => {
  it('opens the gate for a room with no board yet, so this device becomes the host', async () => {
    const session = createSharedSession(room({ fetchBoard: vi.fn(async () => null) }));
    session.enter('ROOM1');
    expect(await session.pull(() => null)).toBeNull();
    expect(session.hydrated()).toBe(true);
  });

  it('refuses a corrupt payload rather than wiping a good local board', async () => {
    const session = createSharedSession(room({ fetchBoard: vi.fn(async () => 'not json') }));
    session.enter('ROOM1');
    expect(await session.pull(() => null)).toEqual({ adopt: false, reason: 'unparseable' });
  });

  it('refuses a payload that parses but is not a board', async () => {
    const session = createSharedSession(room({ fetchBoard: vi.fn(async () => '{"title":"hi"}') }));
    session.enter('ROOM1');
    expect(await session.pull(() => null)).toEqual({ adopt: false, reason: 'not-a-board' });
  });

  it('adopting a board suppresses the echo it would otherwise cause', async () => {
    const board = serializeForRoom({ nodes: [{ id: 'a' }], edges: [] });
    const session = createSharedSession(room({ fetchBoard: vi.fn(async () => board) }));
    session.enter('ROOM1');

    const decision = await session.pull((raw) => JSON.parse(raw) as { nodes: unknown[]; edges: unknown[] });

    expect(decision).toMatchObject({ adopt: true });
    expect(session.decidePush(board)).toEqual({ push: false, reason: 'echo' });
  });
});

describe('start and stop', () => {
  it('carries the board into the room and needs no pull', async () => {
    const gateway = room();
    const session = createSharedSession(gateway);

    const result = await session.start({ hostName: 'Sam', title: 'Launch', board: '{"nodes":[9]}' }, t);

    expect(result).toEqual({ started: true, code: 'ROOM1', notice: 'sharedStarted' });
    expect(gateway.pushBoard).toHaveBeenCalledWith('ROOM1', '{"nodes":[9]}');
    // The host's board IS the room's board — "invite people to this canvas" that
    // starts them on an empty one would be a different, worse feature.
    expect(session.hydrated()).toBe(true);
    expect(session.decidePush('{"nodes":[9]}')).toEqual({ push: false, reason: 'echo' });
  });

  it('falls back to the localized host name when none was typed', async () => {
    const gateway = room();
    await createSharedSession(gateway).start({ hostName: '   ', title: 'Launch', board: '{}' }, t);
    expect(gateway.open).toHaveBeenCalledWith('sharedDefaultHostName', 'Launch');
  });

  it('distinguishes a room that could not be opened from one that has ended', async () => {
    const unavailable = createSharedSession(room({ open: vi.fn(async () => 'unavailable' as const) }));
    expect(await unavailable.start({ hostName: 'Sam', title: 'x', board: '{}' }, t)).toEqual({ started: false, notice: 'sharedUnavailable' });
    const gone = createSharedSession(room({ open: vi.fn(async () => 'gone' as const) }));
    expect(await gone.start({ hostName: 'Sam', title: 'x', board: '{}' }, t)).toEqual({ started: false, notice: 'sharedEnded' });
  });

  it('leaves the room and returns to private editing', async () => {
    const gateway = room();
    const session = createSharedSession(gateway);
    await session.start({ hostName: 'Sam', title: 'x', board: '{}' }, t);

    expect(await session.stop(t)).toEqual({ notice: 'sharedLeft' });

    expect(gateway.leave).toHaveBeenCalledWith('ROOM1');
    expect(session.code()).toBeNull();
    expect(session.decidePush('{"nodes":[]}')).toEqual({ push: false, reason: 'solo' });
  });

  it('does not call the room when there was nothing to leave', async () => {
    const gateway = room();
    await createSharedSession(gateway).stop(t);
    expect(gateway.leave).not.toHaveBeenCalled();
  });
});
