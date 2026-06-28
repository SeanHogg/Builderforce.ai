/**
 * Error-source adapters — the structural (Adapter pattern) translation seam.
 *
 * We own the canonical spec (errorSpec.ts); each adapter knows how to translate
 * ONE source's payload into 0..N `NormalizedErrorEvent`s. Adding a source =
 * one adapter here + one row in qualitySourceCatalog.ts — nothing downstream
 * changes. Mirrors boardsync/providers.ts' `PROVIDER_REGISTRY`.
 *
 * `normalize()` is PURE (no IO) so it unit-tests trivially; `verify()` (optional)
 * authenticates a signed inbound webhook against the source's stored secret and
 * reuses the shared HMAC primitives (infrastructure/crypto/webhookHmac).
 */

import type { NormalizedErrorEvent, StackFrame } from './errorSpec';
import { normalizeLevel } from './errorSpec';
import { hmacSha256Hex, timingSafeEqualHex, verifyHmacHex } from '../../infrastructure/crypto/webhookHmac';

/** Reads an inbound request header by name (case-insensitive at the Hono layer). */
export type HeaderGetter = (name: string) => string | undefined | null;

export interface ErrorSourceAdapter {
  /** Stable id — must match a qualitySourceCatalog entry. */
  readonly id: string;
  /**
   * Verify a signed webhook body against the source's secret. Omitted for sources
   * that authenticate by ingest key (native/otlp) rather than a signed payload.
   */
  verify?(rawBody: string, getHeader: HeaderGetter, secret: string): Promise<boolean>;
  /** Translate a raw inbound payload into 0..N canonical events. Pure, tolerant. */
  normalize(payload: unknown): NormalizedErrorEvent[];
}

// ---------------------------------------------------------------------------
// Small tolerant readers (sources are untyped JSON over the wire)
// ---------------------------------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}
function num(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}
function nowIso(): string {
  // The spec carries the event time; when a source omits it we stamp ingest time.
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// native — our own canonical spec (browser SDK + server POST). Coerce + validate.
// ---------------------------------------------------------------------------

export const nativeAdapter: ErrorSourceAdapter = {
  id: 'native',
  normalize(payload: unknown): NormalizedErrorEvent[] {
    const items = Array.isArray(payload)
      ? payload
      : Array.isArray(asRecord(payload).events)
        ? (asRecord(payload).events as unknown[])
        : [payload];
    const out: NormalizedErrorEvent[] = [];
    for (const raw of items) {
      const e = asRecord(raw);
      const message = str(e.message) ?? str(e.value);
      const type = str(e.type) ?? str(e.name) ?? 'Error';
      if (!message && !type) continue;
      out.push({
        fingerprint: str(e.fingerprint),
        type: type || 'Error',
        message: message ?? type ?? 'Unknown error',
        stack: (Array.isArray(e.stack) ? (e.stack as StackFrame[]) : str(e.stack)) ?? null,
        level: normalizeLevel(e.level),
        timestamp: str(e.timestamp) ?? nowIso(),
        release: str(e.release) ?? null,
        environment: str(e.environment) ?? null,
        url: str(e.url) ?? null,
        userKey: str(e.userKey) ?? null,
        tags: (e.tags && typeof e.tags === 'object' ? (e.tags as Record<string, string>) : undefined),
        context: (e.context && typeof e.context === 'object' ? (e.context as Record<string, unknown>) : undefined),
        source: 'native',
      });
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// otlp — OpenTelemetry Protocol over HTTP/JSON (logs + error-status spans).
// ---------------------------------------------------------------------------

/** OTLP KeyValue attribute list → flat string map (anyValue.stringValue/intValue/…). */
function otlpAttrs(attrs: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(attrs)) return out;
  for (const kv of attrs) {
    const r = asRecord(kv);
    const key = str(r.key);
    if (!key) continue;
    const val = asRecord(r.value);
    const v = str(val.stringValue) ?? str(val.intValue) ?? str(val.doubleValue) ?? str(val.boolValue);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

function otlpBuildEvent(attrs: Record<string, string>, message: string, level: string, ts: string | undefined): NormalizedErrorEvent {
  return {
    type: attrs['exception.type'] ?? attrs['error.type'] ?? 'Error',
    message: attrs['exception.message'] ?? message ?? 'Error',
    stack: attrs['exception.stacktrace'] ?? null,
    level: normalizeLevel(level),
    timestamp: ts ?? nowIso(),
    release: attrs['service.version'] ?? null,
    environment: attrs['deployment.environment'] ?? null,
    url: attrs['url.full'] ?? attrs['http.url'] ?? null,
    userKey: attrs['user.id'] ?? attrs['enduser.id'] ?? null,
    tags: { ...(attrs['service.name'] ? { service: attrs['service.name'] } : {}) },
    source: 'otlp',
  };
}

/** Nanoseconds-since-epoch (OTLP timeUnixNano) → ISO, when present. */
function otlpTime(nano: unknown): string | undefined {
  const n = num(nano);
  if (n === undefined || n <= 0) return undefined;
  return new Date(Math.floor(n / 1e6)).toISOString();
}

export const otlpAdapter: ErrorSourceAdapter = {
  id: 'otlp',
  normalize(payload: unknown): NormalizedErrorEvent[] {
    const root = asRecord(payload);
    const out: NormalizedErrorEvent[] = [];

    // OTLP/Logs — keep records at SeverityNumber >= 17 (ERROR) or carrying exception.*
    for (const rl of (root.resourceLogs as unknown[]) ?? []) {
      const resAttrs = otlpAttrs(asRecord(asRecord(rl).resource).attributes);
      for (const sl of (asRecord(rl).scopeLogs as unknown[]) ?? []) {
        for (const lr of (asRecord(sl).logRecords as unknown[]) ?? []) {
          const r = asRecord(lr);
          const attrs = { ...resAttrs, ...otlpAttrs(r.attributes) };
          const sevNum = num(r.severityNumber) ?? 0;
          const sevText = str(r.severityText) ?? '';
          const isError = sevNum >= 17 || /error|fatal|crit/i.test(sevText) || 'exception.type' in attrs;
          if (!isError) continue;
          const body = str(asRecord(r.body).stringValue) ?? str(r.body) ?? '';
          out.push(otlpBuildEvent(attrs, body, sevText || 'error', otlpTime(r.timeUnixNano)));
        }
      }
    }

    // OTLP/Traces — keep spans with status.code === 2 (ERROR); prefer an exception event.
    for (const rs of (root.resourceSpans as unknown[]) ?? []) {
      const resAttrs = otlpAttrs(asRecord(asRecord(rs).resource).attributes);
      for (const ss of (asRecord(rs).scopeSpans as unknown[]) ?? []) {
        for (const span of (asRecord(ss).spans as unknown[]) ?? []) {
          const sp = asRecord(span);
          const statusCode = num(asRecord(sp.status).code) ?? 0;
          if (statusCode !== 2) continue;
          const spanAttrs = { ...resAttrs, ...otlpAttrs(sp.attributes) };
          // An exception is recorded as a span event named "exception".
          const exEvent = ((sp.events as unknown[]) ?? []).map(asRecord).find((ev) => str(ev.name) === 'exception');
          const exAttrs = exEvent ? { ...spanAttrs, ...otlpAttrs(exEvent.attributes) } : spanAttrs;
          const message = exAttrs['exception.message'] ?? str(asRecord(sp.status).message) ?? str(sp.name) ?? 'Span error';
          out.push(otlpBuildEvent(exAttrs, message, 'error', otlpTime(exEvent ? exEvent.timeUnixNano : sp.endTimeUnixNano)));
        }
      }
    }

    return out;
  },
};

// ---------------------------------------------------------------------------
// sentry — Sentry webhook (issue alert / event alert / error). HMAC-signed.
// ---------------------------------------------------------------------------

export const sentryAdapter: ErrorSourceAdapter = {
  id: 'sentry',
  async verify(rawBody, getHeader, secret) {
    const sig = (getHeader('Sentry-Hook-Signature') ?? '').trim();
    return sig.length > 0 && timingSafeEqualHex(await hmacSha256Hex(secret, rawBody), sig);
  },
  normalize(payload: unknown): NormalizedErrorEvent[] {
    const root = asRecord(payload);
    const data = asRecord(root.data);
    const event = asRecord(data.event ?? data.error ?? root.event);
    const issue = asRecord(data.issue ?? root.issue);

    // Prefer the full event (carries exception + stack); fall back to the issue.
    if (Object.keys(event).length > 0) {
      const exceptionValues = ((asRecord(event.exception).values as unknown[]) ?? []).map(asRecord);
      const ex = exceptionValues[exceptionValues.length - 1] ?? {};
      const frames = ((asRecord(ex.stacktrace).frames as unknown[]) ?? []).map((f): StackFrame => {
        const fr = asRecord(f);
        return { function: str(fr.function) ?? null, file: str(fr.filename) ?? null, line: num(fr.lineno) ?? null, column: num(fr.colno) ?? null };
      }).reverse();
      const tags = Array.isArray(event.tags)
        ? Object.fromEntries((event.tags as unknown[]).map((t) => (Array.isArray(t) ? [String(t[0]), String(t[1])] : [])).filter((p) => p.length === 2))
        : (asRecord(event.tags) as Record<string, string>);
      return [{
        fingerprint: str(event.issue_id) ?? str(issue.id),
        type: str(ex.type) ?? str(event.type) ?? 'Error',
        message: str(ex.value) ?? str(event.message) ?? str(event.title) ?? str(issue.title) ?? 'Error',
        stack: frames.length ? frames : null,
        level: normalizeLevel(event.level ?? issue.level),
        timestamp: str(event.datetime) ?? str(event.timestamp) ?? nowIso(),
        release: str(event.release) ?? null,
        environment: str(event.environment) ?? null,
        url: str(event.culprit) ?? str(issue.permalink) ?? null,
        userKey: str(asRecord(event.user).id) ?? null,
        tags: tags ?? undefined,
        source: 'sentry',
      }];
    }

    if (!issue.id) return [];
    return [{
      fingerprint: str(issue.id),
      type: str(issue.type) ?? 'Error',
      message: str(issue.title) ?? 'Error',
      stack: str(issue.culprit) ?? null,
      level: normalizeLevel(issue.level),
      timestamp: str(issue.lastSeen) ?? nowIso(),
      release: null,
      environment: null,
      url: str(issue.permalink) ?? null,
      source: 'sentry',
    }];
  },
};

// ---------------------------------------------------------------------------
// posthog — PostHog $exception event webhook. Optional HMAC (sha256=<hex>).
// ---------------------------------------------------------------------------

export const posthogAdapter: ErrorSourceAdapter = {
  id: 'posthog',
  async verify(rawBody, getHeader, secret) {
    const sig = (getHeader('X-PostHog-Signature') ?? getHeader('X-Signature') ?? '').trim();
    if (!sig) return false;
    return sig.startsWith('sha256=')
      ? verifyHmacHex(rawBody, sig, secret, 'sha256=')
      : verifyHmacHex(rawBody, sig, secret);
  },
  normalize(payload: unknown): NormalizedErrorEvent[] {
    const root = asRecord(payload);
    // PostHog webhook may wrap the event under `event` or send the event directly.
    const ev = asRecord(root.event ?? root);
    const props = asRecord(ev.properties ?? root.properties);
    const name = str(ev.event) ?? str(root.event_name);
    if (name && name !== '$exception') return [];

    // New error-tracking shape: $exception_list[].{type,value,stacktrace.frames}
    const list = (props.$exception_list as unknown[]) ?? [];
    const first = asRecord(list[0]);
    const frames = ((asRecord(first.stacktrace).frames as unknown[]) ?? []).map((f): StackFrame => {
      const fr = asRecord(f);
      return { function: str(fr.function) ?? null, file: str(fr.source ?? fr.filename) ?? null, line: num(fr.line ?? fr.lineno) ?? null, column: num(fr.column ?? fr.colno) ?? null };
    });

    const type = str(first.type) ?? str(props.$exception_type) ?? 'Error';
    const message = str(first.value) ?? str(props.$exception_message) ?? str(props.$exception_value) ?? 'Error';
    return [{
      fingerprint: str(props.$exception_fingerprint),
      type,
      message,
      stack: frames.length ? frames : (str(props.$exception_stack_trace_raw) ?? null),
      level: normalizeLevel(props.$level ?? 'error'),
      timestamp: str(ev.timestamp) ?? str(props.timestamp) ?? nowIso(),
      release: str(props.$app_version) ?? null,
      environment: str(props.environment) ?? null,
      url: str(props.$current_url) ?? null,
      userKey: str(ev.distinct_id) ?? str(props.distinct_id) ?? null,
      source: 'posthog',
    }];
  },
};

// ---------------------------------------------------------------------------
// logrocket — LogRocket error webhook. Optional HMAC (sha256=<hex>).
// ---------------------------------------------------------------------------

export const logrocketAdapter: ErrorSourceAdapter = {
  id: 'logrocket',
  async verify(rawBody, getHeader, secret) {
    const sig = (getHeader('X-LogRocket-Signature') ?? getHeader('X-Signature') ?? '').trim();
    if (!sig) return false;
    return sig.startsWith('sha256=')
      ? verifyHmacHex(rawBody, sig, secret, 'sha256=')
      : verifyHmacHex(rawBody, sig, secret);
  },
  normalize(payload: unknown): NormalizedErrorEvent[] {
    const root = asRecord(payload);
    // LogRocket alert webhook nests the issue under `issue`/`data`; tolerate flat too.
    const issue = asRecord(root.issue ?? root.data ?? root);
    const type = str(issue.errorType) ?? str(issue.type) ?? 'Error';
    const message = str(issue.message) ?? str(issue.title) ?? str(issue.name);
    if (!message && !issue.errorType) return [];
    return [{
      fingerprint: str(issue.id) ?? str(issue.issueId) ?? str(issue.fingerprint),
      type,
      message: message ?? type,
      stack: str(issue.stackTrace ?? issue.stack) ?? null,
      level: normalizeLevel(issue.severity ?? 'error'),
      timestamp: str(issue.timestamp ?? issue.createdAt ?? issue.lastSeen) ?? nowIso(),
      release: str(issue.release ?? issue.appVersion) ?? null,
      environment: str(issue.environment) ?? null,
      url: str(issue.url ?? issue.pageUrl ?? issue.sessionURL) ?? null,
      userKey: str(issue.userId ?? issue.userID) ?? null,
      source: 'logrocket',
    }];
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const ERROR_ADAPTERS: Record<string, ErrorSourceAdapter> = {
  native:    nativeAdapter,
  otlp:      otlpAdapter,
  sentry:    sentryAdapter,
  posthog:   posthogAdapter,
  logrocket: logrocketAdapter,
};

/** Look up an adapter by source id; throws for an unknown source. */
export function getErrorAdapter(id: string): ErrorSourceAdapter {
  const a = ERROR_ADAPTERS[id];
  if (!a) throw new Error(`Unsupported error source: ${id}`);
  return a;
}
