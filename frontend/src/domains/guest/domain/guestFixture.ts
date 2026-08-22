/**
 * The contract a guest fixture satisfies — pure, so the registry is a table
 * rather than a chain of `if (path.startsWith(...))`.
 *
 * A fixture answers ONE read. It is matched by path, it returns the JSON that
 * endpoint returns, and it knows nothing about transports, sessions or React.
 * Everything variable — today's date, the visitor's own edits — arrives in the
 * {@link GuestFixtureContext} rather than being reached for, which is what makes
 * a fixture testable without a browser.
 *
 * Open/closed by construction: a new surface is a new ENTRY in a registry
 * module, never a new branch inside the resolver.
 */

export interface GuestFixtureContext {
  /** The path being read, without the origin. Query string included. */
  path: string;
  /** Parsed query parameters, so a fixture can honour `?days=90`. */
  query: URLSearchParams;
  /** Milliseconds since the epoch AT THE MOMENT OF THE READ. Passed in rather
   *  than read from the clock so a fixture is deterministic under test and its
   *  day offsets always resolve relative to now in the browser. */
  now: number;
}

/**
 * One fixture: which reads it answers, and what it answers with.
 *
 * `match` gets the pathname only (no query), because a fixture that had to
 * re-parse the query to decide whether it applies is a fixture doing the
 * registry's job.
 */
export interface GuestFixture {
  /** Stable id, used in diagnostics and to let a later entry override an earlier
   *  one deliberately rather than by list position. */
  id: string;
  match: (pathname: string) => boolean;
  respond: (context: GuestFixtureContext) => unknown;
}

/** Resolve a day offset against the read's own clock. */
export function dayOffsetToIso(now: number, dayOffset: number): string {
  return new Date(now + dayOffset * 86_400_000).toISOString();
}

/** Match a path exactly, ignoring a trailing slash. The common case. */
export function exact(...paths: string[]): (pathname: string) => boolean {
  const set = new Set(paths.map((p) => p.replace(/\/$/, '')));
  return (pathname: string) => set.has(pathname.replace(/\/$/, ''));
}

/** Match a path and everything under it. */
export function under(prefix: string): (pathname: string) => boolean {
  return (pathname: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
}
