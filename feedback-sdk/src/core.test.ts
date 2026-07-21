import { describe, it, expect, vi } from 'vitest';
import {
  buildPayload, normalizeEndpoint, postFeedback, resolveKinds, resolveLabels, kindLabel,
  DEFAULT_ENDPOINT, DEFAULT_LABELS, ALL_KINDS,
} from './core';

describe('normalizeEndpoint', () => {
  it('defaults to the hosted ingest base', () => {
    expect(normalizeEndpoint(undefined)).toBe(DEFAULT_ENDPOINT);
    expect(normalizeEndpoint('   ')).toBe(DEFAULT_ENDPOINT);
  });

  it('tolerates a trailing slash and a mistakenly-included /submit', () => {
    expect(normalizeEndpoint('https://api.x.dev/api/feedback-ingest/')).toBe('https://api.x.dev/api/feedback-ingest');
    expect(normalizeEndpoint('https://api.x.dev/api/feedback-ingest/submit')).toBe('https://api.x.dev/api/feedback-ingest');
  });
});

describe('resolveKinds', () => {
  it('offers every kind by default', () => {
    expect(resolveKinds(undefined)).toEqual(ALL_KINDS);
  });

  it('honours a caller subset but ignores unknown values', () => {
    expect(resolveKinds(['bug', 'idea'])).toEqual(['bug', 'idea']);
    expect(resolveKinds(['nonsense' as never])).toEqual(ALL_KINDS);
  });
});

describe('buildPayload', () => {
  const base = { kind: 'feature' as const, title: '', body: 'Add CSV export', email: '' };

  it('requires a body', () => {
    expect(buildPayload({ ...base, body: '   ' }, {})).toEqual({ error: 'empty' });
  });

  it('omits every empty optional field rather than sending blanks', () => {
    expect(buildPayload(base, {})).toEqual({ kind: 'feature', body: 'Add CSV export' });
  });

  it('carries page url, app version and ambient context when present', () => {
    const p = buildPayload(
      { ...base, title: ' Export ', email: ' a@b.co ' },
      { appVersion: '2026.7.19', context: { plan: 'pro' } },
      { url: 'https://app.x.dev/reports' },
    );
    expect(p).toEqual({
      kind: 'feature',
      body: 'Add CSV export',
      title: 'Export',
      email: 'a@b.co',
      url: 'https://app.x.dev/reports',
      appVersion: '2026.7.19',
      context: { plan: 'pro' },
    });
  });
});

describe('postFeedback', () => {
  const payload = { kind: 'bug' as const, body: 'it broke' };

  it('authenticates with the ingest key and posts to /submit', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true, status: 202, json: async () => ({ submissionId: 's1', deduped: false }),
    });
    const r = await postFeedback('https://api.x.dev/api/feedback-ingest', 'bff_abc', payload, fetchFn as never);
    expect(r).toEqual({ ok: true, submissionId: 's1', deduped: false });

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://api.x.dev/api/feedback-ingest/submit');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer bff_abc' });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(payload);
  });

  it('flags a 429 so the widget can say "try tomorrow" instead of "try again"', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    expect(await postFeedback('e', 'k', payload, fetchFn as never)).toEqual({ ok: false, rateLimited: true });
  });

  it('reports a plain failure for other error statuses', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    expect(await postFeedback('e', 'k', payload, fetchFn as never)).toEqual({ ok: false });
  });

  it('never throws when the network is down', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await postFeedback('e', 'k', payload, fetchFn as never)).toEqual({ ok: false });
  });

  it('survives a success response with an unreadable body', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => { throw new Error('nope'); } });
    expect(await postFeedback('e', 'k', payload, fetchFn as never)).toEqual({ ok: true, submissionId: undefined, deduped: false });
  });
});

describe('labels', () => {
  it('merges overrides onto the shipped defaults', () => {
    const l = resolveLabels({ tab: 'Ideas' });
    expect(l.tab).toBe('Ideas');
    expect(l.submit).toBe(DEFAULT_LABELS.submit);
  });

  it('maps every kind to a label', () => {
    const l = resolveLabels(undefined);
    for (const k of ALL_KINDS) expect(kindLabel(k, l)).toBeTruthy();
    expect(kindLabel('bug', l)).toBe(l.kindBug);
  });
});
