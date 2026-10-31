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
  + '|Your (?:account or )?project has exceeded the (?:compute time|data transfer) quota)',
);

/** The outage error for a Neon quota refusal; any other error is returned untouched. */
export function asDatabaseUnavailable(error: unknown): unknown {
  if (!(error instanceof Error) || !NEON_UNAVAILABLE.test(error.message)) return error;
  return new ServiceUnavailableError('The database is temporarily unavailable', {
    code: DATABASE_UNAVAILABLE_CODE,
    cause: error,
  });
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
