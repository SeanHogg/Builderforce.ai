/**
 * githubActionsReconcile — the verdict on a dispatch GitHub never turned into a run.
 *
 * Three of the four branches here FAIL a user's run, so each one is pinned: the
 * sweep must be conclusive when GitHub proves nothing was scheduled, and must
 * stay OUT of the way whenever the evidence is ambiguous (a legacy workflow with
 * no run-name, a rate-limited list call, a run still sitting in the queue). A
 * false positive kills live work; a false negative just defers to the existing
 * 20-minute reaper.
 */
import { describe, expect, it } from 'vitest';
import {
  ACTIONS_RUN_CLOCK_SKEW_MS,
  ACTIONS_SCHEDULE_GRACE_MS,
  classifyActionsDispatch,
  countBlockingUnattributedRuns,
} from './githubActionsReconcile';
import {
  AGENT_WORKFLOW_REFRESH_MAX_ATTEMPTS,
  AGENT_WORKFLOW_REFRESH_MAX_PER_TICK,
  agentWorkflowRefreshBackoffMs,
} from './agentWorkflowRefresh';
import { GITHUB_ACTIONS_NEVER_SCHEDULED_REASON } from './orphanReasons';
import { AGENT_WORKFLOW_REVISION, agentRunName, parseExecutionIdFromRunName, renderAgentWorkflow } from './githubActionsWorkflow';
import { QUEUED_DEADLINE_MS } from './staleExecutionReaper';

const noError = { unattributedRuns: 0, listError: null };

describe('classifyActionsDispatch', () => {
  it('fails a dispatch GitHub never scheduled, naming the causes an operator can fix', () => {
    const v = classifyActionsDispatch({ matched: null, ...noError });
    expect(v.action).toBe('fail');
    expect(v.action === 'fail' && v.reason).toBe(GITHUB_ACTIONS_NEVER_SCHEDULED_REASON);
    // The whole point of the precise reason: it names the four real causes.
    expect(GITHUB_ACTIONS_NEVER_SCHEDULED_REASON).toMatch(/Actions is disabled/);
    expect(GITHUB_ACTIONS_NEVER_SCHEDULED_REASON).toMatch(/spending limit/);
    expect(GITHUB_ACTIONS_NEVER_SCHEDULED_REASON).toMatch(/DEFAULT branch/);
  });

  it('waits on a run GitHub has queued but not started — the normal slow case', () => {
    for (const status of ['queued', 'waiting', 'requested', 'pending', 'in_progress']) {
      const v = classifyActionsDispatch({
        matched: { status, conclusion: null, displayTitle: agentRunName(7), htmlUrl: null, createdAtMs: null },
        ...noError,
      });
      expect(v.action, status).toBe('wait');
    }
  });

  it('fails a run that ended on GitHub without the agent ever checking in, and links the log', () => {
    const v = classifyActionsDispatch({
      matched: {
        status: 'completed', conclusion: 'startup_failure',
        displayTitle: agentRunName(7), htmlUrl: 'https://github.com/o/r/actions/runs/1', createdAtMs: null,
      },
      ...noError,
    });
    expect(v.action).toBe('fail');
    // The failure is in GitHub's log, not ours — the URL is the actionable part.
    expect(v.action === 'fail' && v.reason).toContain('https://github.com/o/r/actions/runs/1');
    expect(v.action === 'fail' && v.reason).toContain('startup_failure');
  });

  it('still fails a run that "succeeded" on GitHub without the agent ever reporting in', () => {
    // A green job whose execution never left pending means the agent step never
    // reached us — leaving it pending until the reaper says "silent run" hides that.
    const v = classifyActionsDispatch({
      matched: { status: 'completed', conclusion: 'success', displayTitle: agentRunName(7), htmlUrl: null, createdAtMs: null },
      ...noError,
    });
    expect(v.action).toBe('fail');
    expect(v.action === 'fail' && v.reason).toMatch(/without the Builderforce agent ever checking in/);
  });

  it('waits when the repo runs a pre-run-name workflow, because "no match" proves nothing', () => {
    const v = classifyActionsDispatch({ matched: null, unattributedRuns: 3, listError: null });
    expect(v.action).toBe('wait');
  });

  it('fails when Actions is administratively unreadable (403 / missing workflow)', () => {
    for (const code of ['unauthorized', 'not_found']) {
      const v = classifyActionsDispatch({
        matched: null, unattributedRuns: 0,
        listError: { code, reason: 'Resource not accessible by integration' },
      });
      expect(v.action, code).toBe('fail');
      expect(v.action === 'fail' && v.reason).toContain('Resource not accessible by integration');
    }
  });

  it('never fails a run on OUR flakiness — a rate limit or 5xx defers to the reaper', () => {
    for (const code of ['rate_limited', 'provider_error', 'unsupported']) {
      const v = classifyActionsDispatch({
        matched: null, unattributedRuns: 0, listError: { code, reason: 'boom' },
      });
      expect(v.action, code).toBe('wait');
    }
  });
});

describe('run-name correlation', () => {
  it('round-trips the execution id through the run name', () => {
    expect(parseExecutionIdFromRunName(agentRunName(4211))).toBe(4211);
  });

  it('returns null for a legacy run title carrying no id', () => {
    expect(parseExecutionIdFromRunName('Builderforce Agent')).toBeNull();
    expect(parseExecutionIdFromRunName(null)).toBeNull();
    expect(parseExecutionIdFromRunName('')).toBeNull();
  });

  it('emits run-name into the committed workflow, interpolating the dispatch input', () => {
    const wf = renderAgentWorkflow({ apiOrigin: 'https://api.builderforce.ai' });
    expect(wf).toContain('run-name: Builderforce Agent · execution ${{ inputs.execution_id }}');
  });
});

describe('reconcile window', () => {
  it('acts only inside the window the generic queued reaper has not reached', () => {
    // Past QUEUED_DEADLINE_MS the reaper owns the row; racing it would write two
    // terminal states for one run.
    expect(ACTIONS_SCHEDULE_GRACE_MS).toBeLessThan(QUEUED_DEADLINE_MS);
    // …and longer than one */5 tick, so a dispatch is never judged by the sweep
    // that could have raced it.
    expect(ACTIONS_SCHEDULE_GRACE_MS).toBeGreaterThan(5 * 60_000);
  });
});

describe('countBlockingUnattributedRuns', () => {
  const dispatchedAt = Date.parse('2026-08-19T12:00:00Z');
  const run = (title: string | null, createdAt: string | null) => ({
    status: 'completed', conclusion: 'success', displayTitle: title, htmlUrl: null,
    createdAtMs: createdAt ? Date.parse(createdAt) : null,
  });

  it('ignores anonymous runs that predate the dispatch — they cannot be its run', () => {
    // The sticky-wait bug: a repo that once ran the pre-run-name workflow keeps
    // those anonymous rows in the last-50 window, and counting them held EVERY
    // later verdict on that repo at `wait`, including ones dispatched long after
    // the workflow was refreshed.
    const runs = [run(null, '2026-06-01T09:00:00Z'), run(null, '2026-07-04T09:00:00Z')];
    expect(countBlockingUnattributedRuns(runs, dispatchedAt)).toBe(0);
    expect(classifyActionsDispatch({
      matched: null, unattributedRuns: countBlockingUnattributedRuns(runs, dispatchedAt), listError: null,
    }).action).toBe('fail');
  });

  it('still blocks on an anonymous run created since the dispatch', () => {
    const runs = [run(null, '2026-08-19T12:00:30Z')];
    expect(countBlockingUnattributedRuns(runs, dispatchedAt)).toBe(1);
    expect(classifyActionsDispatch({
      matched: null, unattributedRuns: countBlockingUnattributedRuns(runs, dispatchedAt), listError: null,
    }).action).toBe('wait');
  });

  it('does not count runs that DO carry an execution id, whenever they ran', () => {
    const runs = [run(agentRunName(41), '2026-08-19T12:00:30Z'), run(agentRunName(9), '2026-01-01T00:00:00Z')];
    expect(countBlockingUnattributedRuns(runs, dispatchedAt)).toBe(0);
  });

  it('keeps an undated anonymous run in scope — an unknown must not become a fail', () => {
    expect(countBlockingUnattributedRuns([run(null, null)], dispatchedAt)).toBe(1);
  });

  it('allows clock skew, but far less than the grace window it sits inside', () => {
    // A run stamped slightly BEFORE our row is still plausibly ours.
    const runs = [run(null, '2026-08-19T11:59:30Z')];
    expect(countBlockingUnattributedRuns(runs, dispatchedAt)).toBe(1);
    expect(ACTIONS_RUN_CLOCK_SKEW_MS).toBeLessThan(ACTIONS_SCHEDULE_GRACE_MS);
  });
});

describe('agent workflow refresh queue', () => {
  it('terminates: the backoff grows and the attempt ceiling is small', () => {
    // The dominant failure is a credential without the `workflow` scope, which no
    // amount of retrying fixes — so the queue must empty rather than spin.
    expect(AGENT_WORKFLOW_REFRESH_MAX_ATTEMPTS).toBeLessThanOrEqual(3);
    expect(agentWorkflowRefreshBackoffMs(2)).toBeGreaterThan(agentWorkflowRefreshBackoffMs(1));
    expect(agentWorkflowRefreshBackoffMs(1)).toBeGreaterThanOrEqual(5 * 60_000);
  });

  it('bounds a tick so the migration-queued backlog cannot starve the other sweeps', () => {
    expect(AGENT_WORKFLOW_REFRESH_MAX_PER_TICK).toBeGreaterThan(0);
    expect(AGENT_WORKFLOW_REFRESH_MAX_PER_TICK).toBeLessThanOrEqual(25);
  });

  it('names a revision the committed workflow actually carries', () => {
    // The revision is the whole basis for "this repo is behind"; a bump that did
    // not change the file, or a file that lost run-name, both break the contract.
    expect(AGENT_WORKFLOW_REVISION).toMatch(/^r\d+$/);
    expect(renderAgentWorkflow({ apiOrigin: 'https://api.builderforce.ai' })).toContain('run-name:');
  });
});
