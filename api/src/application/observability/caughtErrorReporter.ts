import { currentRequestScope, deferPastResponse, type RequestScope } from '../shared/requestScope';

export interface CaughtErrorDetails {
  source: string;
  operation: string;
  context?: Record<string, unknown>;
  level?: 'error' | 'warning';
}


export interface CaughtErrorRecord extends Required<Pick<CaughtErrorDetails, 'source' | 'operation'>> {
  error: unknown;
  message: string;
  stack: string | null;
  context: Record<string, unknown>;
  level: 'error' | 'warning';
  handled: boolean;
}

export type CaughtErrorSink = (
  record: CaughtErrorRecord,
  runtime: RequestScope,
) => Promise<void>;

let configuredSink: CaughtErrorSink | null = null;
const SENSITIVE_CONTEXT_KEY = /(authorization|cookie|credential|password|secret|token|api[-_]?key)/i;
const MAX_CONTEXT_DEPTH = 5;
const MAX_CONTEXT_ENTRIES = 50;
const MAX_CONTEXT_STRING = 4_000;

function normalizeError(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack ?? null };
  }
  return { message: String(error), stack: null };
}

function sanitizeContextValue(
  value: unknown,
  key: string,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (SENSITIVE_CONTEXT_KEY.test(key)) return '[REDACTED]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.length <= MAX_CONTEXT_STRING
      ? value
      : `${value.slice(0, MAX_CONTEXT_STRING)}…[truncated]`;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return String(value);
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack ?? null };
  }
  if (depth >= MAX_CONTEXT_DEPTH) return '[MAX_DEPTH]';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_CONTEXT_ENTRIES)
      .map((entry) => sanitizeContextValue(entry, key, depth + 1, seen));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value).slice(0, MAX_CONTEXT_ENTRIES)) {
    sanitized[entryKey] = sanitizeContextValue(entryValue, entryKey, depth + 1, seen);
  }
  return sanitized;
}

function sanitizeContext(context: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!context) return {};
  return sanitizeContextValue(context, 'context', 0, new WeakSet()) as Record<string, unknown>;
}

function recordFor(
  error: unknown,
  details: CaughtErrorDetails,
  handled: boolean,
): CaughtErrorRecord {
  const normalized = normalizeError(error);
  // An error that wraps another (`new InternalError('Failed to save', { cause })`) keeps
  // the wrapped one in the record — the authored message is for the caller, the cause
  // is the diagnosis.
  const cause = error instanceof Error && error.cause !== undefined ? error.cause : undefined;
  return {
    error,
    message: normalized.message,
    stack: normalized.stack,
    source: details.source,
    operation: details.operation,
    context: sanitizeContext(cause === undefined ? details.context : { ...details.context, cause }),
    level: details.level ?? 'error',
    handled,
  };
}

async function deliver(
  record: CaughtErrorRecord,
  runtime: RequestScope | undefined,
): Promise<void> {
  if (!configuredSink || !runtime) return;
  try {
    await configuredSink(record, runtime);
  } catch (reportingError) {
    // This is deliberately the terminal fallback. Calling the reporter again here
    // would recurse forever when its database or Product Quality sink is down.
    console.error('[caught-error:reporting-failed]', {
      source: record.source,
      operation: record.operation,
      reportingError,
    });
  }
}

/** Configure the infrastructure sink once from the composition root. */
export function configureCaughtErrorReporter(sink: CaughtErrorSink): void {
  configuredSink = sink;
}

/**
 * Report an exception that the caller intentionally handled.
 *
 * Logging happens synchronously. Durable delivery is attached to the current
 * Worker request/event through waitUntil when available, so best-effort control
 * flow stays non-blocking without losing the report after the response returns.
 */
export function reportCaughtError(
  error: unknown,
  details: CaughtErrorDetails,
  runtimeOverride?: RequestScope,
): void {
  const record = recordFor(error, details, true);
  console.error('[caught-error]', {
    source: record.source,
    operation: record.operation,
    message: record.message,
    context: record.context,
    error,
  });

  const runtime = runtimeOverride ?? currentRequestScope();
  const delivery = deliver(record, runtime);
  if (!deferPastResponse(delivery, runtime)) void delivery;
}

/** Use the same durable sinks for an exception that will become an HTTP 500. */
export async function reportUnhandledError(
  error: unknown,
  details: CaughtErrorDetails,
  runtime: RequestScope,
): Promise<void> {
  const record = recordFor(error, details, false);
  console.error('[unhandled-error]', {
    source: record.source,
    operation: record.operation,
    message: record.message,
    context: record.context,
    error,
  });
  await deliver(record, runtime);
}

/** Test-only reset that prevents sink state leaking between isolated test cases. */
export function resetCaughtErrorReporterForTests(): void {
  configuredSink = null;
}
