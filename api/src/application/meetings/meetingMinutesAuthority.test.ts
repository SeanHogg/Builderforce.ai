import { describe, expect, it } from 'vitest';
import { mayAuthorMeetingMinutes } from './meetingMinutesAuthority';

const dbWith = (rows: Array<{ memberRef: string }>) => ({
  select: () => ({ from: () => ({ where: async () => rows }) }),
}) as never;
const meeting = { id: 'm1', tenantId: 1, createdBy: 'org' };

describe('mayAuthorMeetingMinutes', () => {
  it('accepts the organizer without reading attendees', async () => {
    expect(await mayAuthorMeetingMinutes({} as never, meeting, 'org')).toBe(true);
  });
  it('rejects a non-organizer attendee of a multi-person meeting', async () => {
    expect(await mayAuthorMeetingMinutes(dbWith([{ memberRef: 'org' }, { memberRef: 'bob' }]), meeting, 'bob')).toBe(false);
  });
  it('accepts the only human attendee', async () => {
    expect(await mayAuthorMeetingMinutes(dbWith([{ memberRef: 'bob' }]), meeting, 'bob')).toBe(true);
  });
  it('rejects an anonymous caller', async () => {
    expect(await mayAuthorMeetingMinutes({} as never, meeting, null)).toBe(false);
  });
});
