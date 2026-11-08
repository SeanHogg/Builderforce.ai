import { describe, expect, it, vi } from 'vitest';

vi.mock('../governance/mutationAudit', () => ({ recordGovernanceMutation: vi.fn(async () => undefined) }));

import { buildFindingIncident, findingIncidentRef, openIncidentsForCriticalFindings } from './criticalFindingIncidents';

const ctx = { tenantId: 1, segmentId: 'seg', where: 'https://x/pr/1', repoRef: 'acme/api' };
const actor = { type: 'system' as const, ref: null, name: 'System' };
const finding = { id: 'f1', title: 'Private key committed', fingerprint: 'abc123', filePath: 'a.ts', scanId: 's1' };

type Incident = { id: string; status: 'open' | 'resolved' | 'investigating'; reopenedTimes: number };

/**
 * A db whose incident insert behaves like the partial unique index PLUS the conflict clause: a new ref
 * inserts; a repeated ref reopens it only if it is not open (setWhere), otherwise writes nothing.
 */
function fakeDb(criticals: unknown[]) {
  const byRef = new Map<string, Incident>();
  const db = {
    select: () => ({ from: () => ({ where: async () => criticals }) }),
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        onConflictDoUpdate: (cfg: { setWhere?: unknown }) => ({
          returning: async () => {
            expect(cfg.setWhere).toBeDefined(); // an open incident must be left alone
            const ref = String(row.sourceRef);
            const existing = byRef.get(ref);
            if (!existing) {
              const created: Incident = { id: `inc-${byRef.size + 1}`, status: 'open', reopenedTimes: 0 };
              byRef.set(ref, created);
              return [{ id: created.id }];
            }
            // mirrors setWhere: only resolved/closed reopen; open and in-progress states are left alone
            if (existing.status !== 'resolved') return [];
            existing.status = 'open';
            existing.reopenedTimes += 1;
            return [{ id: existing.id }];
          },
        }),
      }),
    }),
  };
  return { db: db as never, byRef };
}

describe('critical finding -> incident', () => {
  it('builds an agent-detected incident keyed by repo AND finding fingerprint', () => {
    const row = buildFindingIncident(finding, ctx);
    expect(row.detectionSource).toBe('agent');
    expect(row.severity).toBe('critical');
    expect(row.sourceRef).toBe(findingIncidentRef('acme/api', 'abc123'));
    expect(row.sourceRef).toBe('finding:acme/api:abc123');
    expect(buildFindingIncident(finding, { ...ctx, repoRef: 'acme/web' }).sourceRef).not.toBe(row.sourceRef);
  });

  it('opens exactly one incident however many times the same finding is processed', async () => {
    const { db, byRef } = fakeDb([finding]);
    expect(await openIncidentsForCriticalFindings({} as never, db, actor, ctx, ['s1'])).toBe(1);
    expect(await openIncidentsForCriticalFindings({} as never, db, actor, ctx, ['s1'])).toBe(0);
    expect(byRef.size).toBe(1);
  });

  it('REOPENS a resolved incident when the finding recurs, instead of leaving it resolved', async () => {
    const { db, byRef } = fakeDb([finding]);
    await openIncidentsForCriticalFindings({} as never, db, actor, ctx, ['s1']);
    byRef.get('finding:acme/api:abc123')!.status = 'resolved';
    expect(await openIncidentsForCriticalFindings({} as never, db, actor, ctx, ['s1'])).toBe(1);
    const inc = byRef.get('finding:acme/api:abc123')!;
    expect(inc.status).toBe('open');
    expect(inc.reopenedTimes).toBe(1);
    // and an incident that is open again is not reopened a second time
    expect(await openIncidentsForCriticalFindings({} as never, db, actor, ctx, ['s1'])).toBe(0);
  });

  it('leaves an in-progress incident alone when the finding recurs', async () => {
    const { db, byRef } = fakeDb([finding]);
    await openIncidentsForCriticalFindings({} as never, db, actor, ctx, ['s1']);
    byRef.get('finding:acme/api:abc123')!.status = 'investigating';
    expect(await openIncidentsForCriticalFindings({} as never, db, actor, ctx, ['s1'])).toBe(0);
    expect(byRef.get('finding:acme/api:abc123')!.status).toBe('investigating');
  });

  it('opens one incident per distinct fingerprint', async () => {
    const { db, byRef } = fakeDb([finding, { ...finding, id: 'f2', fingerprint: 'def456' }]);
    expect(await openIncidentsForCriticalFindings({} as never, db, actor, ctx, ['s1'])).toBe(2);
    expect(byRef.size).toBe(2);
  });

  it('does nothing without scans', async () => {
    const { db } = fakeDb([finding]);
    expect(await openIncidentsForCriticalFindings({} as never, db, actor, ctx, [])).toBe(0);
  });
});
