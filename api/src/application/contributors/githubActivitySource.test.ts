/**
 * GitHub REST → IngestEvent mappers (the poll producer). Pure, so we assert the
 * exact shape ingested into activity_events without the network.
 */
import { describe, it, expect } from 'vitest';
import { mapCommit, mapPull, mapReview } from './githubActivitySource';

describe('mapCommit', () => {
  it('prefers GitHub login, falls back to git email', () => {
    const withLogin = mapCommit(
      { sha: 'abc', html_url: 'http://c', commit: { message: 'feat: x\nbody', author: { name: 'Al', email: 'al@x.dev', date: '2026-06-20T10:00:00Z' } }, author: { login: 'al', avatar_url: 'http://a' } },
      'acme/api', 'api',
    );
    expect(withLogin).toMatchObject({ eventType: 'commit', externalId: 'abc', contributorExternalId: 'al', title: 'feat: x', occurredAt: '2026-06-20T10:00:00Z' });

    const noLogin = mapCommit({ sha: 'def', commit: { message: 'fix', author: { email: 'bob@x.dev', date: '2026-06-20T11:00:00Z' } }, author: null }, 'acme/api', 'api');
    expect(noLogin?.contributorExternalId).toBe('bob@x.dev');
  });

  it('returns null without a sha', () => {
    expect(mapCommit({ commit: { message: 'x' } }, 'acme/api', 'api')).toBeNull();
  });
});

describe('mapPull', () => {
  it('open PR → only pr_opened', () => {
    const events = mapPull({ number: 7, title: 'PR', html_url: 'http://p', state: 'open', user: { login: 'al' }, created_at: '2026-06-20T10:00:00Z' }, 'acme/api', 'api');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: 'pr_opened', externalId: 'pr-7', contributorExternalId: 'al' });
  });

  it('merged PR → pr_opened + pr_merged with cycle time', () => {
    const events = mapPull({ number: 7, state: 'closed', user: { login: 'al' }, created_at: '2026-06-20T10:00:00Z', merged_at: '2026-06-20T16:00:00Z' }, 'acme/api', 'api');
    expect(events.map((e) => e.eventType)).toEqual(['pr_opened', 'pr_merged']);
    expect(events[1]).toMatchObject({ eventType: 'pr_merged', cycleTimeHours: 6, occurredAt: '2026-06-20T16:00:00Z' });
  });

  it('closed-unmerged PR → pr_opened + pr_closed', () => {
    const events = mapPull({ number: 8, state: 'closed', user: { login: 'al' }, created_at: '2026-06-20T10:00:00Z', closed_at: '2026-06-20T12:00:00Z', merged_at: null }, 'acme/api', 'api');
    expect(events.map((e) => e.eventType)).toEqual(['pr_opened', 'pr_closed']);
  });

  it('returns [] without a number', () => {
    expect(mapPull({ title: 'x' }, 'acme/api', 'api')).toEqual([]);
  });
});

describe('mapReview', () => {
  it('maps a review to pr_reviewed', () => {
    const e = mapReview({ id: 99, state: 'approved', user: { login: 'carol' }, submitted_at: '2026-06-20T12:00:00Z', html_url: 'http://r' }, 'acme/api', 'api');
    expect(e).toMatchObject({ eventType: 'pr_reviewed', externalId: 'review-99', contributorExternalId: 'carol', title: 'Review: approved' });
  });

  it('returns null without an id', () => {
    expect(mapReview({ state: 'approved' }, 'acme/api', 'api')).toBeNull();
  });
});
