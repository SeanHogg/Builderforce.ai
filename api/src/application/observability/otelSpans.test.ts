import { describe, expect, it } from 'vitest';
import { buildOtlpTracePayload, runIsSampled, spanIdFor, traceIdFor, tracesUrl } from './otelSpans';

/**
 * GAP B3 — the OTLP wire shape. A collector rejects a payload that is subtly wrong
 * with a 400 and no further explanation, so the encoding is pinned here rather than
 * discovered in production.
 */
describe('OTLP ids', () => {
  it('uses a 32-hex trace id and a 16-hex span id, stable per run', () => {
    expect(traceIdFor(42)).toHaveLength(32);
    expect(spanIdFor(42, 0)).toHaveLength(16);
    expect(traceIdFor(42)).toBe(traceIdFor(42));
    expect(traceIdFor(42)).not.toBe(traceIdFor(43));
  });

  it('gives two spans of one run different span ids under the same trace', () => {
    expect(spanIdFor(42, 0)).not.toBe(spanIdFor(42, 1));
  });
});

describe('buildOtlpTracePayload', () => {
  const payload = buildOtlpTracePayload({ serviceName: 'agents', tenantId: 7 }, [
    {
      executionId: 42,
      name: 'agent.tool.read_file',
      startTimeMs: 1_700_000_000_000,
      endTimeMs: 1_700_000_000_250,
      attributes: { 'builderforce.tool': 'read_file', 'builderforce.execution_id': 42, empty: '', missing: null },
    },
    { executionId: 42, name: 'agent.run.failed', startTimeMs: 1_700_000_001_000, ok: false },
  ]) as never as {
    resourceSpans: Array<{
      resource: { attributes: Array<{ key: string; value: Record<string, unknown> }> };
      scopeSpans: Array<{ spans: Array<Record<string, unknown>> }>;
    }>;
  };
  const spans = payload.resourceSpans[0].scopeSpans[0].spans;

  it('carries the service and tenant on the resource', () => {
    const keys = payload.resourceSpans[0].resource.attributes.map((a) => a.key);
    expect(keys).toContain('service.name');
    expect(keys).toContain('builderforce.tenant_id');
  });

  it('encodes times as nanosecond strings', () => {
    expect(spans[0].startTimeUnixNano).toBe('1700000000000000000');
    expect(spans[0].endTimeUnixNano).toBe('1700000000250000000');
  });

  it('drops empty and null attributes rather than exporting blanks', () => {
    const keys = (spans[0].attributes as Array<{ key: string }>).map((a) => a.key);
    expect(keys).toEqual(['builderforce.tool', 'builderforce.execution_id']);
  });

  it('marks a failed run ERROR and leaves an unjudged span UNSET', () => {
    expect(spans[1].status).toEqual({ code: 2 });
    expect(spans[0].status).toEqual({ code: 0 });
  });
});

describe('tracesUrl', () => {
  it('appends the traces path and tolerates a trailing slash', () => {
    expect(tracesUrl('https://collector.test')).toBe('https://collector.test/v1/traces');
    expect(tracesUrl('https://collector.test/')).toBe('https://collector.test/v1/traces');
  });

  it('leaves a per-signal endpoint alone rather than doubling the path', () => {
    expect(tracesUrl('https://collector.test/v1/traces')).toBe('https://collector.test/v1/traces');
  });
});

describe('runIsSampled', () => {
  it('exports everything at 1 and nothing at 0', () => {
    expect(runIsSampled(42, 1)).toBe(true);
    expect(runIsSampled(42, 0)).toBe(false);
  });

  it('is deterministic per run, so a trace is never half-exported', () => {
    const first = runIsSampled(12_345, 0.5);
    expect(runIsSampled(12_345, 0.5)).toBe(first);
  });

  it('keeps roughly the requested fraction across many runs', () => {
    const kept = Array.from({ length: 1_000 }, (_, i) => runIsSampled(i + 1, 0.25)).filter(Boolean).length;
    expect(kept).toBeGreaterThan(150);
    expect(kept).toBeLessThan(350);
  });
});
