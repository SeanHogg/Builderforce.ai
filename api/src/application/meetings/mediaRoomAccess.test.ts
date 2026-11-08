/**
 * The registry's meeting rule is `canAccessMeeting` — manager / organizer / attendee /
 * project team — so a project-bound meeting's room is not open to the whole workspace.
 * It authorises ANY stored `meetings.roomKey`: the bare uuid and `ceremony-<uuid>`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadProjectTeamMembers = vi.fn();
vi.mock('../metrics/assigneeRecommender', () => ({
  loadProjectTeamMembers: (...args: unknown[]) => loadProjectTeamMembers(...args),
}));

const UUID = '11111111-2222-4333-8444-555555555555';
const TENANT = 7;
type Meeting = { id: string; tenantId: number; projectId: number | null; createdBy: string; roomKey: string; status: string };
const baseMeeting = (roomKey: string): Meeting => ({ id: 'm-1', tenantId: TENANT, projectId: 99, createdBy: 'organizer', roomKey, status: 'scheduled' });
let meetingRow: Meeting | null;
let attendees: Array<{ memberRef: string }>;

// Every tenant/room argument the access check passes to the query builders, so the
// tests can prove the lookups are tenant-scoped rather than just returning rows.
const scopedToTenant = vi.fn((..._args: unknown[]) => ({}));
const eq = vi.fn((..._args: unknown[]) => ({}));
vi.mock('../../infrastructure/database/tenantScope', () => ({ scopedToTenant: (...a: unknown[]) => scopedToTenant(...a) }));
vi.mock('../../infrastructure/database/schema', () => ({ meetings: { roomKey: 'roomKey', tenantId: 'tenantId' }, meetingAttendees: { meetingId: 'meetingId' } }));
vi.mock('drizzle-orm', () => ({ and: () => ({}), eq: (...a: unknown[]) => eq(...a) }));
vi.mock('../creation/sessionAccess', () => ({ resolveSessionAccess: vi.fn() }));
vi.mock('../project/projectOwnership', () => ({ projectInTenant: vi.fn() }));

// The meeting row is only returned for the caller's own tenant, like the real query.
function fakeDb() {
  const chain = (): any => ({
    from: () => chain(),
    where: () => chain(),
    limit: async () => {
      const tenantArg = eq.mock.calls.findLast(([col]) => col === 'tenantId')?.[1];
      return meetingRow && tenantArg === meetingRow.tenantId ? [meetingRow] : [];
    },
    then: (resolve: (v: unknown) => void) => resolve(attendees),
  });
  return { select: () => chain() } as never;
}

const { canJoinMediaRoom } = await import('./mediaRoomAccess');

const join = (key: string, userId: string, role = 'developer', tenantId = TENANT) =>
  canJoinMediaRoom(fakeDb(), undefined, { tenantId, userId, role }, key);

beforeEach(() => {
  meetingRow = baseMeeting(UUID);
  attendees = [{ memberRef: 'attendee' }];
  scopedToTenant.mockClear();
  eq.mockClear();
  loadProjectTeamMembers.mockReset();
  loadProjectTeamMembers.mockResolvedValue([{ memberRef: 'teammate' }]);
});

describe.each([
  ['bare uuid', UUID],
  ['ceremony-<uuid>', `ceremony-${UUID}`],
])('meeting room key: %s (project-bound meeting)', (_label, key) => {
  beforeEach(() => { meetingRow = baseMeeting(key); });

  it('admits the organizer, a listed attendee, a project teammate and a manager', async () => {
    expect(await join(key, 'organizer')).toBe(true);
    expect(await join(key, 'attendee')).toBe(true);
    expect(await join(key, 'teammate')).toBe(true);
    expect(await join(key, 'someone', 'manager')).toBe(true);
  });

  it('refuses a same-tenant user who is not an attendee and not on the project team', async () => {
    expect(await join(key, 'stranger')).toBe(false);
  });

  it("refuses another tenant's user", async () => {
    expect(await join(key, 'attendee', 'developer', 8)).toBe(false);
  });

  it('looks the FULL stored key up, in the caller tenant, and reads attendees tenant-scoped', async () => {
    await join(key, 'attendee');
    expect(eq).toHaveBeenCalledWith('roomKey', key);
    expect(eq).toHaveBeenCalledWith('tenantId', TENANT);
    expect(scopedToTenant).toHaveBeenCalledWith(expect.anything(), TENANT, expect.anything());
  });

  it('refuses a cancelled or ended meeting', async () => {
    for (const status of ['cancelled', 'ended']) {
      meetingRow = { ...baseMeeting(key), status };
      expect(await join(key, 'organizer')).toBe(false);
    }
  });
});

describe('tenant-wide meeting (no project)', () => {
  it('admits any member of the tenant, and nobody from another', async () => {
    meetingRow = { ...baseMeeting(UUID), projectId: null };
    expect(await join(UUID, 'stranger')).toBe(true);
    expect(loadProjectTeamMembers).not.toHaveBeenCalled();
    expect(await join(UUID, 'stranger', 'developer', 8)).toBe(false);
  });
});

describe('refusals', () => {
  it('denies machine subjects, malformed ids and a throwing check', async () => {
    expect(await join(UUID, 'agentHost:5')).toBe(false);
    expect(await join(UUID, 'embed:k1')).toBe(false);
    expect(await join('canvas:1234567890123456789012345678901234567', 'attendee')).toBe(false);
    loadProjectTeamMembers.mockRejectedValue(new Error('db down'));
    expect(await join(UUID, 'stranger')).toBe(false);
  });
});
