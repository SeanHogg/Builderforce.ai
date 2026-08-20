import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  normalizeBuildStatus, pickCurrentPr, deriveBuildStatus, deriveBuildStatusFromRows,
} from './buildStatus';

/**
 * A FAILING BUILD THAT ONLY THE PR TAB KNOWS ABOUT IS A FAILING BUILD NOBODY SEES.
 *
 * CI already wrote the verdict and `pull_requests.build_status` already stored it, but
 * the two surfaces a person scans — the board card and the execution chip — rendered
 * nothing, so a ticket sat in review looking healthy over a branch that could not build.
 * These pin the derivation both surfaces now read.
 */
describe('normalizeBuildStatus', () => {
  it('accepts exactly the three verdicts CI writes', () => {
    expect(normalizeBuildStatus('success')).toBe('success');
    expect(normalizeBuildStatus('failure')).toBe('failure');
    expect(normalizeBuildStatus('pending')).toBe('pending');
  });

  it('treats anything else as absent — the column is a free-form varchar(16)', () => {
    for (const v of [null, undefined, '', 'SUCCESS', 'passed', 'queued', 'cancelled']) {
      expect(normalizeBuildStatus(v), String(v)).toBeNull();
    }
  });
});

/**
 * WHICH PULL REQUEST SPEAKS FOR THE TICKET is a decision, not a sort. A ticket can carry
 * an old settled PR and a live one, and reading "whichever row the scan returned last" is
 * how a settled PR's green build could speak for an open PR that had not built at all.
 */
describe('pickCurrentPr', () => {
  it('prefers the OPEN pull request over every settled one, whatever the order', () => {
    const rows = [
      { status: 'merged', buildStatus: 'success' },
      { status: 'open', buildStatus: 'failure' },
      { status: 'closed', buildStatus: 'success' },
    ];
    expect(pickCurrentPr(rows)).toEqual({ status: 'open', buildStatus: 'failure' });
  });

  it('falls back to the FIRST row when nothing is open (callers pass newest first)', () => {
    const rows = [
      { status: 'merged', buildStatus: 'failure' },
      { status: 'closed', buildStatus: 'success' },
    ];
    expect(pickCurrentPr(rows)).toEqual({ status: 'merged', buildStatus: 'failure' });
  });

  it('is null for a ticket with no pull request at all', () => {
    expect(pickCurrentPr([])).toBeNull();
  });
});

describe('deriveBuildStatus', () => {
  it('maps the stored verdict to the badge vocabulary', () => {
    expect(deriveBuildStatus({ status: 'open', buildStatus: 'success' })).toBe('passing');
    expect(deriveBuildStatus({ status: 'open', buildStatus: 'failure' })).toBe('failing');
    expect(deriveBuildStatus({ status: 'open', buildStatus: 'pending' })).toBe('pending');
  });

  /**
   * `unknown` and "no pull request" must be the SAME answer. A ticket whose build has
   * never reported is not passing, and rendering a green badge for it would be worse than
   * rendering none — which is exactly what `unknown` makes the surfaces do.
   */
  it('never invents a verdict', () => {
    expect(deriveBuildStatus(null)).toBe('unknown');
    expect(deriveBuildStatus(undefined)).toBe('unknown');
    expect(deriveBuildStatus({ status: 'open', buildStatus: null })).toBe('unknown');
    expect(deriveBuildStatus({ status: 'open', buildStatus: 'weird' })).toBe('unknown');
  });

  it('reports the RED build of the open PR even when a merged one behind it was green', () => {
    expect(deriveBuildStatusFromRows([
      { status: 'open', buildStatus: 'failure' },
      { status: 'merged', buildStatus: 'success' },
    ])).toBe('failing');
  });
});

/**
 * The derivation existed TWICE before this module — verbatim, in ManagerService and in
 * triageStage — which is two places for one narrowing to drift. Both import it now, and
 * the batch reader the board card is fed from is built on the same two functions.
 */
describe('there is exactly one derivation', () => {
  const read = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url).href), 'utf8');

  it('no caller re-declares the narrowing', () => {
    for (const rel of ['../../application/manager/ManagerService.ts', '../../application/manager/triageStage.ts']) {
      expect(read(rel), rel).not.toMatch(/function normalizeBuildStatus\(/);
      expect(read(rel), rel).toMatch(/from '\.\.\/\.\.\/domain\/task\/buildStatus'/);
    }
  });

  it('the board card is fed by ONE batched read, never a query per card', () => {
    const route = read('../../presentation/routes/taskRoutes.ts');
    expect(route).toMatch(/loadTicketBuildStatuses\(db, c\.get\('tenantId'\), ids\)/);
    const reader = read('../../application/repos/ticketBuildStatus.ts');
    // One scan over the ids the list already resolved, ordered so the fallback is honest.
    expect(reader).toMatch(/inArray\(pullRequests\.taskId, \[\.\.\.taskIds\]\)/);
    expect(reader).toMatch(/orderBy\(desc\(pullRequests\.updatedAt\)\)/);
    expect(reader).toMatch(/eq\(pullRequests\.tenantId, tenantId\)/);
  });
});
