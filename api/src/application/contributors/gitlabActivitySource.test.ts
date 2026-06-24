/** GitLab REST → IngestEvent mappers. Pure; asserts the ingested shape. */
import { describe, it, expect } from 'vitest';
import { mapGlCommit, mapGlMergeRequest } from './gitlabActivitySource';

describe('mapGlCommit', () => {
  it('attributes by author email with line stats', () => {
    const e = mapGlCommit(
      { id: 'sha1', title: 'feat: x', created_at: '2026-06-20T10:00:00Z', author_name: 'Al', author_email: 'al@x.dev', web_url: 'http://c', stats: { additions: 10, deletions: 2 } },
      'grp/api', 'api',
    );
    expect(e).toMatchObject({ eventType: 'commit', externalId: 'sha1', contributorExternalId: 'al@x.dev', title: 'feat: x', linesAdded: 10, linesRemoved: 2, occurredAt: '2026-06-20T10:00:00Z' });
  });
  it('returns null without an id', () => {
    expect(mapGlCommit({ title: 'x' }, 'grp/api', 'api')).toBeNull();
  });
});

describe('mapGlMergeRequest', () => {
  it('open MR → only pr_opened', () => {
    const events = mapGlMergeRequest({ iid: 5, title: 'MR', web_url: 'http://m', state: 'opened', author: { username: 'al' }, created_at: '2026-06-20T10:00:00Z' }, 'grp/api', 'api');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: 'pr_opened', externalId: 'mr-5', contributorExternalId: 'al' });
  });
  it('merged MR → pr_opened + pr_merged with cycle time', () => {
    const events = mapGlMergeRequest({ iid: 5, state: 'merged', author: { username: 'al' }, created_at: '2026-06-20T10:00:00Z', merged_at: '2026-06-20T13:00:00Z' }, 'grp/api', 'api');
    expect(events.map((e) => e.eventType)).toEqual(['pr_opened', 'pr_merged']);
    expect(events[1]).toMatchObject({ cycleTimeHours: 3, occurredAt: '2026-06-20T13:00:00Z' });
  });
  it('closed MR → pr_opened + pr_closed', () => {
    const events = mapGlMergeRequest({ iid: 6, state: 'closed', author: { username: 'al' }, created_at: '2026-06-20T10:00:00Z', closed_at: '2026-06-20T11:00:00Z' }, 'grp/api', 'api');
    expect(events.map((e) => e.eventType)).toEqual(['pr_opened', 'pr_closed']);
  });
});
