import { describe, it, expect } from 'vitest';
import { getErrorAdapter } from './adapters';
import { QUALITY_SOURCE_IDS } from './qualitySourceCatalog';
import { hmacSha256Hex } from '../../infrastructure/crypto/webhookHmac';

describe('adapter registry', () => {
  it('covers every catalog source id', () => {
    for (const id of QUALITY_SOURCE_IDS) {
      expect(getErrorAdapter(id).id).toBe(id);
    }
  });
  it('throws for an unknown source', () => {
    expect(() => getErrorAdapter('nope')).toThrow();
  });
});

describe('native adapter', () => {
  it('accepts a batch and coerces fields', () => {
    const out = getErrorAdapter('native').normalize([
      { type: 'TypeError', message: 'x is not a function', level: 'error' },
      { name: 'RangeError', value: 'out of range', level: 'warn' },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ type: 'TypeError', message: 'x is not a function', level: 'error', source: 'native' });
    expect(out[1]).toMatchObject({ type: 'RangeError', message: 'out of range', level: 'warning' });
  });
  it('accepts a single object and an {events:[]} envelope', () => {
    expect(getErrorAdapter('native').normalize({ type: 'E', message: 'm' })).toHaveLength(1);
    expect(getErrorAdapter('native').normalize({ events: [{ type: 'E', message: 'm' }] })).toHaveLength(1);
  });
});

describe('otlp adapter', () => {
  it('keeps ERROR-severity logs and maps exception.* attributes', () => {
    const out = getErrorAdapter('otlp').normalize({
      resourceLogs: [{
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'web' } }] },
        scopeLogs: [{ logRecords: [
          { severityNumber: 17, severityText: 'ERROR', body: { stringValue: 'boom' },
            attributes: [{ key: 'exception.type', value: { stringValue: 'TypeError' } }, { key: 'exception.message', value: { stringValue: 'x undefined' } }] },
          { severityNumber: 9, severityText: 'INFO', body: { stringValue: 'noise' }, attributes: [] },
        ] }],
      }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'TypeError', message: 'x undefined', source: 'otlp', tags: { service: 'web' } });
  });
  it('keeps error-status spans (status.code === 2)', () => {
    const out = getErrorAdapter('otlp').normalize({
      resourceSpans: [{ scopeSpans: [{ spans: [
        { name: 'GET /x', status: { code: 2 }, attributes: [{ key: 'exception.message', value: { stringValue: 'fail' } }],
          events: [{ name: 'exception', attributes: [{ key: 'exception.type', value: { stringValue: 'DBError' } }] }] },
        { name: 'GET /ok', status: { code: 1 }, attributes: [] },
      ] }] }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'DBError', message: 'fail', source: 'otlp' });
  });
});

describe('sentry adapter', () => {
  it('normalizes an event with an exception + stack', () => {
    const out = getErrorAdapter('sentry').normalize({
      data: { event: {
        event_id: 'e1', issue_id: 'i1', level: 'error', environment: 'production', release: 'v2',
        exception: { values: [{ type: 'TypeError', value: 'x is not a function', stacktrace: { frames: [{ function: 'f', filename: 'a.js', lineno: 3, colno: 2 }] } }] },
      } },
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'TypeError', message: 'x is not a function', fingerprint: 'i1', environment: 'production', release: 'v2', source: 'sentry' });
    expect(Array.isArray(out[0]?.stack)).toBe(true);
  });
  it('falls back to the issue shape', () => {
    const out = getErrorAdapter('sentry').normalize({ data: { issue: { id: 'i9', title: 'Boom', culprit: 'foo()', status: 'unresolved' } } });
    expect(out[0]).toMatchObject({ fingerprint: 'i9', message: 'Boom', source: 'sentry' });
  });
  it('verifies a Sentry-Hook-Signature', async () => {
    const adapter = getErrorAdapter('sentry');
    const body = '{"x":1}';
    const sig = await hmacSha256Hex('shh', body);
    expect(await adapter.verify!(body, (n) => (n === 'Sentry-Hook-Signature' ? sig : undefined), 'shh')).toBe(true);
    expect(await adapter.verify!(body, () => 'bad', 'shh')).toBe(false);
  });
});

describe('posthog adapter', () => {
  it('normalizes a $exception event', () => {
    const out = getErrorAdapter('posthog').normalize({
      event: { event: '$exception', distinct_id: 'u1', timestamp: '2026-01-01T00:00:00Z', properties: {
        $exception_list: [{ type: 'Error', value: 'kaboom', stacktrace: { frames: [{ function: 'g', source: 'b.js', line: 7, column: 1 }] } }],
        $current_url: 'https://app/x',
      } },
    });
    expect(out[0]).toMatchObject({ type: 'Error', message: 'kaboom', url: 'https://app/x', userKey: 'u1', source: 'posthog' });
  });
  it('ignores non-exception events', () => {
    expect(getErrorAdapter('posthog').normalize({ event: { event: '$pageview', properties: {} } })).toHaveLength(0);
  });
});

describe('logrocket adapter', () => {
  it('normalizes an error issue', () => {
    const out = getErrorAdapter('logrocket').normalize({ issue: { id: 'lr1', errorType: 'TypeError', message: 'nope', url: 'https://app/y', userID: 'u2' } });
    expect(out[0]).toMatchObject({ fingerprint: 'lr1', type: 'TypeError', message: 'nope', url: 'https://app/y', userKey: 'u2', source: 'logrocket' });
  });
});
