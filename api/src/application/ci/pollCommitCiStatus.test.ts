import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  pollCommitCiStatus,
  pollBranchCi,
  ciFinishDecision,
  MAX_CI_PENDING_FINISH_BLOCKS,
  MAX_CI_FAILURE_FINISH_BLOCKS,
  type CommitCiVerdict,
} from './pollCommitCiStatus';

afterEach(() => vi.unstubAllGlobals());

function routed(routes: Array<[RegExp, unknown]>) {
  return vi.fn(async (url: string) => {
    for (const [pattern, body] of routes) {
      if (pattern.test(String(url))) return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });
}

const github = { provider: 'github', host: null, owner: 'acme', repo: 'app', token: 't' };
const gitlab = { provider: 'gitlab', host: null, owner: 'acme', repo: 'app', token: 't' };
const bitbucket = { provider: 'bitbucket', host: null, owner: 'acme', repo: 'app', token: 't' };
const SHA = 'abcdef1234567890';

describe('pollCommitCiStatus — GitHub', () => {
  it('reports combined-status failure', async () => {
    vi.stubGlobal('fetch', routed([
      [/\/commits\/abcdef1234567890\/status$/, { state: 'failure', total_count: 1, statuses: [{ state: 'failure', context: 'ci/build', target_url: 'https://ci/1' }] }],
      [/\/check-runs/, { total_count: 0, check_runs: [] }],
    ]));
    const v = await pollCommitCiStatus(github, SHA);
    expect(v.status).toBe('failure');
    expect(v.failed).toContain('ci/build');
    expect(v.count).toBe(1);
  });

  it('reports Actions check-run failure when combined status is empty', async () => {
    vi.stubGlobal('fetch', routed([
      [/\/commits\/abcdef1234567890\/status$/, { state: 'pending', total_count: 0, statuses: [] }],
      [/\/check-runs/, { total_count: 1, check_runs: [{ name: 'test', status: 'completed', conclusion: 'failure', html_url: 'https://gh/run' }] }],
    ]));
    const v = await pollCommitCiStatus(github, SHA);
    expect(v.status).toBe('failure');
    expect(v.failed).toEqual(['test']);
    expect(v.url).toBe('https://gh/run');
  });

  it('reports pending when a check-run is still in progress', async () => {
    vi.stubGlobal('fetch', routed([
      [/\/commits\/abcdef1234567890\/status$/, { state: 'pending', total_count: 0, statuses: [] }],
      [/\/check-runs/, { total_count: 1, check_runs: [{ name: 'test', status: 'in_progress', conclusion: null }] }],
    ]));
    const v = await pollCommitCiStatus(github, SHA);
    expect(v.status).toBe('pending');
    expect(v.count).toBe(1);
  });

  it('reports success when check-runs completed green', async () => {
    vi.stubGlobal('fetch', routed([
      [/\/commits\/abcdef1234567890\/status$/, { state: 'success', total_count: 1, statuses: [{ state: 'success', context: 'ci' }] }],
      [/\/check-runs/, { total_count: 1, check_runs: [{ name: 'test', status: 'completed', conclusion: 'success' }] }],
    ]));
    const v = await pollCommitCiStatus(github, SHA);
    expect(v.status).toBe('success');
    expect(v.count).toBeGreaterThan(0);
  });

  it('reports none when neither statuses nor check-runs exist', async () => {
    vi.stubGlobal('fetch', routed([
      [/\/commits\/abcdef1234567890\/status$/, { state: 'pending', total_count: 0, statuses: [] }],
      [/\/check-runs/, { total_count: 0, check_runs: [] }],
    ]));
    const v = await pollCommitCiStatus(github, SHA);
    expect(v.status).toBe('none');
    expect(v.count).toBe(0);
  });

  it('degrades to none when the provider is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    const v = await pollCommitCiStatus(github, SHA);
    expect(v.status).toBe('none');
  });
});

describe('pollCommitCiStatus — GitLab / Bitbucket', () => {
  it('maps a failed GitLab job to failure', async () => {
    vi.stubGlobal('fetch', routed([
      [/\/statuses$/, [{ name: 'rspec', status: 'failed', target_url: 'https://gl/1' }]],
    ]));
    const v = await pollCommitCiStatus(gitlab, SHA);
    expect(v.status).toBe('failure');
    expect(v.failed).toEqual(['rspec']);
  });

  it('maps Bitbucket FAILED to failure', async () => {
    vi.stubGlobal('fetch', routed([
      [/\/statuses/, { values: [{ state: 'FAILED', name: 'pipe', url: 'https://bb/1' }] }],
    ]));
    const v = await pollCommitCiStatus(bitbucket, SHA);
    expect(v.status).toBe('failure');
    expect(v.failed).toEqual(['pipe']);
  });
});

describe('pollBranchCi', () => {
  it('resolves the branch HEAD then polls that SHA', async () => {
    vi.stubGlobal('fetch', routed([
      [/\/git\/ref\/heads\/ticket$/, { object: { sha: SHA } }],
      [/\/commits\/abcdef1234567890\/status$/, { state: 'success', total_count: 1, statuses: [{ state: 'success', context: 'ci' }] }],
      [/\/check-runs/, { total_count: 0, check_runs: [] }],
    ]));
    const v = await pollBranchCi({ ...github, branch: 'ticket' });
    expect(v.status).toBe('success');
    expect(v.sha).toBe(SHA);
  });

  it('returns none when the branch HEAD cannot be resolved', async () => {
    vi.stubGlobal('fetch', routed([]));
    const v = await pollBranchCi({ ...github, branch: 'missing' });
    expect(v.status).toBe('none');
    expect(v.sha).toBe('');
  });
});

const green: CommitCiVerdict = { status: 'success', sha: SHA, count: 2, summary: 'green', failed: [] };
const red: CommitCiVerdict = { status: 'failure', sha: SHA, count: 1, summary: 'red', failed: ['test'], url: 'https://ci/1' };
const pending: CommitCiVerdict = { status: 'pending', sha: SHA, count: 1, summary: 'pending', failed: [] };
const none: CommitCiVerdict = { status: 'none', sha: SHA, count: 0, summary: 'none', failed: [] };

describe('ciFinishDecision (in-run CI finish gate)', () => {
  it('does not block when no checks are reported', () => {
    const d = ciFinishDecision(none, { pendingBlocks: 0, failureBlocks: 0 });
    expect(d.block).toBeNull();
    expect(d.ciVerified).toBe(false);
  });

  it('marks verified and does not block on green CI', () => {
    const d = ciFinishDecision(green, { pendingBlocks: 0, failureBlocks: 0 });
    expect(d.block).toBeNull();
    expect(d.ciVerified).toBe(true);
  });

  it(`blocks a red build up to ${MAX_CI_FAILURE_FINISH_BLOCKS} times`, () => {
    let state = { pendingBlocks: 0, failureBlocks: 0 };
    for (let i = 0; i < MAX_CI_FAILURE_FINISH_BLOCKS; i++) {
      const d = ciFinishDecision(red, state);
      expect(d.block).toMatch(/CI failed/);
      expect(d.ciVerified).toBe(false);
      state = { pendingBlocks: d.pendingBlocks, failureBlocks: d.failureBlocks };
    }
    const last = ciFinishDecision(red, state);
    expect(last.block).toBeNull();
    expect(last.failureBlocks).toBe(MAX_CI_FAILURE_FINISH_BLOCKS);
  });

  it(`blocks a pending build up to ${MAX_CI_PENDING_FINISH_BLOCKS} times`, () => {
    let state = { pendingBlocks: 0, failureBlocks: 0 };
    for (let i = 0; i < MAX_CI_PENDING_FINISH_BLOCKS; i++) {
      const d = ciFinishDecision(pending, state);
      expect(d.block).toMatch(/still running/);
      state = { pendingBlocks: d.pendingBlocks, failureBlocks: d.failureBlocks };
    }
    expect(ciFinishDecision(pending, state).block).toBeNull();
  });

  it('keeps pending and failure counters independent', () => {
    const afterPending = ciFinishDecision(pending, { pendingBlocks: 0, failureBlocks: 2 });
    expect(afterPending.pendingBlocks).toBe(1);
    expect(afterPending.failureBlocks).toBe(2);
    const afterFail = ciFinishDecision(red, { pendingBlocks: 2, failureBlocks: 0 });
    expect(afterFail.failureBlocks).toBe(1);
    expect(afterFail.pendingBlocks).toBe(2);
  });
});
