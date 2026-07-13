/** Canonical error-event spec — mirrors the Builderforce Quality `native` adapter. */

export type ErrorLevel = 'fatal' | 'error' | 'warning' | 'info';

export interface StackFrame {
  function?: string | null;
  file?: string | null;
  line?: number | null;
  column?: number | null;
}

/** The wire shape posted to `${endpoint}/events`. */
export interface NormalizedErrorEvent {
  type: string;
  message: string;
  stack?: StackFrame[] | string | null;
  level: ErrorLevel;
  timestamp: string;
  release?: string | null;
  environment?: string | null;
  url?: string | null;
  userKey?: string | null;
  tags?: Record<string, string>;
  context?: Record<string, unknown>;
  source: 'native';
}

/** Per-capture overrides. */
export interface CaptureContext {
  level?: ErrorLevel;
  userKey?: string;
  url?: string;
  tags?: Record<string, string>;
  context?: Record<string, unknown>;
}

export interface QualityClientOptions {
  /** The per-source ingest key (bfq_…). */
  key: string;
  /** Ingest base, e.g. https://api.builderforce.ai/api/quality-ingest (no trailing /events). */
  endpoint: string;
  /** Release/version stamped on every event. */
  release?: string;
  /** Environment (production/staging/…) stamped on every event. */
  environment?: string;
  /** Default user key for affected-user counts (anonymized — never PII). */
  userKey?: string;
  /** Flush when this many events are buffered (default 20). */
  maxBatch?: number;
  /** Auto-flush interval in ms (default 5000). */
  flushIntervalMs?: number;
  /** Hook window error + unhandledrejection automatically (browser only, default true). */
  autoCapture?: boolean;
  /** Injected fetch (tests / Node < 18). Defaults to global fetch. */
  fetchFn?: typeof fetch;
}
