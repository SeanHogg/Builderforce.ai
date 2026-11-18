import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../governance/mutationAudit', () => ({ recordGovernanceMutation: vi.fn(async () => undefined) }));

import { securityIncidents } from '../../infrastructure/database/schema';
import {
  buildKindIncident, FINDING_KINDS, kindOpensIncident, meetsSeverityFloor, openKindIncident,
  PLATFORM_INCIDENT_REF_PREDICATE, type FindingKindName,
} from './findingIncidentKinds';
import type { RuntimeShieldEvent } from './runtimeShieldEvent';

const ctx = { tenantId: 7, segmentId: 'seg' };
const actor = { type: 'human' as const, ref: 'u1', name: 'Dev' };
const shieldEvent: RuntimeShieldEvent = {
  category: 'database', ruleId: 'db-ownership', severity: 'high', reasonCode: 'db.not_owner', action: 'quarantine',
  applicationId: 'app-1', serviceId: 'api', projectId: 42, evidence: { database: 'orders', port: 5432 },
  occurredAt: '2026-11-18T10:00:00.000Z',
};

type Incident = { id: string; status: string };

/** Mirrors the unique index + conflict clause: a new ref inserts; a repeat reopens only a resolved/closed one. */
function fakeDb() {
  const byRef = new Map<string, Incident>();
  const conflicts: Array<{ target: unknown[]; targetWhere: unknown; setWhere: unknown; set: Record<string, unknown> }> = [];
  const rows: Record<string, unknown>[] = [];
  const db = {
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        onConflictDoUpdate: (cfg: (typeof conflicts)[number]) => ({
          returning: async () => {
            conflicts.push(cfg);
            rows.push(row);
            const ref = `${row.tenantId}|${row.segmentId}|${row.sourceRef}`;
            const existing = byRef.get(ref);
            if (!existing) {
              const created = { id: `inc-${byRef.size + 1}`, status: 'open' };
              byRef.set(ref, created);
              return [{ id: created.id }];
            }
            if (existing.status !== 'resolved' && existing.status !== 'closed') return [];
            existing.status = 'open';
            return [{ id: existing.id }];
          },
        }),
      }),
    }),
  };
  return { db: db as never, byRef, conflicts, rows };
}

describe('finding-kind registry', () => {
  it('every registered prefix is covered by the dedupe index predicate, which migration 1354 states verbatim', () => {
    const migration = readFileSync(fileURLToPath(new URL('../../../migrations/1354_security_incidents_shield_ref.sql', import.meta.url).href), 'utf8');
    expect(migration).toContain(`WHERE ${PLATFORM_INCIDENT_REF_PREDICATE}`);
    expect(migration).toContain('NULLS NOT DISTINCT');
    for (const kind of Object.keys(FINDING_KINDS) as FindingKindName[]) {
      expect(PLATFORM_INCIDENT_REF_PREDICATE).toContain(`source_ref LIKE '${FINDING_KINDS[kind].refPrefix}:%'`);
    }
  });

  it('orders severities low < medium < high < critical', () => {
    expect(meetsSeverityFloor('critical', 'high')).toBe(true);
    expect(meetsSeverityFloor('high', 'high')).toBe(true);
    expect(meetsSeverityFloor('medium', 'high')).toBe(false);
    expect(meetsSeverityFloor('high', 'critical')).toBe(false);
  });
});

describe('shield kind', () => {
  it('builds a client-attested runtime-shield incident keyed by project, application and rule', () => {
    const row = buildKindIncident('shield', shieldEvent, ctx);
    expect(row.sourceRef).toBe('shield:42:app-1:db-ownership');
    expect(row.detectionSource).toBe('runtime-shield');
    expect(row.attestation).toBe('client-attested');
    expect(row.severity).toBe('high');
    expect(row.evidence).toEqual({ database: 'orders', port: 5432 });
    expect(row.title).toContain('quarantined');
    expect(row.impact).toContain('Client-attested');
    expect(buildKindIncident('shield', { ...shieldEvent, serviceId: 'worker' }, ctx).sourceRef).toBe(row.sourceRef);
    expect(buildKindIncident('shield', { ...shieldEvent, applicationId: 'app-2' }, ctx).sourceRef).not.toBe(row.sourceRef);
  });

  it('opens only blocks and quarantines at or above the high floor — a probe never does', () => {
    expect(kindOpensIncident('shield', shieldEvent)).toBe(true);
    expect(kindOpensIncident('shield', { ...shieldEvent, action: 'reject', severity: 'critical' })).toBe(true);
    expect(kindOpensIncident('shield', { ...shieldEvent, severity: 'medium' })).toBe(false);
    for (const action of ['allow', 'monitor', 'throttle'] as const) {
      expect(kindOpensIncident('shield', { ...shieldEvent, action, severity: 'critical' })).toBe(false);
    }
  });

  it('ignores a probe without touching the database', async () => {
    const { db, rows } = fakeDb();
    expect(await openKindIncident(undefined, db, actor, 'shield', { ...shieldEvent, action: 'monitor' }, ctx)).toEqual({ outcome: 'ignored' });
    expect(rows).toHaveLength(0);
  });

  it('opens one incident for repeats of the same rule, and reopens it once resolved', async () => {
    const { db, byRef } = fakeDb();
    const first = await openKindIncident(undefined, db, actor, 'shield', shieldEvent, ctx);
    expect(first).toEqual({ outcome: 'opened', incidentId: 'inc-1' });
    expect(await openKindIncident(undefined, db, actor, 'shield', { ...shieldEvent, occurredAt: '2026-11-18T10:05:00.000Z' }, ctx))
      .toEqual({ outcome: 'deduplicated' });
    expect(byRef.size).toBe(1);
    byRef.get('7|seg|shield:42:app-1:db-ownership')!.status = 'resolved';
    expect(await openKindIncident(undefined, db, actor, 'shield', shieldEvent, ctx)).toEqual({ outcome: 'opened', incidentId: 'inc-1' });
  });

  it('keeps the tenant in the conflict target and restates the partial index predicate', async () => {
    const { db, conflicts } = fakeDb();
    await openKindIncident(undefined, db, actor, 'shield', shieldEvent, ctx);
    const cfg = conflicts[0]!;
    expect(cfg.target).toEqual([securityIncidents.tenantId, securityIncidents.segmentId, securityIncidents.sourceRef]);
    expect(cfg.targetWhere).toBeDefined();
    expect(cfg.setWhere).toBeDefined();
    expect(Object.keys(cfg.set)).toEqual(expect.arrayContaining(['status', 'resolvedAt', 'impact', 'evidence']));
  });

  it('two tenants reporting the same rule get two incidents', async () => {
    const { db, byRef } = fakeDb();
    await openKindIncident(undefined, db, actor, 'shield', shieldEvent, ctx);
    expect(await openKindIncident(undefined, db, actor, 'shield', shieldEvent, { ...ctx, tenantId: 8 }))
      .toMatchObject({ outcome: 'opened' });
    expect(byRef.size).toBe(2);
  });
});

describe('finding kind through the registry', () => {
  it('keeps the agent / critical / finding: mapping', () => {
    const row = buildKindIncident('finding', {
      finding: { id: 'f1', title: 'Leaked key', fingerprint: null, filePath: null, scanId: 's1' }, repoRef: 'acme/api', where: null,
    }, ctx);
    expect(row.sourceRef).toBe('finding:acme/api:id:f1');
    expect(row.detectionSource).toBe('agent');
    expect(row.severity).toBe('critical');
    expect(row.attestation).toBeNull();
    expect(row.evidence).toBeNull();
  });
});
