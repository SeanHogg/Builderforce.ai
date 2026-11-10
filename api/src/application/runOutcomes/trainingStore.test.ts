import { describe, expect, it } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import { consentingTenants, getTrainingConsent, perTenantCap, readCrossTenantTrainingRows, toAggregateRow } from './trainingStore';

/** With no sibling endpoint bound, the operational handle IS the core handle: one FIFO serves both. */
const dbOf = (results: unknown[][]) => fakeDb(results) as unknown as Db;

const featureRow = {
  id: 1, tenantId: 1, projectId: 9, runId: 'run-secret', repository: 'https://github.com/acme/private-repo',
  entryPoint: 'vscode', mode: 'interactive', modelTier: 'frontier', schemaVersion: 1,
  finalizedAt: new Date('2026-10-10T00:00:00Z'), featureValues: { 'size.linesAdded': 12, 'history.churn90d': null },
  digest: 'a'.repeat(64), requesterId: 'user-1', approverId: 'user-2', reviewerId: 'user-3', agentId: 'agent-9',
  createdAt: new Date('2026-10-10T00:00:00Z'),
};
const finalLabel = {
  id: 5, tenantId: 1, runId: 'run-secret', repository: 'https://github.com/acme/private-repo', kind: 'ci-red-after-merge',
  value: false, status: 'final', eventAt: null, windowEndsAt: new Date('2026-10-17T00:00:00Z'),
  evidence: { commit: 'beef1234', path: 'src/secret.ts' }, labellerVersion: 1, computedAt: new Date('2026-10-17T00:00:00Z'),
};

describe('training consent (§12.8)', () => {
  it('defaults by plan when no decision is recorded: free on, paid off', async () => {
    expect(await getTrainingConsent(dbOf([[], [{ plan: 'free' }]]), 1)).toMatchObject({ crossTenant: true, explicit: false });
    expect(await getTrainingConsent(dbOf([[], [{ plan: 'teams' }]]), 1)).toMatchObject({ crossTenant: false, explicit: false });
  });

  it('honours an explicit decision over the plan default', async () => {
    const decided = { tenantId: 1, crossTenant: false, decidedBy: 'user-1', decidedAt: new Date('2026-10-01T00:00:00Z') };
    expect(await getTrainingConsent(dbOf([[decided]]), 1)).toMatchObject({ crossTenant: false, explicit: true, decidedBy: 'user-1' });
  });

  it('selects consenting tenants by explicit row, else plan; a deleted tenant is out', async () => {
    const db = dbOf([
      [{ tenantId: 2, crossTenant: true }, { tenantId: 4, crossTenant: false }],
      [{ id: 1, plan: 'free' }, { id: 2, plan: 'teams' }, { id: 3, plan: 'pro' }, { id: 4, plan: 'free' }],
    ]);
    expect(await consentingTenants(db, [1, 2, 3, 4, 5])).toEqual([1, 2]);
  });
});

describe('cross-tenant aggregate', () => {
  it('carries only the numeric vector and final labels: no tenant, run, repository, path or person id', async () => {
    const db = dbOf([
      [{ tenantId: 1 }],          // tenants present
      [],                         // explicit consent rows
      [{ id: 1, plan: 'free' }],  // plans
      [featureRow],               // features
      [finalLabel],               // final labels
    ]);
    const rows = await readCrossTenantTrainingRows(db);
    expect(rows).toEqual([{
      schemaVersion: 1,
      finalizedAt: '2026-10-10',
      values: { 'size.linesAdded': 12, 'history.churn90d': null },
      labels: [{ kind: 'ci-red-after-merge', value: false, labellerVersion: 1 }],
    }]);
    const text = JSON.stringify(rows);
    for (const secret of ['run-secret', 'private-repo', 'user-1', 'user-2', 'user-3', 'agent-9', 'src/secret.ts', 'beef1234']) {
      expect(text).not.toContain(secret);
    }
  });

  it('reads nothing past the consent check when no tenant consents', async () => {
    const db = fakeDb([[{ tenantId: 1 }], [], [{ id: 1, plan: 'pro' }]]);
    expect(await readCrossTenantTrainingRows(db as unknown as Db)).toEqual([]);
    expect(db.calls).toHaveLength(3);
  });

  it('the projection drops identifiers', () => {
    expect(Object.keys(toAggregateRow(featureRow, [finalLabel])).sort()).toEqual(['finalizedAt', 'labels', 'schemaVersion', 'values']);
  });

  it('truncates the run-end time to its day', () => {
    const late = { ...featureRow, finalizedAt: new Date('2026-10-10T23:59:59.999Z') };
    expect(toAggregateRow(late, [finalLabel]).finalizedAt).toBe('2026-10-10');
  });

  it('spreads the limit across tenants so none starves the ones after it', () => {
    expect(perTenantCap(5000, 1)).toBe(5000);
    expect(perTenantCap(5000, 4)).toBe(1250);
    expect(perTenantCap(10, 30)).toBe(1);
    expect(perTenantCap(10, 0)).toBe(10);
  });

  it('ranks each tenant\'s runs in the read, capped at its share', async () => {
    const db = fakeDb([[{ tenantId: 1 }, { tenantId: 2 }], [], [{ id: 1, plan: 'free' }, { id: 2, plan: 'free' }], [], []]);
    await readCrossTenantTrainingRows(db as unknown as Db, { limit: 10 });
    const read = db.calls[3]!;
    expect(read.chain).toContain('limit');
    const { sql: text, params } = new PgDialect().sqlToQuery(read.where as SQL);
    expect(text).toContain('row_number() over (partition by "run_features"."tenant_id"');
    expect(text).toContain('ranked.tenant_rank <=');
    expect(params).toContain(5);
  });
});
