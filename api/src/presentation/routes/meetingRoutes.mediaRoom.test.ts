/**
 * `GET /rooms/:key/ws` authorises the room key against its domain BEFORE relaying:
 * a canvas member joins, a same-tenant non-member and another tenant's user do not,
 * and a key shape no domain claims is refused.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const MEMBER = 'user-member';
const OUTSIDER = 'user-outsider';
const TENANT = 7;
const OTHER_TENANT = 8;
let caller = { tenantId: TENANT, userId: MEMBER };

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', caller.tenantId);
    c.set('userId', caller.userId);
    c.set('role', 'developer');
    await next();
  },
  isManager: () => false,
}));

const resolveSessionAccess = vi.fn();
vi.mock('../../application/creation/sessionAccess', () => ({
  resolveSessionAccess: (...args: unknown[]) => resolveSessionAccess(...args),
}));

const projectInTenant = vi.fn();
vi.mock('../../application/project/projectOwnership', () => ({
  projectInTenant: (...args: unknown[]) => projectInTenant(...args),
}));

// The meeting domain's own check is covered by `mediaRoomAccess.test.ts`; here the route
// only needs to prove it asks it for `ceremony-<uuid>` keys and honours the answer.
const loadMeetingByRoomKey = vi.fn();
const canAccessMeeting = vi.fn();
vi.mock('../../application/meetings/meetingAccess', () => ({
  loadMeetingByRoomKey: (...args: unknown[]) => loadMeetingByRoomKey(...args),
  canAccessMeeting: (...args: unknown[]) => canAccessMeeting(...args),
}));

const iceServers = vi.fn(async () => [{ urls: 'stun:x' }]);
vi.mock('../../application/meetings/iceServers', () => ({ iceServers: (...args: unknown[]) => (iceServers as any)(...args) }));

const relayToRoom = vi.fn(async () => new Response('relayed', { status: 200 }));
vi.mock('./realtimeRelay', () => ({ relayToRoom: (...args: unknown[]) => (relayToRoom as any)(...args) }));

const { createMeetingRoutes } = await import('./meetingRoutes');

const BOARD = '11111111-2222-4333-8444-555555555555';
const ENV = { CEREMONY_ROOM: {} };
const DB = {} as never;

async function join(key: string) {
  const app = createMeetingRoutes(DB);
  return app.request(`/rooms/${encodeURIComponent(key)}/ws`, { headers: { Upgrade: 'websocket' } }, ENV);
}

beforeEach(() => {
  caller = { tenantId: TENANT, userId: MEMBER };
  resolveSessionAccess.mockReset();
  projectInTenant.mockReset();
  relayToRoom.mockClear();
  // Board access is the canvas's own gate: only the member, in the board's own tenant.
  resolveSessionAccess.mockImplementation(async (_db, _id, tenantId: number, userId: string) =>
    (tenantId === TENANT && userId === MEMBER ? { session: {}, role: 'viewer' } : null));
  projectInTenant.mockImplementation(async (_db, tenantId: number) => tenantId === TENANT);
  loadMeetingByRoomKey.mockReset();
  canAccessMeeting.mockReset();
  iceServers.mockClear();
  loadMeetingByRoomKey.mockImplementation(async (_db, _tenant, key: string) => ({ id: 'm', roomKey: key, status: 'live' }));
  canAccessMeeting.mockImplementation(async (_db, who: { userId: string }) => who.userId === 'attendee' || who.userId === 'teammate');
});

const ice = (room?: string) => createMeetingRoutes(DB).request(`/ice${room ? `?room=${encodeURIComponent(room)}` : ''}`, {}, ENV);

describe('ceremony-<uuid> (a ceremony session\'s companion meeting)', () => {
  const key = `ceremony-${BOARD}`;
  it('admits an attendee and a project teammate, looking up the FULL key', async () => {
    for (const userId of ['attendee', 'teammate']) {
      caller = { tenantId: TENANT, userId };
      expect((await join(key)).status).toBe(200);
    }
    expect(loadMeetingByRoomKey).toHaveBeenCalledWith(DB, TENANT, key);
  });

  it('is a 404 for a stranger', async () => {
    caller = { tenantId: TENANT, userId: 'stranger' };
    expect((await join(key)).status).toBe(404);
    expect(relayToRoom).not.toHaveBeenCalled();
  });

  it('is a 404 for a meeting that has ended or been cancelled', async () => {
    caller = { tenantId: TENANT, userId: 'attendee' };
    loadMeetingByRoomKey.mockResolvedValue({ id: 'm', roomKey: key, status: 'ended' });
    expect((await join(key)).status).toBe(404);
  });
});

describe('relay identity and ICE', () => {
  it('stamps the server-verified seat on the relayed socket', async () => {
    await join(`canvas:${BOARD}`);
    expect(relayToRoom).toHaveBeenCalledWith(expect.anything(), ENV.CEREMONY_ROOM, `media:canvas:${BOARD}`, { ref: `u:${MEMBER}`, kind: 'human' });
  });

  it('mints ICE only for a room the caller may join, as that caller', async () => {
    expect((await ice(`canvas:${BOARD}`)).status).toBe(200);
    expect(iceServers).toHaveBeenCalledWith(ENV, MEMBER);
    caller = { tenantId: TENANT, userId: OUTSIDER };
    expect((await ice(`canvas:${BOARD}`)).status).toBe(404);
    expect((await ice()).status).toBe(404);
  });

  it('refuses machine subjects', async () => {
    caller = { tenantId: TENANT, userId: 'agentHost:5' };
    expect((await ice(`canvas:${BOARD}`)).status).toBe(404);
    expect((await join(`canvas:${BOARD}`)).status).toBe(404);
  });
});

describe('GET /rooms/:key/ws authorisation', () => {
  it('relays a canvas room for a board member', async () => {
    const res = await join(`canvas:${BOARD}`);
    expect(res.status).toBe(200);
    expect(resolveSessionAccess).toHaveBeenCalledWith(DB, BOARD, TENANT, MEMBER, ENV);
    expect(relayToRoom).toHaveBeenCalledWith(expect.anything(), ENV.CEREMONY_ROOM, `media:canvas:${BOARD}`, expect.objectContaining({ kind: 'human' }));
  });

  it('refuses a same-tenant user who is not on the board', async () => {
    caller = { tenantId: TENANT, userId: OUTSIDER };
    const res = await join(`canvas:${BOARD}`);
    expect(res.status).toBe(404);
    expect(relayToRoom).not.toHaveBeenCalled();
  });

  it("refuses another tenant's user", async () => {
    caller = { tenantId: OTHER_TENANT, userId: MEMBER };
    const res = await join(`canvas:${BOARD}`);
    expect(res.status).toBe(404);
    expect(relayToRoom).not.toHaveBeenCalled();
  });

  it('refuses a key shape no domain claims', async () => {
    for (const key of ['guest:ABC', 'canvas:not-a-uuid', 'anything-else']) {
      expect((await join(key)).status).toBe(404);
    }
    expect(relayToRoom).not.toHaveBeenCalled();
  });

  it('authorises a ceremony room by its project, in the caller tenant only', async () => {
    expect((await join('ceremony-12')).status).toBe(200);
    caller = { tenantId: OTHER_TENANT, userId: MEMBER };
    expect((await join('ceremony-12')).status).toBe(404);
  });
});
