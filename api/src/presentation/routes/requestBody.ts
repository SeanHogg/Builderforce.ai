/**
 * Request-body and query-string validation shared by every route module.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * `c.req.json<T>()` is a TYPE ASSERTION, not a check: 750 sites across 159
 * route files read a body as `<{ name: string; ids: number[] }>` and then
 * trusted the annotation. A caller that sends `{"ids": "7"}` reaches
 * `body.ids.map(...)` and the handler throws a TypeError — answered as a 500,
 * reported as a defect, when the request was simply wrong. Handlers that DID
 * check did so by hand (`typeof body.name === 'string' && body.name.trim()`),
 * differently in every file, and none of them could say WHICH field failed.
 *
 * {@link parseBody} is the one read: it parses the JSON, runs the route's zod
 * schema, and either returns a value the schema admitted or throws a
 * {@link RequestValidationError} that the global handler answers as
 * `400 { error, issues: [{ path, message }] }`. Malformed JSON is the same 400
 * — a body that cannot be parsed is a client error, never an invariant failure.
 *
 * `z` is re-exported so a route keeps ONE import for its schemas, and the
 * shared field readers ({@link zPositiveInt}, {@link zNonEmptyString}, …)
 * are the SAME predicates `queryParams.ts` uses for path/query params, so a
 * body id and a query id are rejected by identical rules.
 *
 * `scripts/check-unvalidated-bodies.mjs` ratchets the count of raw
 * `c.req.json` reads per file; it can only fall.
 */
import { z } from 'zod';
import { RequestValidationError, type RequestValidationIssue } from '../../domain/shared/errors';
import { boundedIntParam, limitParam, offsetParam, type BoundedIntOptions } from '../../domain/shared/boundedInt';

export { z };

/** The slice of a Hono context these readers need — narrow so tests need no Hono app. */
export interface BodyContext {
  req: { json: () => Promise<unknown> };
}
export interface QueryContext {
  req: { query: () => Record<string, string> };
}

/** `[{ path: ['items', 0, 'id'], message }]` → `[{ path: 'items.0.id', message }]`. */
function issuesOf(error: z.ZodError): RequestValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

/** Run `schema` over `value`, throwing the 400-shaped error on a miss. */
function admit<T>(schema: z.ZodType<T>, value: unknown, what: 'body' | 'query'): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = issuesOf(result.error);
  const first = issues[0];
  const summary = first ? `${first.path ? `${first.path}: ` : ''}${first.message}` : `Invalid request ${what}`;
  throw new RequestValidationError(issues, `Invalid request ${what} — ${summary}`);
}

/**
 * Read and validate the JSON body. Never returns a shape the schema did not
 * admit. Unparseable JSON and an empty body are both a 400 with a single
 * root-level issue, so a route never has to `.catch(() => ({}))` its own read.
 */
export async function parseBody<T>(c: BodyContext, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new RequestValidationError(
      [{ path: '', message: 'Request body must be valid JSON' }],
      'Invalid request body — Request body must be valid JSON',
    );
  }
  return admit(schema, raw, 'body');
}

/**
 * Read and validate a body that may legitimately be ABSENT.
 *
 * Some endpoints mean something with no body at all: `PATCH /:id/pin` toggles,
 * `POST /:id/checkpoint` takes an optional label, `POST /:id/watch` defaults its
 * state. Those handlers were all written as
 * `await c.req.json<XBody>().catch(() => ({} as XBody))` — a type assertion with
 * a shrug attached, which is exactly the pattern {@link parseBody} exists to end,
 * except that swapping in `parseBody` would ALSO start rejecting the empty body
 * they deliberately accept.
 *
 * So this is the honest third case: an absent or unparseable body yields the
 * schema's own parse of `{}` (so the schema still decides what "empty" means, and
 * a schema with a required field still refuses), while a body that IS present is
 * validated exactly as {@link parseBody} would. The tolerance stays; the type
 * assertion goes.
 */
export async function parseOptionalBody<T>(c: BodyContext, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    raw = {};
  }
  return admit(schema, raw ?? {}, 'body');
}

/**
 * Validate the query string. Every value arrives as a string, so schemas use
 * `z.coerce.number()` / {@link zQueryInt} for numerics and `z.enum` for choices.
 */
export function parseQuery<T>(c: QueryContext, schema: z.ZodType<T>): T {
  return admit(schema, c.req.query(), 'query');
}

// ── Shared field schemas ─────────────────────────────────────────────────────
// The same predicates `queryParams.ts` applies to params (`Number.isInteger(n)
// && n > 0`), stated once as schemas so a body cannot admit an id a param would
// refuse.

/** A row id: a positive integer. `0`, floats, numeric strings and NaN are refused. */
export const zPositiveInt = z.number().int().positive();

/** A positive integer that may arrive as a string (a query param, a form field). */
export const zQueryInt = z.coerce.number().int().positive();

/** A required free-text field: trimmed, non-empty. */
export const zNonEmptyString = z.string().trim().min(1);

/**
 * An optional free-text field: trimmed; `""`, whitespace, `null` and absent all
 * read as `undefined`, so a handler has one absent value to test.
 */
export const zOptionalString = z.preprocess(
  (value) => (typeof value === 'string' ? (value.trim() || undefined) : value == null ? undefined : value),
  z.string().optional(),
);

// ── Bounded integers ─────────────────────────────────────────────────────────
// `domain/shared/boundedInt` semantics, NOT a second clamp: junk or absent is the
// default, anything that parses is floored and clamped. These never REFUSE — a
// `limit` of 10_000 is a page of `max`, exactly as `?limit=` already reads — so a
// body field and a query param with the same name answer identically.

/** Any integer band: `def` when absent/junk, floored and clamped into `[min, max]`. */
export const zBoundedInt = (options: BoundedIntOptions) =>
  z.unknown().transform((raw) => boundedIntParam(raw, options));

/** A page size: at least 1, at most `max`, `def` when absent or junk. */
export const zLimit = (def: number, max: number) =>
  z.unknown().transform((raw) => limitParam(raw, def, max));

/** A row offset: never negative, 0 when absent or junk. */
export const zOffset = z.unknown().transform((raw) => offsetParam(raw));
