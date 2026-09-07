/**
 * The worker's durable error sink.
 *
 * Every failure this worker catches used to end at `console.error`. A Workers log
 * line is a tail you have to be watching: it is not queryable, it is not in the
 * platform's error stream, and it is not what `/admin` reads when someone asks
 * why a request failed at 3am. So a caught error here was, in practice, gone —
 * which is the whole point of `scripts/check-silent-catches.mjs`.
 *
 * The api already has one stream for this: `api_error_log`, written by
 * `persistCaughtError` and read by `errorLogQuery` and the admin error panel.
 * This worker has the same Neon database bound (`NEON_DATABASE_URL`, used by the
 * data routes), so it writes the SAME table with the same columns rather than
 * inventing a second place to look. `source` distinguishes the writer.
 *
 * It is deliberately tiny and dependency-free: one insert, no schema import, no
 * ORM. The worker is not the api and must not grow a copy of its infrastructure
 * to record a 503.
 *
 * REPORTING NEVER FAILS A REQUEST. The insert is wrapped and its own failure
 * degrades to a console line — this module IS the durable sink, so its terminal
 * fallback has nowhere left to report to. That is the same contract the api's
 * `caughtErrorReporter` has, and it carries the same silent-catch exemption.
 */
import { neon } from '@neondatabase/serverless';

/** The one binding this needs. Optional so a route Env that lacks it still compiles. */
export interface WorkerErrorReportEnv {
  NEON_DATABASE_URL?: string;
}

export interface WorkerErrorDetails {
  /** The module that caught it — `worker:auth`, `worker:datasets`. */
  source: string;
  /** What it was doing — `session-introspection`, `list-datasets`. */
  operation: string;
  /** The caught value, whatever it is. */
  error: unknown;
  /** Anything that makes the row diagnosable. Keep credentials out. */
  context?: Record<string, unknown>;
}

const MAX_SOURCE = 500;
const MAX_OPERATION = 255;

function describe(error: unknown): { message: string; stack: string | null } {
  return error instanceof Error
    ? { message: error.message, stack: error.stack ?? null }
    : { message: String(error), stack: null };
}

/**
 * Record a caught error where it can be read back. Resolves even when it could
 * not be written, so a call site can `await` it on an error path without turning
 * one failure into two.
 */
export async function reportWorkerError(
  env: WorkerErrorReportEnv,
  details: WorkerErrorDetails,
): Promise<void> {
  const { message, stack } = describe(details.error);
  const url = env.NEON_DATABASE_URL?.trim();
  if (!url) {
    console.error(`[${details.source}] ${details.operation}: ${message}`, details.context ?? {});
    return;
  }
  try {
    const sql = neon(url);
    await sql`
      INSERT INTO api_error_log (method, path, source, operation, handled, context, message, stack)
      VALUES (
        'CAUGHT',
        ${`${details.source}#${details.operation}`.slice(0, 500)},
        ${details.source.slice(0, MAX_SOURCE)},
        ${details.operation.slice(0, MAX_OPERATION)},
        true,
        ${JSON.stringify(details.context ?? {})}::jsonb,
        ${message},
        ${stack}
      )
    `;
  } catch (sinkFailure) {
    // Terminal fallback: the sink itself is what failed, so there is nowhere left
    // to report to. See this module's header, and the guard's EXEMPTIONS entry.
    console.error('[worker:error-sink] could not persist a caught error', {
      source: details.source,
      operation: details.operation,
      message,
      sinkFailure: sinkFailure instanceof Error ? sinkFailure.message : String(sinkFailure),
    });
  }
}
