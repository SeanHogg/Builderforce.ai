/**
 * Model-output JSON extraction.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * Six private "strip the fence and find the braces" helpers lived across the
 * application and route layers (`parseJsonObject` ×3, `parseModelJson`,
 * `parseAnalyzerJson`, `parsedJsonObject`, `extractJson`), each tolerant of a
 * different subset of what a model actually emits: one accepted ```ts fences,
 * one only ```json, one refused arrays, one matched the FIRST `{` to the LAST
 * `}` with no fence handling at all. The same reply parsed on one surface and
 * failed on another. This is the one reading, used by `completeJson` and by
 * every caller that still has a raw model string in hand.
 *
 * Domain-layer so application code can import it without reaching into a route.
 */

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

/** {@link extractJsonPayload} narrowed to a plain object — what most prompts ask for. */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const value = extractJsonPayload(text);
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
