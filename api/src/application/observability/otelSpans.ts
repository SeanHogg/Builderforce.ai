/**
 * OTLP/HTTP span construction — the pure half of OpenTelemetry export.
 *
 * JSON rather than protobuf on purpose: the Worker has no protobuf dependency, the
 * OTLP/HTTP JSON encoding is a first-class part of the spec, and every collector
 * worth exporting to accepts it. Keeping this file free of fetch and of `Env` means
 * the wire shape is unit-testable without a collector.
 *
 * A run becomes ONE span per recorded event rather than a true parent/child trace:
 * the platform's events are already flat rows with their own timestamps, and
 * inventing a hierarchy the data does not have would produce a picture that looks
 * precise and is wrong. The execution id is the trace id, so a collector still
 * groups every span of a run together.
 */

/** Attribute values OTLP/JSON accepts without further encoding. */
export type SpanAttributeValue = string | number | boolean;

export interface AgentSpan {
  /** Groups every span of one run. Derived from the execution id. */
  executionId: number;
  name: string;
  startTimeMs: number;
  endTimeMs?: number;
  /** False marks the span as an error to the collector. */
  ok?: boolean;
  attributes?: Record<string, SpanAttributeValue | null | undefined>;
}

export interface OtelResource {
  serviceName: string;
  /** Workspace id, so one collector can serve several tenants distinguishably. */
  tenantId: number;
}

const NS_PER_MS = 1_000_000;

/** OTLP ids are hex: 32 chars for a trace, 16 for a span. Deterministic per run. */
export function traceIdFor(executionId: number): string {
  return `bf${executionId}`.padStart(32, '0').slice(-32);
}

/** A span id unique within its trace: the run plus the span's ordinal. */
export function spanIdFor(executionId: number, index: number): string {
  return `${executionId.toString(16)}${index.toString(16).padStart(4, '0')}`.padStart(16, '0').slice(-16);
}

function attributes(values: Record<string, SpanAttributeValue | null | undefined> | undefined) {
  return Object.entries(values ?? {})
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([key, value]) => ({
      key,
      value:
        typeof value === 'number'
          ? Number.isInteger(value)
            ? { intValue: String(value) }
            : { doubleValue: value }
          : typeof value === 'boolean'
            ? { boolValue: value }
            : { stringValue: String(value) },
    }));
}

/**
 * Build one OTLP/HTTP `ExportTraceServiceRequest` body. Spans are grouped under a
 * single resource because they all come from this platform on behalf of one tenant.
 */
export function buildOtlpTracePayload(resource: OtelResource, spans: readonly AgentSpan[]): Record<string, unknown> {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: attributes({
            'service.name': resource.serviceName,
            'service.namespace': 'builderforce',
            'builderforce.tenant_id': resource.tenantId,
          }),
        },
        scopeSpans: [
          {
            scope: { name: 'builderforce.agent-runtime' },
            spans: spans.map((span, index) => ({
              traceId: traceIdFor(span.executionId),
              spanId: spanIdFor(span.executionId, index),
              name: span.name,
              kind: 1, // SPAN_KIND_INTERNAL — the work happened inside this platform.
              startTimeUnixNano: String(Math.round(span.startTimeMs * NS_PER_MS)),
              endTimeUnixNano: String(Math.round((span.endTimeMs ?? span.startTimeMs) * NS_PER_MS)),
              attributes: attributes(span.attributes),
              // 0 UNSET · 1 OK · 2 ERROR. Unset when the caller did not judge it, so a
              // collector's error rate counts real failures rather than silence.
              status: span.ok === undefined ? { code: 0 } : { code: span.ok ? 1 : 2 },
            })),
          },
        ],
      },
    ],
  };
}

/** The traces endpoint for a collector base URL, tolerating a trailing slash. */
export function tracesUrl(endpoint: string): string {
  const base = endpoint.trim().replace(/\/+$/, '');
  // A base that already names a signal path is used as given — some collectors are
  // configured per-signal, and appending a second `/v1/traces` would 404.
  return /\/v1\/(traces|metrics|logs)$/.test(base) ? base : `${base}/v1/traces`;
}

/**
 * Whether this run is in the exporter's sample. Deterministic on the execution id,
 * so a run is either wholly exported or wholly absent — a per-span coin flip would
 * produce traces missing their middle, which is worse than not exporting them.
 */
export function runIsSampled(executionId: number, sampleRate: number): boolean {
  if (!Number.isFinite(sampleRate) || sampleRate >= 1) return true;
  if (sampleRate <= 0) return false;
  // A cheap deterministic hash; the ids are dense integers, so the low bits alone
  // would bias the selection.
  const hashed = Math.abs(Math.imul(executionId ^ 0x9e3779b9, 2654435761)) % 1000;
  return hashed < Math.round(sampleRate * 1000);
}
