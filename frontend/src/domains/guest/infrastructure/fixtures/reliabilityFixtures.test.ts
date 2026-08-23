/**
 * @vitest-environment jsdom
 *
 * The Reliability reads, answered from the sample workspace.
 *
 * Every case here is a tab that a signed-out visitor was shown a red
 * `Missing or malformed Authorization header` card on, under a banner promising
 * them a sample workspace. The assertions are therefore about COVERAGE first —
 * does the read resolve at all — and about the roll-up being derived rather than
 * typed, because a hand-written total is how a fixture starts lying the day
 * somebody adds a row.
 */
import { describe, it, expect } from 'vitest';
import { resolveGuestRead } from '../../application/guestRead';

const read = (path: string) => resolveGuestRead({ path, method: 'GET', hadToken: false });

describe('reliability fixtures', () => {
  it('answers every read the /incidents tabs fire', () => {
    for (const path of [
      '/api/incidents?activeOnly=false',
      '/api/incidents/on-call/rotations',
      '/api/incidents/escalation/policies',
      '/api/incidents/contacts',
      '/api/monitoring/boards',
      '/api/monitoring/report',
    ]) {
      expect(read(path), path).not.toBeNull();
    }
  });

  it('honours ?activeOnly=true rather than answering the same list twice', () => {
    const all = read('/api/incidents?activeOnly=false')!.body as { incidents: unknown[] };
    const active = read('/api/incidents?activeOnly=true')!.body as { incidents: { resolvedAt: string | null }[] };
    expect(active.incidents.length).toBeLessThan(all.incidents.length);
    expect(active.incidents.every((row) => row.resolvedAt == null)).toBe(true);
  });

  it('derives the report from the incident rows, never beside them', () => {
    const all = read('/api/incidents?activeOnly=false')!.body as { incidents: { severity: string }[] };
    const report = read('/api/monitoring/report')!.body as {
      monitors: { total: number; ok: number; breached: number };
      incidents: { total: number; open: number; bySeverity: Record<string, number>; mttrMinutes: number | null };
    };
    expect(report.incidents.total).toBe(all.incidents.length);
    expect(report.incidents.open).toBeGreaterThan(0);
    // The tally sums back to the rows it was counted from.
    const tallied = Object.values(report.incidents.bySeverity).reduce((a, b) => a + b, 0);
    expect(tallied).toBe(all.incidents.length);
    // A workspace with resolved incidents has an MTTR; one without must say
    // `null` rather than 0, which reads as "instant" instead of "unknown".
    expect(report.incidents.mttrMinutes).toBeGreaterThan(0);
    expect(report.monitors.ok + report.monitors.breached).toBe(report.monitors.total);
  });

  it('points the on-call rotation at the roster the rest of the workspace uses', () => {
    // A second cast of invented names is how a sample workspace stops reading as
    // one business — the visitor meets "Atlas" on the board and somebody else
    // entirely on the pager.
    const { rotations } = read('/api/incidents/on-call/rotations')!.body as {
      rotations: { onCall: { displayName: string | null } | null; members: unknown[] }[];
    };
    expect(rotations.length).toBeGreaterThan(0);
    expect(rotations[0]!.onCall?.displayName).toBe('Atlas');
    expect(rotations[0]!.members.length).toBeGreaterThan(1);
  });

  it('keeps every escalation target pointing at something in the fixture', () => {
    // A ladder whose level 2 pages a rotation id that does not exist is a demo
    // that falls apart the moment somebody clicks it.
    const { policies } = read('/api/incidents/escalation/policies')!.body as {
      policies: { levels: { targetKind: string; targetRef: string | null }[] }[];
    };
    const { rotations } = read('/api/incidents/on-call/rotations')!.body as { rotations: { id: string }[] };
    const { contacts } = read('/api/incidents/contacts')!.body as { contacts: { id: string }[] };
    const known = new Set([...rotations.map((r) => r.id), ...contacts.map((c) => c.id)]);

    const levels = policies.flatMap((policy) => policy.levels);
    expect(levels.length).toBeGreaterThan(0);
    for (const level of levels) {
      if (level.targetKind !== 'oncall_rotation' && level.targetKind !== 'contact') continue;
      expect(known.has(level.targetRef ?? ''), `${level.targetKind} ${level.targetRef}`).toBe(true);
    }
  });

  it('never invents a mailable address', () => {
    // `.invalid` is reserved by RFC 2606, so a sample contact cannot be emailed
    // or paged by accident out of a screenshot.
    const { contacts } = read('/api/incidents/contacts')!.body as { contacts: { email: string | null }[] };
    for (const contact of contacts) {
      expect(contact.email?.endsWith('.invalid') ?? true, contact.email ?? '').toBe(true);
    }
  });
});
