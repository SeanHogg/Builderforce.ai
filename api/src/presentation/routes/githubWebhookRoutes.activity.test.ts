/**
 * GitHub webhook → activity-event normalization. Pure mappers (no DB), so we can
 * assert the exact IngestEvent shape the producer feeds into activity_events.
 */
import { describe, it, expect } from 'vitest';
import { commitEvents, mergedPullRequestRef, pullRequestEvents, reviewEvents, issueEvents } from './githubWebhookRoutes';

describe('commitEvents', () => {
  it('maps each commit on a branch push, preferring login then email', () => {
    const events = commitEvents({
      ref: 'refs/heads/main',
      repository: { full_name: 'acme/api', name: 'api' },
      commits: [
        { id: 'sha1', message: 'feat: thing\n\nbody', url: 'http://c/1', timestamp: '2026-06-20T10:00:00Z', author: { username: 'alice', name: 'Alice', email: 'a@acme.dev' } },
        { id: 'sha2', message: 'fix', url: 'http://c/2', timestamp: '2026-06-20T11:00:00Z', author: { name: 'Bob', email: 'bob@acme.dev' } },
      ],
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      eventType: 'commit', externalId: 'sha1', contributorExternalId: 'alice',
      title: 'feat: thing', repositoryFullName: 'acme/api', repositoryName: 'api', occurredAt: '2026-06-20T10:00:00Z',
    });
    // No login → falls back to email as the identity (still attributed, no orphan).
    expect(events[1]!.contributorExternalId).toBe('bob@acme.dev');
  });

  it('skips tag pushes', () => {
    expect(commitEvents({ ref: 'refs/tags/v1', repository: { full_name: 'acme/api' }, commits: [{ id: 's' }] })).toEqual([]);
  });
});

describe('pullRequestEvents', () => {
  it('opened → pr_opened', () => {
    const [e] = pullRequestEvents({ action: 'opened', number: 7, repository: { full_name: 'acme/api' }, pull_request: { user: { login: 'alice' }, title: 'PR', html_url: 'http://p/7', created_at: '2026-06-20T10:00:00Z' } });
    expect(e).toMatchObject({ eventType: 'pr_opened', externalId: 'pr-7', contributorExternalId: 'alice', occurredAt: '2026-06-20T10:00:00Z', cycleTimeHours: null });
  });

  it('closed+merged → pr_merged with cycle time in hours', () => {
    const [e] = pullRequestEvents({ action: 'closed', number: 7, repository: { full_name: 'acme/api' }, pull_request: { merged: true, user: { login: 'alice' }, created_at: '2026-06-20T10:00:00Z', merged_at: '2026-06-20T14:00:00Z' } });
    expect(e).toMatchObject({ eventType: 'pr_merged', externalId: 'pr-7', cycleTimeHours: 4 });
  });

  it('closed without merge → pr_closed', () => {
    const [e] = pullRequestEvents({ action: 'closed', number: 8, repository: { full_name: 'acme/api' }, pull_request: { merged: false, user: { login: 'alice' }, created_at: '2026-06-20T10:00:00Z' } });
    expect(e!.eventType).toBe('pr_closed');
  });

  it('ignores non-lifecycle actions', () => {
    expect(pullRequestEvents({ action: 'synchronize', pull_request: {} })).toEqual([]);
  });
});

describe('reviewEvents', () => {
  it('submitted → pr_reviewed', () => {
    const [e] = reviewEvents({ action: 'submitted', repository: { full_name: 'acme/api' }, review: { id: 99, state: 'approved', user: { login: 'carol' }, submitted_at: '2026-06-20T12:00:00Z', html_url: 'http://r/99' } });
    expect(e).toMatchObject({ eventType: 'pr_reviewed', externalId: 'review-99', contributorExternalId: 'carol', title: 'Review: approved' });
  });

  it('ignores non-submitted', () => {
    expect(reviewEvents({ action: 'dismissed', review: {} })).toEqual([]);
  });
});

describe('issueEvents', () => {
  it('opened → issue_created, closed → issue_resolved', () => {
    const [opened] = issueEvents({ action: 'opened', repository: { full_name: 'acme/api' }, issue: { number: 3, title: 'bug', user: { login: 'dave' }, created_at: '2026-06-20T09:00:00Z', html_url: 'http://i/3' } });
    expect(opened).toMatchObject({ eventType: 'issue_created', externalId: 'issue-3', contributorExternalId: 'dave', occurredAt: '2026-06-20T09:00:00Z' });
    const [closed] = issueEvents({ action: 'closed', repository: { full_name: 'acme/api' }, issue: { number: 3, title: 'bug', user: { login: 'dave' }, closed_at: '2026-06-20T15:00:00Z' } });
    expect(closed).toMatchObject({ eventType: 'issue_resolved', occurredAt: '2026-06-20T15:00:00Z' });
  });

  it('ignores other actions', () => {
    expect(issueEvents({ action: 'labeled', issue: { number: 1 } })).toEqual([]);
  });
});

/**
 * The MERGE half of "a delta ticket completes automatically once merged".
 *
 * The run that records a delta and leaves its change on a branch never sees the merge,
 * so this payload is the only evidence that the change shipped. Reading its shape wrong
 * would stop delta tickets closing with no error anywhere — a silent regression whose
 * only symptom is tickets accumulating at 50% on the board — so the extraction is pinned
 * here rather than trusted to whichever payload the author had open.
 */
describe('mergedPullRequestRef', () => {
  const merged = {
    action: 'closed',
    number: 42,
    repository: { full_name: 'acme/api' },
    pull_request: { merged: true, head: { ref: 'ticket/2394-mobile-board-height' } },
  };

  it('extracts the repo, number and head branch of a merged pull request', () => {
    expect(mergedPullRequestRef(merged)).toEqual({
      repoFullName: 'acme/api',
      number: 42,
      branchName: 'ticket/2394-mobile-board-height',
      provider: 'github',
    });
  });

  it('is null for a pull request that was CLOSED without merging', () => {
    // The distinction the whole feature turns on: nothing shipped, so nothing completes.
    expect(mergedPullRequestRef({ ...merged, pull_request: { merged: false, head: { ref: 'ticket/1' } } })).toBeNull();
  });

  it('is null for every non-close action', () => {
    for (const action of ['opened', 'reopened', 'synchronize', 'edited']) {
      expect(mergedPullRequestRef({ ...merged, action }), action).toBeNull();
    }
  });

  it('is null without a repository — there is no project to scope the ticket to', () => {
    expect(mergedPullRequestRef({ ...merged, repository: {} })).toBeNull();
  });

  it('falls back to the number on the pull_request object', () => {
    const { number: _dropped, ...withoutTopLevel } = merged;
    expect(mergedPullRequestRef({ ...withoutTopLevel, pull_request: { merged: true, number: 9, head: { ref: 'main' } } }))
      .toMatchObject({ number: 9 });
  });

  it('carries a null branch rather than failing when head is absent', () => {
    // The PR-row `task_id` join still works without a branch; only the fallback is lost.
    expect(mergedPullRequestRef({ ...merged, pull_request: { merged: true } }))
      .toMatchObject({ number: 42, branchName: null });
  });
});
