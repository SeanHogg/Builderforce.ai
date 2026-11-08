/**
 * The PR-open claim and the platform-draft record against REAL Postgres (PGlite): migration 1331 is executed from its
 * file, and the statements are the ones the application issues (nothing here re-types the SQL).
 *
 * Proves: a dead claim is retaken (and reported as a retake) while a fresh one is not; a release scoped to the claim
 * it wrote cannot free the claim of whoever retook it; recording a PR upserts on the provider identity, so a row the
 * PR reconciler inserted first is taken over instead of making the record throw; and only a MARKED row is the
 * platform's draft.
 *
 * What PGlite CANNOT prove: true cross-connection races (two sessions claiming at the same instant). It is ONE
 * session, so "two callers, one winner" is only exercised as two sequential statements against the same predicate.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';

vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));
vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

import { releaseTaskPrClaim, takeTaskPrClaim, PR_CLAIM_STALE_MS } from './openTaskPullRequest';
import { recordTaskPullRequest } from './recordTaskPullRequest';
import { findPlatformDraftPullRequest } from './platformDraftPullRequest';

const migration = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../migrations/${name}`, import.meta.url).href), 'utf8');

let pg: PGlite;
let db: Db;
const TENANT = 1;

/** `tasks` and `pull_requests` reduced to the columns the statements touch (drizzle names every column of a table it inserts into). */
const TABLES = `
CREATE TABLE tasks (
  id serial PRIMARY KEY, tenant_id integer NOT NULL, pr_opening_at timestamp, github_pr_url varchar(500),
  github_pr_number integer, git_branch varchar(255), updated_at timestamp
);
CREATE TABLE pull_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id integer NOT NULL, segment_id uuid, project_id integer NOT NULL,
  repo_id uuid, task_id integer, spec_id uuid, workflow_id uuid, provider varchar(16) NOT NULL, number integer, url varchar(500),
  branch_name varchar(255), base_branch varchar(255), status varchar(16) NOT NULL DEFAULT 'open', external_ticket_ref varchar(255),
  merged_by varchar(128), merged_at timestamp, merge_sha varchar(64), build_status varchar(16), build_error text,
  created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_pull_requests_provider_number ON pull_requests (tenant_id, repo_id, number)
  WHERE repo_id IS NOT NULL AND number IS NOT NULL;
`;

const REPO = '11111111-1111-1111-1111-111111111111';

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(TABLES);
  await pg.exec(migration('1331_pull_requests_platform_draft_marker.sql'));
  await pg.exec(migration('1331_pull_requests_platform_draft_marker.sql')); // re-applies cleanly (IF NOT EXISTS)
  db = drizzle(pg) as unknown as Db;
});
afterAll(async () => { await pg.close(); });

beforeEach(async () => {
  await pg.exec('TRUNCATE tasks, pull_requests RESTART IDENTITY');
  await pg.exec(`INSERT INTO tasks (tenant_id) VALUES (${TENANT})`);
});

const claimAge = (ms: number) => pg.exec(`UPDATE tasks SET pr_opening_at = now() - interval '${ms} milliseconds' WHERE id = 1`);
const claimOf = async () => (await pg.query<{ pr_opening_at: Date | null }>('SELECT pr_opening_at FROM tasks WHERE id = 1')).rows[0]!.pr_opening_at;

describe('the PR-open claim', () => {
  it('grants a fresh claim once, refuses a second caller, and refuses once a PR is stamped', async () => {
    expect(await takeTaskPrClaim(db, TENANT, 1)).toMatchObject({ claimed: true, retook: false });
    expect(await takeTaskPrClaim(db, TENANT, 1)).toMatchObject({ claimed: false });
    await pg.exec(`UPDATE tasks SET github_pr_url = 'https://x/pull/1' WHERE id = 1`);
    await claimAge(PR_CLAIM_STALE_MS * 4);
    expect(await takeTaskPrClaim(db, TENANT, 1)).toMatchObject({ claimed: false }); // success is permanent, however old the claim
  });

  it('regression: M1 - a claim held past the bound with no PR is RETAKEN, and the caller is told it retook', async () => {
    await takeTaskPrClaim(db, TENANT, 1);
    await claimAge(PR_CLAIM_STALE_MS + 60_000);
    expect(await takeTaskPrClaim(db, TENANT, 1)).toMatchObject({ claimed: true, retook: true });
  });

  it('a claim younger than the bound is NOT retaken', async () => {
    await takeTaskPrClaim(db, TENANT, 1);
    await claimAge(PR_CLAIM_STALE_MS - 60_000);
    expect(await takeTaskPrClaim(db, TENANT, 1)).toMatchObject({ claimed: false });
  });

  it('regression: Minor 1 - a release scoped to the claim a caller wrote cannot free the claim of whoever retook it', async () => {
    const first = await takeTaskPrClaim(db, TENANT, 1);
    await claimAge(PR_CLAIM_STALE_MS + 60_000);
    const second = await takeTaskPrClaim(db, TENANT, 1);
    expect(second.retook).toBe(true);
    await releaseTaskPrClaim(db, TENANT, 1, first.at); // the slow first opener finally fails
    expect(await claimOf()).not.toBeNull(); // the retaker's claim stands
    await releaseTaskPrClaim(db, TENANT, 1, second.at);
    expect(await claimOf()).toBeNull();
  });
});

describe('recording a PR', () => {
  const input = {
    tenantId: TENANT, projectId: 2, repoId: REPO, taskId: 1, provider: 'github', number: 7, url: 'https://x/pull/7',
    branchName: 'builderforce/task-1', baseBranch: 'main',
  };

  it('regression: Minor 2 - a row the PR reconciler inserted first is taken over (task, status, marker), not a unique violation', async () => {
    await pg.exec(`INSERT INTO pull_requests (tenant_id, project_id, repo_id, provider, number, url, branch_name, status)
                   VALUES (${TENANT}, 2, '${REPO}', 'github', 7, 'https://x/pull/7', 'builderforce/task-1', 'draft')`);
    await recordTaskPullRequest(db, { ...input, status: 'draft', platformDraftExecutionId: 42 });
    const rows = (await pg.query<{ task_id: number; status: string; platform_draft_execution_id: number }>('SELECT task_id, status, platform_draft_execution_id FROM pull_requests')).rows;
    expect(rows).toEqual([{ task_id: 1, status: 'draft', platform_draft_execution_id: 42 }]);
    const task = (await pg.query<{ github_pr_number: number; github_pr_url: string }>('SELECT github_pr_number, github_pr_url FROM tasks WHERE id = 1')).rows[0]!;
    expect(task).toEqual({ github_pr_number: 7, github_pr_url: 'https://x/pull/7' });
  });

  it('a finalize record over the platform draft\'s row clears the marker', async () => {
    await recordTaskPullRequest(db, { ...input, status: 'draft', platformDraftExecutionId: 42 });
    await recordTaskPullRequest(db, { ...input, status: 'open' });
    expect((await pg.query<{ m: number | null }>('SELECT platform_draft_execution_id AS m FROM pull_requests')).rows).toEqual([{ m: null }]);
  });

  it('regression: MAJOR 1 - only a MARKED row is the platform\'s draft; a draft without the marker is never found', async () => {
    await recordTaskPullRequest(db, { ...input, status: 'draft' }); // a human\'s / reconciler\'s draft: no marker
    await pg.exec(`UPDATE tasks SET github_pr_number = 7 WHERE id = 1`);
    const lookup = { tenantId: TENANT, taskId: 1, repoId: REPO, branch: 'builderforce/task-1' };
    expect(await findPlatformDraftPullRequest(db, lookup)).toBeNull();
    await pg.exec('UPDATE pull_requests SET platform_draft_execution_id = 42');
    expect(await findPlatformDraftPullRequest(db, lookup)).toMatchObject({ number: 7, status: 'draft' });
    await pg.exec(`UPDATE pull_requests SET status = 'open'`); // a human marked it ready: still ours until acted on
    expect(await findPlatformDraftPullRequest(db, lookup)).toMatchObject({ number: 7, status: 'open' });
  });
});
