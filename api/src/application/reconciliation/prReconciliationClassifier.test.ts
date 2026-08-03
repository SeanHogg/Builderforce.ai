import { describe, expect, it } from 'vitest';
import { classifyPullRequest, extractTaskId, type ReconciliationPrInput } from './prReconciliationClassifier';

const pr = (patch: Partial<ReconciliationPrInput> = {}): ReconciliationPrInput => ({
  number: 10,
  title: 'Task #42: implement it',
  body: '',
  headBranch: 'builderforce/task-42',
  isDraft: false,
  changedFiles: 2,
  additions: 20,
  deletions: 3,
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  checks: [{ name: 'CI', state: 'SUCCESS' }],
  ...patch,
});

const ticket = { id: 42, status: 'in_review', completedAt: null };

describe('PR/ticket reconciliation classifier', () => {
  it('extracts task ids from titles, bodies, and BuilderForce branches', () => {
    expect(extractTaskId('Task #1378: fix')).toBe(1378);
    expect(extractTaskId('', 'Changes for task #22')).toBe(22);
    expect(extractTaskId('', '', 'builderforce/task-401')).toBe(401);
  });

  it('does not blame a PR for the shared Cloudflare deployment failure', () => {
    const result = classifyPullRequest({
      pr: pr({ checks: [
        { name: 'CI', state: 'SUCCESS' },
        { name: 'Workers Builds: builderforce-frontend', state: 'FAILURE' },
      ] }),
      taskId: 42,
      ticket,
      duplicateOpenPrNumbers: [10],
    });
    expect(result.classification).toBe('infrastructure_failure');
    expect(result.recommendedAction).toBe('repair_infrastructure');
  });

  it('never closes merely because change-specific CI is red', () => {
    const result = classifyPullRequest({
      pr: pr({ checks: [{ name: 'frontend · types + unit tests', state: 'FAILURE' }] }),
      taskId: 42,
      ticket,
      duplicateOpenPrNumbers: [10],
    });
    expect(result.classification).toBe('repair');
    expect(result.recommendedAction).toBe('repair_pr');
  });

  it('only emits a high-confidence close candidate for deterministic abandonment evidence', () => {
    const result = classifyPullRequest({
      pr: pr(), taskId: 42,
      ticket: { ...ticket, status: 'cancelled' },
      duplicateOpenPrNumbers: [10],
    });
    expect(result).toMatchObject({ classification: 'close_candidate', recommendedAction: 'close', confidence: 'high' });
  });

  it('routes missing and duplicate ticket links to human review', () => {
    expect(classifyPullRequest({ pr: pr(), taskId: null, ticket: null, duplicateOpenPrNumbers: [] }).classification).toBe('human_review');
    expect(classifyPullRequest({ pr: pr(), taskId: 42, ticket, duplicateOpenPrNumbers: [10, 11] }).classification).toBe('human_review');
  });

  it('closes stale PRs whose ticket is currently done', () => {
    const result = classifyPullRequest({
      pr: pr(), taskId: 42,
      ticket: { ...ticket, status: 'done', completedAt: new Date() },
      duplicateOpenPrNumbers: [10],
    });
    expect(result.reasonCodes).toContain('done_ticket_has_stale_open_pr');
    expect(result).toMatchObject({ classification: 'close_candidate', recommendedAction: 'close', confidence: 'high' });
  });

  it('does not treat a historical completedAt as terminal after a ticket is reopened', () => {
    const result = classifyPullRequest({
      pr: pr({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }), taskId: 42,
      ticket: { ...ticket, status: 'in_review', completedAt: new Date() },
      duplicateOpenPrNumbers: [10],
    });
    expect(result.reasonCodes).toContain('merge_conflict');
    expect(result.classification).toBe('repair');
  });
});
