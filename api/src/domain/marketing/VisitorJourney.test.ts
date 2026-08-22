import { describe, it, expect } from 'vitest';
import { isVisitId, normalizePath, parseVisitorEvent } from './VisitorJourney';

const context = { visitorId: 'visitor-1', personaOf: () => null, nowMs: 1_700_000_000_000 };

describe('parseVisitorEvent', () => {
  it('rejects a malformed kind rather than storing it', () => {
    expect(parseVisitorEvent({ kind: 'Page View!' }, context)).toBeNull();
    expect(parseVisitorEvent({ kind: '' }, context)).toBeNull();
    expect(parseVisitorEvent({}, context)).toBeNull();
  });

  it('stamps its own time when the client clock is implausible', () => {
    // A wrong clock must not be able to write into last week — the batch arrives
    // from an unauthenticated browser and its timestamp is a claim, not a fact.
    const drifted = parseVisitorEvent(
      { kind: 'page_view', occurredAt: new Date(context.nowMs - 5 * 86_400_000).toISOString() },
      context,
    );
    expect(drifted?.occurredAt.getTime()).toBe(context.nowMs);

    const recent = new Date(context.nowMs - 30_000).toISOString();
    expect(parseVisitorEvent({ kind: 'page_view', occurredAt: recent }, context)?.occurredAt.toISOString())
      .toBe(recent);
  });

  it('keeps the event when the visit id is unusable, without the id', () => {
    const parsed = parseVisitorEvent({ kind: 'page_view', visitId: 'nope!' }, context);
    expect(parsed).not.toBeNull();
    expect(parsed?.visitId).toBeNull();
  });

  it('drops metadata it cannot serialize rather than dropping the event', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const parsed = parseVisitorEvent({ kind: 'page_view', metadata: circular }, context);
    expect(parsed?.kind).toBe('page_view');
    expect(parsed?.metadata).toBeNull();
  });
});

describe('normalizePath', () => {
  it('drops the query string so one step is one node', () => {
    // /pricing?utm_source=x and /pricing are the same STEP; keeping them apart
    // shatters the busiest node into a long tail of one-visitor variants.
    expect(normalizePath('/pricing?utm_source=x&utm_campaign=y')).toBe('/pricing');
    expect(normalizePath('/docs#install')).toBe('/docs');
  });

  it('normalizes a trailing slash without destroying the root', () => {
    expect(normalizePath('/docs/')).toBe('/docs');
    expect(normalizePath('/')).toBe('/');
  });

  it('returns null for anything that is not a usable path', () => {
    expect(normalizePath('')).toBeNull();
    expect(normalizePath('   ')).toBeNull();
    expect(normalizePath(42)).toBeNull();
  });
});

describe('isVisitId', () => {
  it('accepts the same alphabet the visitor id uses and nothing else', () => {
    expect(isVisitId('abcd1234-_ABCD')).toBe(true);
    expect(isVisitId('short')).toBe(false);
    expect(isVisitId('has spaces in it')).toBe(false);
    expect(isVisitId(null)).toBe(false);
  });
});
