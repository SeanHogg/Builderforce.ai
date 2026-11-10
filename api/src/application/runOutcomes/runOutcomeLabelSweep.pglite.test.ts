/**
 * M-C — the label sweep's caps never starve anything, against REAL Postgres (PGlite) running migrations
 * 1342 + 1345 as written:
 *  - a tenant's 201st run (the oldest, last by commit time) is a candidate on the very next pass, because
 *    candidates go least-recently-labelled first, never-labelled first of all;
 *  - a run that can never get a final CI/review label leaves the set 14 days after its last chance;
 *  - the tenant window rotates per day, so a tenant past the cap is reached.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunOutcomeLabel } from '@builderforce/run-delta/predict';
import type { Db } from '../../infrastructure/database/connection';
import { DAY_MS } from '../../domain/shared/time';
import { labelCandidates, MAX_RUNS_PER_TENANT, tenantsWithRecentRuns } from './runOutcomeLabelSweep';
import { labelRowOf, upsertLabelRows } from './runOutcomeStore';

vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

const migration = (file: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../migrations/${file}`, import.meta.url).href), 'utf8');

const REPO = 'https://github.com/acme/app';
const now = new Date('2026-10-18T00:00:00.000Z');
const since = new Date(now.getTime() - 120 * DAY_MS);

let pg: PGlite;
let db: Db;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(migration('1342_run_outcomes.sql'));
  await pg.exec(migration('1345_run_outcome_time_indexes.sql'));
  db = drizzle(pg) as unknown as Db;
});
afterAll(async () => { await pg.close(); });
beforeEach(async () => { await pg.exec('DELETE FROM run_commit_attributions; DELETE FROM run_outcome_labels;'); });

async function attribute(tenantId: number, runId: string, committedAt: Date): Promise<void> {
  await pg.query(
    `INSERT INTO run_commit_attributions (tenant_id, run_id, repository, commit_sha, path, branch, committed_at, source)
     VALUES ($1, $2, $3, $4, 'src/a.ts', $5, $6, 'cloud')`,
    [tenantId, runId, REPO, `sha-${runId}`, `builderforce/${runId}`, committedAt.toISOString()],
  );
}

const label = (kind: RunOutcomeLabel['kind'], at: Date, over: Partial<RunOutcomeLabel> = {}): RunOutcomeLabel => ({
  kind, value: null, status: 'censored', evidence: { pr: 1 }, labellerVersion: 1, computedAt: at.toISOString(), ...over,
});

const ids = (list: Array<{ runId: string }>): string[] => list.map((c) => c.runId);

describe('labelCandidates — round-robin past the per-tenant cap', () => {
  it('201 runs: the oldest is visited within 2 passes (the candidate window rotates per day)', async () => {
    const runs = Array.from({ length: MAX_RUNS_PER_TENANT + 1 }, (_, i) => `run-${String(i + 1).padStart(3, '0')}`);
    // run-001 newest … run-201 oldest (one hour apart, all well inside the 14-day no-PR grace).
    for (const [i, runId] of runs.entries()) await attribute(7, runId, new Date(now.getTime() - (i + 1) * 3_600_000));
    const oldest = runs[runs.length - 1]!;

    const pass1 = await labelCandidates(db, 7, since, now);
    expect(pass1).toHaveLength(MAX_RUNS_PER_TENANT);
    await upsertLabelRows(db, 7, pass1.map((c) => labelRowOf(c.runId, c.repository, label('review-rejected', now))));
    const pass2 = await labelCandidates(db, 7, since, new Date(now.getTime() + DAY_MS));
    expect([...ids(pass1), ...ids(pass2)]).toContain(oldest);
  });

  it('N1: never-matched runs inside their grace cannot starve a matched run', async () => {
    // 250 runs that never matched a PR (NULL last-labelled, all inside the 14-day grace) …
    for (let i = 0; i < 250; i += 1) await attribute(7, `unmatched-${String(i).padStart(3, '0')}`, new Date(now.getTime() - (i + 1) * 60_000));
    // … and 1 matched run whose censored label is stale.
    await attribute(7, 'matched', new Date(now.getTime() - 5 * DAY_MS));
    await upsertLabelRows(db, 7, [labelRowOf('matched', REPO, label('review-rejected', new Date(now.getTime() - 4 * DAY_MS)))]);
    const passes = Math.ceil(251 / MAX_RUNS_PER_TENANT);
    const seen = new Set<string>();
    for (let day = 0; day < passes; day += 1) {
      for (const id of ids(await labelCandidates(db, 7, since, new Date(now.getTime() + day * DAY_MS)))) seen.add(id);
    }
    expect(seen.has('matched')).toBe(true);
  });

  it('150 labelled + 300 never-labelled runs: the stalest labelled run is visited on pass 1', async () => {
    for (let i = 0; i < 300; i += 1) await attribute(7, `never-${String(i).padStart(3, '0')}`, new Date(now.getTime() - (i + 1) * 60_000));
    const labelled: string[] = [];
    for (let i = 0; i < 150; i += 1) {
      const runId = `labelled-${String(i).padStart(3, '0')}`;
      labelled.push(runId);
      await attribute(7, runId, new Date(now.getTime() - 2 * DAY_MS));
      // labelled-000 is the stalest (labelled longest ago).
      await upsertLabelRows(db, 7, [labelRowOf(runId, REPO, label('review-rejected', new Date(now.getTime() - (150 - i) * 60_000 - DAY_MS)))]);
    }
    const pass1 = ids(await labelCandidates(db, 7, since, now));
    expect(pass1).toHaveLength(MAX_RUNS_PER_TENANT);
    expect(pass1).toContain(labelled[0]);
    expect(pass1.some((id) => id.startsWith('never-'))).toBe(true);
  });

  it('a run with no matched PR (no server label) leaves the set 14 days after its last commit', async () => {
    await attribute(7, 'stale', new Date(now.getTime() - 15 * DAY_MS));
    await attribute(7, 'fresh', new Date(now.getTime() - 13 * DAY_MS));
    expect(ids(await labelCandidates(db, 7, since, now))).toEqual(['fresh']);
  });

  it('an old run that did match a PR stays a candidate', async () => {
    await attribute(7, 'matched', new Date(now.getTime() - 30 * DAY_MS));
    await upsertLabelRows(db, 7, [labelRowOf('matched', REPO, label('review-rejected', new Date(now.getTime() - DAY_MS)))]);
    expect(ids(await labelCandidates(db, 7, since, now))).toEqual(['matched']);
  });

  it('a PR closed over 14 days ago with no CI label leaves the set; one with a CI label stays', async () => {
    const closed = new Date(now.getTime() - 20 * DAY_MS);
    const finalReview = label('review-rejected', closed, { value: false, status: 'final', windowEndsAt: closed.toISOString() });
    await attribute(7, 'closed-no-ci', new Date(now.getTime() - 25 * DAY_MS));
    await attribute(7, 'closed-ci-open', new Date(now.getTime() - 25 * DAY_MS));
    await upsertLabelRows(db, 7, [
      labelRowOf('closed-no-ci', REPO, finalReview),
      labelRowOf('closed-ci-open', REPO, finalReview),
      labelRowOf('closed-ci-open', REPO, label('ci-red-after-merge', closed, { windowEndsAt: new Date(now.getTime() + DAY_MS).toISOString() })),
    ]);
    expect(ids(await labelCandidates(db, 7, since, now))).toEqual(['closed-ci-open']);
  });
});

describe('tenantsWithRecentRuns — rotating window', () => {
  it('a cap of 2 over 5 tenants reaches every tenant within 3 consecutive passes', async () => {
    for (const tenantId of [5, 1, 4, 2, 3]) await attribute(tenantId, `run-${tenantId}`, new Date(now.getTime() - DAY_MS));
    const seen = new Set<number>();
    for (let day = 0; day < 3; day += 1) {
      const window = await tenantsWithRecentRuns(db, since, new Date(now.getTime() + day * DAY_MS), 2);
      expect(window).toHaveLength(2);
      for (const id of window) seen.add(id);
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
