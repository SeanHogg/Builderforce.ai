/**
 * The deferred-dispatch queue against REAL Postgres (PGlite): migration 1333 is executed from its file and the
 * statements are the ones the application issues.
 *
 * Proves: parking upserts one pending row per (tenant, ticket, kind) and keeps the earliest `created_at`; a claim
 * takes a due row once (a held lease is skipped, an expired one is retaken); a still-deferred row backs off and does
 * not block the rows behind it; kinds are separate queues with their own hooks; a row older than the window is
 * abandoned through its kind's hook without a dispatch; and the sweep reads the CORE handle, never the telemetry one.
 *
 * What PGlite CANNOT prove: true cross-connection `SKIP LOCKED` contention. It is ONE session, so "two ticks, one
 * winner" is exercised as two sequential claims against the same predicate (the lease).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));
vi.mock('./cloudToolEvents', () => ({ recordCloudToolEvent: vi.fn(async () => undefined) }));
vi.mock('../../buildRuntimeService', () => ({ buildRuntimeService: vi.fn(() => ({})) }));
const recordAutofixDispatched = vi.fn(async (..._a: unknown[]) => undefined);
const recordAutofixRefused = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('../ci/autofixDispatchRecord', () => ({
  recordAutofixDispatched: (...a: unknown[]) => recordAutofixDispatched(...a),
  recordAutofixRefused: (...a: unknown[]) => recordAutofixRefused(...a),
}));
const failSecurityAudit = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('../security/securityDispatch', () => ({ failSecurityAudit: (...a: unknown[]) => failSecurityAudit(...a) }));
const reportIncidentTriageRefused = vi.fn();
vi.mock('../incident/incidentDispatch', () => ({ reportIncidentTriageRefused: (...a: unknown[]) => reportIncidentTriageRefused(...a) }));

let core: Db;
const buildDatabase = vi.fn(() => core);
const runTelemetryDatabase = vi.fn(() => { throw new Error('the sweep must not touch the telemetry database'); });
vi.mock('../../infrastructure/database/connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../infrastructure/database/connection')>()),
  buildDatabase: (...a: unknown[]) => buildDatabase(...(a as [])),
  runTelemetryDatabase: (...a: unknown[]) => runTelemetryDatabase(...(a as [])),
}));
vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

import { parkDeferredDispatch } from './deferredDispatch';
import { claimDueDeferredDispatches, deferredBackoffMs, runDeferredDispatchSweep } from './deferredDispatchSweep';
import { createTickDispatchBudget } from './tickDispatchBudget';

const migration = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../migrations/${name}`, import.meta.url).href), 'utf8');

let pg: PGlite;
const ENV = { NEON_DATABASE_URL: 'postgres://core' } as unknown as Env;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec('CREATE TABLE tenants (id serial PRIMARY KEY); CREATE TABLE tasks (id serial PRIMARY KEY);');
  await pg.exec(migration('1333_deferred_dispatches.sql'));
  await pg.exec(migration('1333_deferred_dispatches.sql')); // re-applies cleanly (IF NOT EXISTS)
  core = drizzle(pg) as unknown as Db;
});
afterAll(async () => { await pg.close(); });

beforeEach(async () => {
  await pg.exec('TRUNCATE deferred_dispatches, tenants, tasks RESTART IDENTITY');
  await pg.exec('INSERT INTO tenants DEFAULT VALUES; INSERT INTO tasks DEFAULT VALUES; INSERT INTO tasks DEFAULT VALUES;');
  vi.clearAllMocks();
});

const rows = async () => (await pg.query<{ id: number; task_id: number; kind: string; state: string; attempts: number; claimed_at: Date | null; next_attempt_at: Date; last_error: string | null }>(
  'SELECT id, task_id, kind, state, attempts, claimed_at, next_attempt_at, last_error FROM deferred_dispatches ORDER BY id')).rows;

const park = (taskId: number, kind: 'ci_autofix' | 'incident' | 'security' | 'validation', extra: Record<string, unknown> = {}) =>
  parkDeferredDispatch(core, { tenantId: 1, taskId, kind, submittedBy: `system:${kind}`, payload: '{"a":1}', meta: extra });

const started = (executionId = 900) => ({ executionId });
const deferred = { executionId: null, deferred: true as const, refusal: { reason: 'already_running', message: 'a run is live' } };
const refused = { executionId: null, refusal: { reason: 'budget', message: 'plan exhausted' } };

const sweep = (dispatch: (...a: unknown[]) => Promise<unknown>) =>
  runDeferredDispatchSweep(ENV, createTickDispatchBudget(), dispatch as never);

describe('parkDeferredDispatch', () => {
  it('upserts ONE pending row per tenant + ticket + kind, refreshing the payload and keeping the earliest created_at', async () => {
    await park(1, 'security', { auditId: 5 });
    await pg.exec(`UPDATE deferred_dispatches SET created_at = now() - interval '2 hours'`);
    const before = (await pg.query<{ created_at: Date }>('SELECT created_at FROM deferred_dispatches')).rows[0]!.created_at;
    await parkDeferredDispatch(core, { tenantId: 1, taskId: 1, kind: 'security', submittedBy: 'later', payload: '{"b":2}', meta: { auditId: 6 } });
    const all = (await pg.query<{ payload: { dispatchPayload: string; meta: { auditId: number } }; submitted_by: string; created_at: Date }>('SELECT payload, submitted_by, created_at FROM deferred_dispatches')).rows;
    expect(all).toHaveLength(1);
    expect(all[0]!.payload).toEqual({ dispatchPayload: '{"b":2}', meta: { auditId: 6 } });
    expect(all[0]!.submitted_by).toBe('later');
    expect(all[0]!.created_at.getTime()).toBe(before.getTime());
  });

  it('keeps different dispatcher kinds on the same ticket as separate rows', async () => {
    await park(1, 'ci_autofix');
    await park(1, 'security');
    expect((await rows()).map((r) => r.kind)).toEqual(['ci_autofix', 'security']);
  });

  it('parks a new row once the earlier one is done (the unique index is partial on pending)', async () => {
    await park(1, 'incident');
    await pg.exec(`UPDATE deferred_dispatches SET state = 'done'`);
    await park(1, 'incident');
    expect((await rows()).map((r) => r.state)).toEqual(['done', 'pending']);
  });
});

describe('claimDueDeferredDispatches', () => {
  it('takes a due row once: attempts bump, the lease holds a second claim off, an expired lease is retaken', async () => {
    await park(1, 'validation');
    expect(await claimDueDeferredDispatches(core, 10)).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ attempts: 1 });
    expect(await claimDueDeferredDispatches(core, 10)).toHaveLength(0); // sequential stand-in for SKIP LOCKED
    await pg.exec(`UPDATE deferred_dispatches SET claimed_at = now() - interval '10 minutes'`);
    expect(await claimDueDeferredDispatches(core, 10)).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ attempts: 2 });
  });

  it('does not claim a row whose backoff has not elapsed', async () => {
    await park(1, 'validation');
    await pg.exec(`UPDATE deferred_dispatches SET next_attempt_at = now() + interval '10 minutes'`);
    expect(await claimDueDeferredDispatches(core, 10)).toHaveLength(0);
  });
});

describe('runDeferredDispatchSweep', () => {
  it('regression: reads the CORE database handle (the queue is a core table; the telemetry database never sees it)', async () => {
    await park(1, 'validation');
    const dispatch = vi.fn(async () => started());
    await sweep(dispatch);
    expect(buildDatabase).toHaveBeenCalledWith(ENV);
    expect(runTelemetryDatabase).not.toHaveBeenCalled();
    expect((await rows())[0]).toMatchObject({ state: 'done' });
  });

  it('a still-deferred row backs off, stays pending with its claim cleared, and does not block the rows behind it', async () => {
    await park(1, 'validation');
    await park(2, 'validation');
    const dispatch = vi.fn(async (_e: unknown, _d: unknown, _s: unknown, _w: unknown, params: { taskId: number }) => (params.taskId === 1 ? deferred : started(901)));
    const result = await sweep(dispatch);
    expect(result).toMatchObject({ claimed: 2, started: 1, stillDeferred: 1 });
    const [first, second] = await rows();
    expect(first).toMatchObject({ state: 'pending', attempts: 1, claimed_at: null, last_error: 'a run is live' });
    expect(first!.next_attempt_at.getTime()).toBeGreaterThan(Date.now() + 30_000);
    expect(second).toMatchObject({ state: 'done' });
    // not due again until the backoff elapses
    expect(await claimDueDeferredDispatches(core, 10)).toHaveLength(0);
  });

  it('backs off exponentially with jitter, capped', () => {
    expect(deferredBackoffMs(2, 0.5)).toBe(2 * deferredBackoffMs(1, 0.5));
    expect(deferredBackoffMs(1, 0)).toBeLessThan(deferredBackoffMs(1, 0.999));
    expect(deferredBackoffMs(40, 0.5)).toBe(30 * 60_000);
  });

  it('runs each kind\'s own hooks: a started ci_autofix writes the dispatch row, a security row is untouched by it', async () => {
    const facts = { taskId: 1, tenantId: 1, attempt: 2, source: 'github', sha: 'abc', statusKey: null };
    await park(1, 'ci_autofix', facts);
    await park(1, 'security', { auditId: 7 });
    const dispatch = vi.fn(async (_e: unknown, _d: unknown, _s: unknown, _w: unknown, params: { submittedBy: string }) => (params.submittedBy === 'system:ci_autofix' ? started(910) : deferred));
    await sweep(dispatch);
    expect(recordAutofixDispatched).toHaveBeenCalledTimes(1);
    expect(recordAutofixDispatched).toHaveBeenCalledWith(core, facts, 910);
    expect(failSecurityAudit).not.toHaveBeenCalled();
    expect((await rows()).map((r) => [r.kind, r.state])).toEqual([['ci_autofix', 'done'], ['security', 'pending']]);
  });

  it('a refusal that will not clear abandons the row and runs the kind\'s hook', async () => {
    await park(1, 'ci_autofix', { taskId: 1, tenantId: 1, attempt: 1, source: 'github', sha: 's', statusKey: null });
    await sweep(vi.fn(async () => refused));
    expect((await rows())[0]).toMatchObject({ state: 'abandoned', last_error: 'plan exhausted' });
    expect(recordAutofixRefused).toHaveBeenCalledWith(core, expect.objectContaining({ sha: 's' }), { message: 'plan exhausted' });
  });

  it('abandons a row older than six hours WITHOUT dispatching, finishing a parked security audit as failed', async () => {
    await park(1, 'security', { auditId: 7 });
    await park(2, 'incident', { incidentId: 'inc-1' });
    await pg.exec(`UPDATE deferred_dispatches SET created_at = now() - interval '7 hours'`);
    const dispatch = vi.fn(async () => started());
    const result = await sweep(dispatch);
    expect(dispatch).not.toHaveBeenCalled();
    expect(result.abandoned).toBe(2);
    expect((await rows()).every((r) => r.state === 'abandoned')).toBe(true);
    expect(failSecurityAudit).toHaveBeenCalledWith(core, 1, 7, expect.stringContaining('abandoned'));
    expect(reportIncidentTriageRefused).toHaveBeenCalledWith('inc-1', expect.objectContaining({ message: expect.stringContaining('expired') }));
  });

  it('regression: Minor 1 - a settle with a STALE claimed_at (the lease was retaken meanwhile) does not modify the row', async () => {
    await park(1, 'validation');
    // While the dispatch runs, another tick retakes the row: its claimed_at moves on to the new holder's value.
    const dispatch = vi.fn(async () => {
      await pg.exec(`UPDATE deferred_dispatches SET claimed_at = claimed_at + interval '1 second', attempts = 7`);
      return started();
    });
    const result = await sweep(dispatch);
    expect(result.started).toBe(1);
    expect((await rows())[0]).toMatchObject({ state: 'pending', attempts: 7 });
    expect((await rows())[0]!.claimed_at).not.toBeNull();
  });

  it('regression: Minor 1 - a stale holder cannot reschedule or abandon the new holder\'s row either, and skips the abandon hook', async () => {
    await park(1, 'ci_autofix', { taskId: 1, tenantId: 1, attempt: 1, source: 'github', sha: 's', statusKey: null });
    const dispatch = vi.fn(async () => {
      await pg.exec(`UPDATE deferred_dispatches SET claimed_at = claimed_at + interval '1 second'`);
      return refused;
    });
    await sweep(dispatch);
    expect((await rows())[0]).toMatchObject({ state: 'pending' });
    expect(recordAutofixRefused).not.toHaveBeenCalled();
  });

  it('regression: Minor 1 - a row whose own claim outlived the lease while earlier rows ran is skipped, not dispatched', async () => {
    await park(1, 'validation');
    await park(2, 'validation');
    const realNow = Date.now.bind(Date);
    let spy: { mockRestore(): void } | undefined;
    const dispatch = vi.fn(async () => { spy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 10 * 60_000); return started(); });
    try { await sweep(dispatch); } finally { spy?.mockRestore(); }
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect((await rows()).map((r) => r.state)).toEqual(['done', 'pending']);
  });

  it('regression: Minor 7 - settled rows past 14 days are deleted (bounded); recent settled and pending rows are kept', async () => {
    await park(1, 'validation');
    await park(2, 'validation');
    await pg.exec(`INSERT INTO deferred_dispatches (tenant_id, task_id, kind, payload, state, updated_at) VALUES
      (1, 1, 'incident', '{}', 'done', now() - interval '15 days'),
      (1, 1, 'security', '{}', 'abandoned', now() - interval '15 days'),
      (1, 1, 'ci_autofix', '{}', 'done', now() - interval '1 day')`);
    await pg.exec(`UPDATE deferred_dispatches SET next_attempt_at = now() + interval '1 hour' WHERE state = 'pending'`);
    await sweep(vi.fn(async () => started()));
    expect((await rows()).map((r) => [r.kind, r.state])).toEqual([['validation', 'pending'], ['validation', 'pending'], ['ci_autofix', 'done']]);
  });

  it('regression: Minor 3 - a newer build\'s deferral replaces the pending ci_autofix row and records the older build as superseded', async () => {
    const facts = (sha: string) => ({ taskId: 1, tenantId: 1, attempt: 1, source: 'github', sha, statusKey: null });
    await park(1, 'ci_autofix', facts('old'));
    await park(1, 'ci_autofix', facts('new'));
    expect(await rows()).toHaveLength(1);
    expect(recordAutofixRefused).toHaveBeenCalledTimes(1);
    expect(recordAutofixRefused).toHaveBeenCalledWith(core, expect.objectContaining({ sha: 'old' }), expect.objectContaining({ reason: 'superseded' }));
  });

  it('regression: re-parking the SAME build (same sha; jsonb reorders keys) records no superseded row', async () => {
    await park(1, 'ci_autofix', { taskId: 1, tenantId: 1, attempt: 1, source: 'github', sha: 'same', statusKey: null });
    await park(1, 'ci_autofix', { sha: 'same', statusKey: null, source: 'github', attempt: 1, tenantId: 1, taskId: 1 });
    expect(recordAutofixRefused).not.toHaveBeenCalled();
  });

  it('regression: a park DURING an in-flight dispatch of the row clears the claim, keeps the new payload pending and due, records no superseded row, and fences the old holder out', async () => {
    const facts = (sha: string) => ({ taskId: 1, tenantId: 1, attempt: 1, source: 'github', sha, statusKey: null });
    await park(1, 'ci_autofix', facts('A'));
    // `inTransaction` on a PGlite handle (no pool URL registered) is `db.transaction`, which PGlite supports, so this park
    // runs through the LOCKED path (advisory lock, `FOR UPDATE` read, upsert) - not the unlocked fallback.
    const dispatch = vi.fn(async () => {
      await park(1, 'ci_autofix', facts('B')); // the event arrives while the sweep is dispatching A
      expect((await rows())[0]!.claimed_at).toBeNull();
      return started(920);
    });
    await sweep(dispatch);
    const [only] = await pg.query<{ payload: { meta: { sha: string } }; state: string; claimed_at: Date | null }>('SELECT payload, state, claimed_at FROM deferred_dispatches').then((r) => r.rows);
    expect(only).toMatchObject({ state: 'pending', claimed_at: null, payload: { meta: { sha: 'B' } } }); // the old holder's settle did not touch it
    expect(recordAutofixRefused).not.toHaveBeenCalled();
    expect(await claimDueDeferredDispatches(core, 10)).toHaveLength(1); // B is due again
  });

  it('a tenant out of tick budget keeps its row pending with the attempt refunded', async () => {
    await park(1, 'validation');
    const dispatch = vi.fn(async () => started());
    await runDeferredDispatchSweep(ENV, createTickDispatchBudget(0), dispatch as never);
    expect(dispatch).not.toHaveBeenCalled();
    expect((await rows())[0]).toMatchObject({ state: 'pending', attempts: 0, claimed_at: null });
  });
});
