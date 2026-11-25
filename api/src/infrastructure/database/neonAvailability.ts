import { ServiceUnavailableError } from '../../domain/shared/errors';

/**
 * Neon refusing to run ANY query is an outage, not a bug — answer it as one.
 *
 * When the project exhausts its plan's compute quota, Neon's SQL-over-HTTP
 * endpoint answers `402` and the driver throws a plain `NeonDbError` whose only
 * trace of that is its message ("Server error (HTTP status 402): …"). With no
 * `status` on it, `statusOf` saw an unknown error, so every DB-backed route
 * answered `500 Something went wrong` and every open page filed a support ticket
 * for what was one account-level outage (2026-09-14). Translated here, at the one
 * place the client is built, it becomes a {@link ServiceUnavailableError} — a 503
 * carrying {@link DATABASE_UNAVAILABLE_CODE}, which the web app renders as
 * "temporarily unavailable" and does not auto-report.
 *
 * The HTTP driver throws `Server error (HTTP status ${status}): ${body}` for every
 * non-400 refusal and the bare body for a 400. `402` is matched on its own (observed);
 * any other 3-digit status matches only when its body is Neon's compute-time / data-transfer
 * quota text, because the status of the data-transfer refusal is unverified.
 *
 * Both paths are covered. The HTTP client is wrapped by {@link withDatabaseAvailability};
 * `inTransaction` opens a WebSocket pool that bypasses that wrapper and maps its own
 * errors here. Over WebSocket there is no HTTP status to carry, so the WebSocket
 * patterns match the quota texts ("Your account or project has exceeded the compute
 * time / data transfer quota") taken from Neon's published error messages. That text
 * has NOT been observed on this path: it has never been captured from a live
 * WebSocket quota refusal, and the exact wording and shape (a Postgres error whose
 * message is the bare body) are an assumption until one is. Every pattern is anchored
 * at the start of the message, because `inTransaction` passes every error out of the
 * transaction BODY through this check — another vendor saying "exceeded your quota"
 * must never read as a database outage.
 */
export const DATABASE_UNAVAILABLE_CODE = 'database_unavailable';

const NEON_UNAVAILABLE = new RegExp(
  '^(?:Server error \\(HTTP status 402\\)'
  // The driver prefixes every non-400 refusal with its status; the data-transfer quota's
  // status has not been observed, so any 3-digit status is accepted when the BODY is Neon's
  // quota text, which must LEAD the body (optionally as the JSON `message` value) — a 5xx whose body
  // merely echoes the phrase further in is an unrelated failure, not an outage.
  + '|Server error \\(HTTP status \\d{3}\\): (?:\\{\\s*"message"\\s*:\\s*")?Your (?:account or )?project has exceeded the (?:compute time|data transfer) quota'
  + '|Your (?:account or )?project has exceeded the (?:compute time|data transfer) quota)',
);

/** How deep a `cause` chain is followed. drizzle wraps once (`DrizzleQueryError`); a
 *  service may wrap again — five is generous and keeps a cyclic chain finite. */
const MAX_CAUSE_DEPTH = 5;

/** The error and its `cause` chain, outermost first, bounded by {@link MAX_CAUSE_DEPTH}. */
function* causeChain(error: unknown): Generator<unknown> {
  let current = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current != null; depth++) {
    yield current;
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : undefined;
  }
}

function isOutageError(error: unknown): error is ServiceUnavailableError {
  return error instanceof ServiceUnavailableError && error.code === DATABASE_UNAVAILABLE_CODE;
}

/**
 * The outage error inside `error`, or undefined. drizzle's `PgPreparedQuery` rethrows a
 * driver failure as `DrizzleQueryError(query, params, cause)`, so the
 * {@link ServiceUnavailableError} {@link withDatabaseAvailability} raised reaches the
 * app as a `.cause` — never as the thrown error itself. This is the ONE unwrap: the 503
 * mapping, the cache fallback and every reporter skip go through it.
 */
export function databaseUnavailableCause(error: unknown): ServiceUnavailableError | undefined {
  for (const link of causeChain(error)) if (isOutageError(link)) return link;
  return undefined;
}

/** True when `error` IS, or is a wrapper (drizzle's `DrizzleQueryError`) around, the outage
 *  error {@link asDatabaseUnavailable} produces. The ONE predicate for "the core database
 *  refused to run queries" — cache fallbacks and callers use it. */
export function isDatabaseUnavailable(error: unknown): boolean {
  return databaseUnavailableCause(error) !== undefined;
}

/** The outage error for a Neon quota refusal (the error itself or anything in its `cause`
 *  chain); any other error is returned untouched. */
export function asDatabaseUnavailable(error: unknown): unknown {
  const existing = databaseUnavailableCause(error);
  if (existing) return existing;
  for (const link of causeChain(error)) {
    if (link instanceof Error && NEON_UNAVAILABLE.test(link.message)) {
      return new ServiceUnavailableError('The database is temporarily unavailable', {
        code: DATABASE_UNAVAILABLE_CODE,
        cause: link,
      });
    }
  }
  return error;
}

type Settle = (value: unknown) => unknown;
interface QueryThenable {
  then: (onFulfilled?: Settle, onRejected?: Settle) => unknown;
  catch?: (onRejected: Settle) => unknown;
  finally?: (onFinally?: () => void) => unknown;
}

/**
 * Map a query's rejection IN PLACE. The driver's query objects are lazy
 * thenables carrying `parameterizedQuery`/`opts` that `transaction()` reads back
 * (drizzle's batch path hands them over unawaited), so wrapping one in a new
 * Promise would break batches — the object keeps its identity and only its
 * settle methods change.
 */
function guardQuery<Q>(query: Q): Q {
  const q = query as unknown as QueryThenable | null;
  if (!q || typeof q.then !== 'function') return query;
  const then = q.then;
  q.then = (onFulfilled, onRejected) => then.call(q, onFulfilled, (error: unknown) => {
    const mapped = asDatabaseUnavailable(error);
    if (onRejected) return onRejected(mapped);
    throw mapped;
  });
  q.catch = (onRejected) => q.then(undefined, onRejected);
  q.finally = (onFinally) => q.then(
    (value) => { onFinally?.(); return value; },
    (error) => { onFinally?.(); throw error; },
  );
  return query;
}

/**
 * The Neon HTTP client with quota refusals answered as outages. A Proxy, so
 * drizzle still receives a callable carrying every property the driver exposes;
 * only the three entry points that run SQL — the call itself, `query()` and
 * `transaction()` — have their rejections translated.
 */
export function withDatabaseAvailability<C extends (...args: never[]) => unknown>(client: C): C {
  return new Proxy(client, {
    apply: (target, thisArg, args) => guardQuery(Reflect.apply(target, thisArg, args)),
    get: (target, prop, receiver) => {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      if (prop === 'query') {
        return (...args: unknown[]) => guardQuery(Reflect.apply(value, target, args));
      }
      if (prop === 'transaction') {
        return async (...args: unknown[]) => {
          try {
            return await Reflect.apply(value, target, args);
          } catch (error) {
            throw asDatabaseUnavailable(error);
          }
        };
      }
      return value;
    },
  });
}
