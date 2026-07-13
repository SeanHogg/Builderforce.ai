import { describe, it, expect } from 'vitest';
import { otlpLogsToJson, otlpTracesToJson } from './otlpProtobuf';
import { getErrorAdapter } from './adapters';

// ── Minimal protobuf encoder (test-only) — produces bytes our decoder reads ────
function varint(n: number): number[] {
  const out: number[] = [];
  while (n > 127) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
  out.push(n);
  return out;
}
const tag = (field: number, wt: number) => varint(field * 8 + wt);
const bytesOf = (s: string) => Array.from(new TextEncoder().encode(s));
const lenDelim = (field: number, body: number[]) => [...tag(field, 2), ...varint(body.length), ...body];
const strField = (field: number, s: string) => lenDelim(field, bytesOf(s));
const varintField = (field: number, n: number) => [...tag(field, 0), ...varint(n)];
const u = (arr: number[]) => new Uint8Array(arr);

// AnyValue{ string_value=1 }
const anyStr = (s: string) => strField(1, s);
// KeyValue{ key=1, value=2:AnyValue }
const kv = (key: string, val: string) => [...strField(1, key), ...lenDelim(2, anyStr(val))];

describe('otlpLogsToJson → otlp adapter', () => {
  it('decodes an ERROR log record with exception attributes', () => {
    // LogRecord message { severityNumber=2:17, severityText=3, body=5:AnyValue, attributes=6:KeyValue* }
    const logRecord = [
      ...varintField(2, 17),
      ...strField(3, 'ERROR'),
      ...lenDelim(5, anyStr('boom')),
      ...lenDelim(6, kv('exception.type', 'TypeError')),
      ...lenDelim(6, kv('exception.message', 'x is undefined')),
    ];
    const scopeLogsMsg = lenDelim(2, logRecord);              // ScopeLogs message { log_records=2 }
    const resourceMsg = lenDelim(1, kv('service.name', 'web')); // Resource message { attributes=1 }
    // ResourceLogs message { resource=1:Resource, scope_logs=2:ScopeLogs }
    const resourceLogsMsg = [...lenDelim(1, resourceMsg), ...lenDelim(2, scopeLogsMsg)];
    const logsData = lenDelim(1, resourceLogsMsg);            // LogsData { resource_logs=1 }

    const json = otlpLogsToJson(u(logsData));
    const events = getErrorAdapter('otlp').normalize(json);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'TypeError', message: 'x is undefined', source: 'otlp', tags: { service: 'web' } });
  });
});

describe('otlpTracesToJson → otlp adapter', () => {
  it('decodes an error-status span with an exception event', () => {
    // Status{ code=3:2 }
    const status = varintField(3, 2);
    // Span.Event{ name=2='exception', attributes=3:KeyValue }
    const exEvent = [...strField(2, 'exception'), ...lenDelim(3, kv('exception.type', 'DBError'))];
    // Span message { name=5, attributes=9, events=11, status=15 }
    const span = [
      ...strField(5, 'GET /x'),
      ...lenDelim(9, kv('exception.message', 'fail')),
      ...lenDelim(11, exEvent),
      ...lenDelim(15, status),
    ];
    const scopeSpansMsg = lenDelim(2, span);                  // ScopeSpans message { spans=2 }
    const resourceSpansMsg = lenDelim(2, scopeSpansMsg);      // ResourceSpans message { scope_spans=2 } (no resource)
    const tracesData = lenDelim(1, resourceSpansMsg);         // TracesData { resource_spans=1 }

    const json = otlpTracesToJson(u(tracesData));
    const events = getErrorAdapter('otlp').normalize(json);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'DBError', message: 'fail', source: 'otlp' });
  });
});
