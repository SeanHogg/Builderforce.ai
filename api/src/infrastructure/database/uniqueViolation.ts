/**
 * "Did that insert lose a uniqueness race?" — asked once, for the whole codebase.
 *
 * This predicate had six independent definitions (TaskService's key race, the
 * quality and feedback collector routes, interview kits, Stage sandbox runs, and
 * custom domains), and they did not agree: some matched only `error.code`, some
 * only the message, some only one spelling of it. That disagreement is the failure
 * this module prevents — a driver that reports the conflict in the OTHER place
 * turns "this project already has a collector" (409) into an unhandled 500 on one
 * path while the identical race is still handled cleanly on another.
 *
 * Postgres reports a unique conflict as SQLSTATE 23505, but the drivers in play
 * (neon-http, node-postgres) surface it inconsistently: sometimes as a `code`
 * property, sometimes only inside the message text. Both are checked, and neither
 * alone is trusted.
 *
 * `constraint` narrows the answer to ONE index. Pass it whenever the caller is
 * about to translate the error into a specific sentence for a user: a different
 * unique violation raised by the same statement must never be reported as "that
 * domain is taken". Omit it when any conflict on the statement means the same
 * thing (a key-allocation retry does not care which index complained).
 */

const MAX_CAUSE_DEPTH = 5;

/**
 * The driver error behind a database failure: the first error in the `.cause` chain (up to 5
 * levels, the error itself first) that carries a SQLSTATE `code`, or undefined.
 *
 * drizzle-orm 0.45 wraps every driver error in a `DrizzleQueryError` whose message is only
 * "Failed query: …" and whose driver error (code, constraint, detail) is on `.cause`; a predicate
 * that reads the top level misses a real 40P01 or 23505. ONE walker, used by every SQLSTATE check.
 */
export function pgErrorOf(error: unknown): { code: string; message?: string; constraint?: string } | undefined {
  let current: unknown = error;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH && current !== null && typeof current === 'object'; depth += 1) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === 'string' && code !== '') return current as { code: string; message?: string; constraint?: string };
    current = cause;
  }
  return undefined;
}

/** The messages of the error and its cause chain, joined: the detail may sit at any level. */
export function chainText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH && current !== null && current !== undefined; depth += 1) {
    if (typeof current === 'object') {
      const { message, cause } = current as { message?: unknown; cause?: unknown };
      if (typeof message === 'string') parts.push(message);
      current = cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(' ');
}

/** Is this error a Postgres unique-constraint violation (optionally, on `constraint`)? */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (error === null || error === undefined) return false;
  // The driver's own code AND the message text of the whole chain: a wrapped error can
  // carry the detail in either, and missing it means silently rethrowing a
  // conflict the caller knew how to handle.
  const text = [chainText(error), error instanceof Error ? error.message : String(error)].join(' ');
  const pg = pgErrorOf(error);
  const conflict = pg?.code === '23505' || /duplicate key|unique constraint|23505/i.test(text);
  if (!conflict) return false;
  return constraint ? text.includes(constraint) || pg?.constraint === constraint : true;
}
