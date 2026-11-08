import { currentRequestScope, deferPastResponse, type RequestScope } from '../shared/requestScope';
import { redactDeep, redactSecrets } from '../../infrastructure/security/redactSecrets';

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
const CONTEXT_LIMITS = { maxDepth: 5, maxEntries: 50, maxString: 4_000 };

function normalizeError(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack ?? null };
  }
  return { message: String(error), stack: null };
}

/** The context, redacted (secret-named keys and secret-shaped values) and bounded: ONE walk, ONE key rule (`redactDeep`). */
function sanitizeContext(context: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!context) return {};
  return redactDeep(context, CONTEXT_LIMITS);
}

/**
 * The error as it may leave this module: a clone with the same name and own properties (`code`, `status`) whose
 * message, stack and cause are redacted. The raw error never reaches a log line or an exception sink.
 */
function redactedError(error: unknown): unknown {
  if (!(error instanceof Error)) return redactDeep(error, CONTEXT_LIMITS);
  const clone = new Error(redactSecrets(error.message), error.cause !== undefined ? { cause: redactDeep(error.cause, CONTEXT_LIMITS) } : undefined);
  Object.assign(clone, redactDeep({ ...error }, CONTEXT_LIMITS));
  clone.name = error.name;
  clone.stack = error.stack ? redactSecrets(error.stack) : undefined;
  return clone;
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
    error: redactedError(error),
    message: redactSecrets(normalized.message),
    stack: normalized.stack ? redactSecrets(normalized.stack) : null,
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
    error: record.error,
  });

  const runtime = runtimeOverride ?? currentRequestScope();
  const delivery = deliver(record, runtime);
  if (!deferPastResponse(delivery, runtime)) void delivery;
}

/**
 * A `.catch` handler for a BEST-EFFORT step: the failure is reported through the durable
 * sink at warning level, and the step's stated fallback stands in for its result. The
 * alternative to `.catch(() => null)`, which drops the failure without a trace.
 */
export function reportedFallback<T>(fallback: T, details: Omit<CaughtErrorDetails, 'level'>): (error: unknown) => T {
  return (error) => {
    reportCaughtError(error, { ...details, level: 'warning' });
    return fallback;
  };
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
    error: record.error,
  });
  await deliver(record, runtime);
}

/** Test-only reset that prevents sink state leaking between isolated test cases. */
export function resetCaughtErrorReporterForTests(): void {
  configuredSink = null;
}
