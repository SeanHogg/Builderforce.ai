/** Bitbucket REST → IngestEvent mappers. Pure; asserts the ingested shape. */
import { describe, it, expect } from 'vitest';
import { mapBbCommit, mapBbPull, emailFromRaw } from './bitbucketActivitySource';

describe('emailFromRaw', () => {
  it('extracts the email from "Name <email>"', () => {
    expect(emailFromRaw('Al Dev <al@x.dev>')).toBe('al@x.dev');
    expect(emailFromRaw('no-email')).toBeNull();
    expect(emailFromRaw(null)).toBeNull();
  });
});

describe('mapBbCommit', () => {
  it('prefers account_id, falls back to raw email', () => {
    const withUser = mapBbCommit({ hash: 'h1', message: 'feat: x\nbody', date: '2026-06-20T10:00:00Z', author: { raw: 'Al <al@x.dev>', user: { account_id: 'acct-1', display_name: 'Al' } }, links: { html: { href: 'http://c' } } }, 'ws/api', 'api');
    expect(withUser).toMatchObject({ eventType: 'commit', externalId: 'h1', contributorExternalId: 'acct-1', title: 'feat: x', occurredAt: '2026-06-20T10:00:00Z' });

    const noUser = mapBbCommit({ hash: 'h2', message: 'fix', date: '2026-06-20T11:00:00Z', author: { raw: 'Bob <bob@x.dev>', user: null } }, 'ws/api', 'api');
    expect(noUser?.contributorExternalId).toBe('bob@x.dev');
  });
  it('returns null without a hash', () => {
    expect(mapBbCommit({ message: 'x' }, 'ws/api', 'api')).toBeNull();
  });
});

describe('mapBbPull', () => {
  it('open PR → only pr_opened', () => {
    const events = mapBbPull({ id: 9, title: 'PR', state: 'OPEN', author: { account_id: 'acct-1', display_name: 'Al' }, created_on: '2026-06-20T10:00:00Z', links: { html: { href: 'http://p' } } }, 'ws/api', 'api');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: 'pr_opened', externalId: 'pr-9', contributorExternalId: 'acct-1' });
  });
  it('merged PR → pr_opened + pr_merged with cycle time', () => {
    const events = mapBbPull({ id: 9, state: 'MERGED', author: { account_id: 'acct-1' }, created_on: '2026-06-20T10:00:00Z', updated_on: '2026-06-20T15:00:00Z' }, 'ws/api', 'api');
    expect(events.map((e) => e.eventType)).toEqual(['pr_opened', 'pr_merged']);
    expect(events[1]).toMatchObject({ cycleTimeHours: 5, occurredAt: '2026-06-20T15:00:00Z' });
  });
  it('declined PR → pr_opened + pr_closed', () => {
    const events = mapBbPull({ id: 10, state: 'DECLINED', author: { account_id: 'acct-1' }, created_on: '2026-06-20T10:00:00Z', updated_on: '2026-06-20T12:00:00Z' }, 'ws/api', 'api');
    expect(events.map((e) => e.eventType)).toEqual(['pr_opened', 'pr_closed']);
  });
});
