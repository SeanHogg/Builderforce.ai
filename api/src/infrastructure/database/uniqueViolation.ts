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

/** Is this error a Postgres unique-constraint violation (optionally, on `constraint`)? */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (error === null || error === undefined) return false;
  const code = typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  const message = typeof error === 'object' ? (error as { message?: unknown }).message : undefined;
  // Both the driver's own message and the stringified error: a wrapped error can
  // carry the detail in either, and missing it means silently rethrowing a
  // conflict the caller knew how to handle.
  const text = [
    typeof message === 'string' ? message : '',
    error instanceof Error ? error.message : String(error),
  ].join(' ');

  const conflict = code === '23505' || /duplicate key|unique constraint|23505/i.test(text);
  if (!conflict) return false;
  return constraint ? text.includes(constraint) : true;
}
