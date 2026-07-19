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
import { classifyActionsDispatch, ACTIONS_SCHEDULE_GRACE_MS } from './githubActionsReconcile';
import { GITHUB_ACTIONS_NEVER_SCHEDULED_REASON } from './orphanReasons';
import { agentRunName, parseExecutionIdFromRunName, renderAgentWorkflow } from './githubActionsWorkflow';
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
        matched: { status, conclusion: null, displayTitle: agentRunName(7), htmlUrl: null },
        ...noError,
      });
      expect(v.action, status).toBe('wait');
    }
  });

  it('fails a run that ended on GitHub without the agent ever checking in, and links the log', () => {
    const v = classifyActionsDispatch({
      matched: {
        status: 'completed', conclusion: 'startup_failure',
        displayTitle: agentRunName(7), htmlUrl: 'https://github.com/o/r/actions/runs/1',
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
      matched: { status: 'completed', conclusion: 'success', displayTitle: agentRunName(7), htmlUrl: null },
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
