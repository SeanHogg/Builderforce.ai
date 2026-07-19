/**
 * Shared SSE `data:` frame parsing.
 *
 * Every consumer of an OpenAI/Anthropic-style Server-Sent-Events stream needs
 * the SAME line-level dance: trim the line, keep only `data:` frames, drop the
 * `[DONE]` sentinel and empty payloads, `JSON.parse` the rest and skip anything
 * malformed. This was hand-rolled (subtly differently) in at least four places —
 * `anthropicSseUsage`, `anthropicMessagesBridge`, `toolNameSanitizer`, and the
 * chat transport's first-chunk error sniff — one of which used `slice(6)`
 * (assuming a `data: ` space) while the others used `slice(5).trim()`, a latent
 * bug on a spaceless `data:{…}` frame. This is the single source.
 *
 * `parseSseDataLine` normalizes ONE line; `parseSseDataFrames` streams every
 * parsed frame out of a full concatenated SSE string. Both are pure and
 * defensive — a malformed frame is skipped, never thrown.
 */

/**
 * Parse a single SSE line into its decoded JSON payload, or `undefined` when the
 * line is not a usable data frame (not a `data:` line, the `[DONE]` sentinel, an
 * empty payload, or malformed JSON). Tolerant of both `data: {…}` (with space)
 * and `data:{…}` (spaceless) — the canonical `slice(5).trim()` handles either.
 */
export function parseSseDataLine(line: string): unknown | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return undefined;
  const data = trimmed.slice(5).trim();
  if (!data || data === '[DONE]') return undefined;
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

/**
 * Yield each parsed `data:` frame from a full concatenated SSE string, skipping
 * non-data lines, `[DONE]`, and malformed payloads. Callers read only the fields
 * they need off each yielded value.
 */
export function* parseSseDataFrames(raw: string): Generator<unknown> {
  for (const line of raw.split('\n')) {
    const parsed = parseSseDataLine(line);
    if (parsed !== undefined) yield parsed;
  }
}
