/**
 * Defensive JSON coercion — for stored columns AND for model output.
 *
 * ── Stored columns ──────────────────────────────────────────────────────────
 * A value that may arrive already-decoded (a JSONB driver decode), as a JSON
 * string (legacy text columns), or null. One place for the
 * "parse-or-fall-back-to-[]/{}" pattern that was copied across route/service
 * files: {@link parseJsonArray}, {@link parseJsonObject}, {@link parseJsonOr}.
 *
 * ── Model output ────────────────────────────────────────────────────────────
 * Six private "strip the fence and find the braces" helpers lived across the
 * application and route layers (`parseJsonObject` ×3, `parseModelJson`,
 * `parseAnalyzerJson`, `parsedJsonObject`, `extractJson`), each tolerant of a
 * different subset of what a model actually emits: one accepted ```ts fences,
 * one only ```json, one refused arrays, one matched the FIRST `{` to the LAST
 * `}` with no fence handling at all. The same reply parsed on one surface and
 * failed on another. {@link extractJsonPayload} is the one reading, used by
 * `application/llm/completeJson.ts` and by every caller that still has a raw
 * model string in hand.
 *
 * Domain-layer so application code can import it without reaching into a route.
 */

/**
 * Coerce `raw` to an array. Already an array → returned as-is; a JSON string that
 * parses to an array → the parsed array; anything else (non-array JSON, invalid
 * JSON, null/undefined) → `[]`.
 */
export function parseJsonArray<T = unknown>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Coerce `raw` to a plain object. Already a non-array object → returned as-is; a
 * JSON string that parses to a non-array object → the parsed object; anything else
 * (array, scalar, invalid JSON, null/undefined) → `{}`.
 */
export function parseJsonObject<T = Record<string, unknown>>(raw: unknown): T {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as T;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as T)
        : ({} as T);
    } catch {
      return {} as T;
    }
  }
  return {} as T;
}

/**
 * `JSON.parse`, or `fallback` — for an absent OR an unparseable string. The
 * `safeJson` that five modules had written, differing only in what they fell
 * back to (`null`, `[]`, the raw text, a caller value): the fallback is now the
 * caller's to state, once, at the call.
 */
export function parseJsonOr<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ── Model output ─────────────────────────────────────────────────────────────

/** ```json / ```ts / ```typescript / bare ``` fences, anywhere in the text. */
const FENCE = /```(?:json|ts|typescript|javascript|js)?\s*([\s\S]*?)```/i;

function tryParse(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * The JSON value a model reply carries, or `null` when there is none.
 *
 * Order of attempts, each on the fence-stripped text:
 *   1. the whole text (the strict `response_format` happy path — zero copies);
 *   2. the outermost `{…}` slice;
 *   3. the outermost `[…]` slice.
 *
 * Returns `unknown`, not `Record<string, unknown>`: the caller's validator decides
 * the shape, and a top-level array is a legitimate answer for a list prompt.
 * `null` is returned for an empty reply, a reply with no bracket pair, and a slice
 * that does not parse; `undefined` is never returned, and nothing throws.
 */
export function extractJsonPayload(text: string): unknown | null {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return null;
  const fenced = FENCE.exec(raw);
  const body = (fenced?.[1] ?? raw).trim();
  if (!body) return null;

  const whole = tryParse(body);
  if (whole !== null) return whole;

  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const start = body.indexOf(open);
    const end = body.lastIndexOf(close);
    if (start === -1 || end <= start) continue;
    const sliced = tryParse(body.slice(start, end + 1));
    if (sliced !== null) return sliced;
  }
  return null;
}

/**
 * A parsed value narrowed to a plain object, or `null` for an array, a scalar or null.
 * THE object validator for `completeJson(dispatch, request, asJsonObject)` — seven call
 * sites had each inlined this ternary as a lambda or a private `jsonObjectOnly`.
 */
export function asJsonObject<T extends object = Record<string, unknown>>(value: unknown): T | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : null;
}

/**
 * {@link asJsonObject} with `{}` for anything that is not a plain object — THE tolerant
 * reader for untyped provider and stored JSON (`asJsonRecord(payload.data).id`).
 * Fourteen modules each declared a private `rec` / `asRecord` / `record` / `obj` for
 * exactly this.
 */
export function asJsonRecord(value: unknown): Record<string, unknown> {
  return asJsonObject(value) ?? {};
}

/** {@link extractJsonPayload} narrowed to a plain object — what most prompts ask for. */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  return asJsonObject(extractJsonPayload(text));
}
