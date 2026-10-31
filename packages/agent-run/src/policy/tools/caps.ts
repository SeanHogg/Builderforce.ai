/**
 * caps — the ONE window-sized result cap (PRD 35 §6.10).
 *
 * THE CAP is `@builderforce/tool-output-policy`'s `windowedCap` / `toolOutputCap`, reused,
 * never re-derived (this package's tsconfig maps the source package, and `truncation.ts`
 * already imports it). The rule, for the reader:
 *
 *   • no / invalid window ⇒ the tool's fixed table cap;
 *   • `read_file` ⇒ `clamp(windowToolResultCap(window), tableCap, 64_000)`;
 *   • every other tool ⇒ `min(tableCap, windowToolResultCap(window))`.
 *
 * {@link resultCapFor} is the one call a dispatch site makes: the table row for the tool,
 * sized by the serving model's window (`ModelTransport.window()`, PRD 35 §3.2).
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import { shapeToolResult, toolOutputCap, truncatedResultNote, windowedCap } from "@builderforce/tool-output-policy";

export { toolOutputCap, windowedCap };

/**
 * The cap on one tool's result for this run: the package's table row, sized by the
 * serving model's context window. Unknown model or window ⇒ the table row (today's caps).
 */
export function resultCapFor(
  tool: string,
  model: { window?(model: string): number | undefined },
  servingModel: string | undefined,
): number {
  const window = servingModel && typeof model.window === "function" ? model.window(servingModel) : undefined;
  return windowedCap(tool, toolOutputCap(tool), window);
}

/** A failed result's own error text, bounded so it never crowds out the body. */
const ERROR_CHARS = 500;

function failedResult(data: unknown): { error?: string } | null {
  if (!data || typeof data !== "object" || (data as { ok?: unknown }).ok !== false) return null;
  const error = (data as { error?: unknown }).error;
  return typeof error === "string" ? { error: error.slice(0, ERROR_CHARS) } : {};
}

/**
 * The shaper's text (a head+tail cut is not JSON) as a result object whose SERIALISED
 * form fits `maxChars`: JSON escaping inflates the text, so it is cut until it does.
 */
function fittedText(text: string, failed: { error?: string } | null, maxChars: number, originalChars: number): Record<string, unknown> {
  // The marker rides BEFORE the body, so the cut that makes the result fit can only ever
  // remove content, never the sentence that says content is missing. One wording, the policy's.
  const note = truncatedResultNote(originalChars, maxChars);
  const head = failed ? { ok: false, ...failed } : {};
  let body = text;
  for (;;) {
    const result = { ...head, truncated: true, note, output: body };
    const over = JSON.stringify(result).length - maxChars;
    if (over <= 0 || body.length === 0) return result;
    body = body.slice(0, Math.max(0, body.length - over - 1));
  }
}

/**
 * One dispatched result, capped to {@link resultCapFor} by the package's shaper
 * (`shapeToolResult` — a `read_file` is windowed, anything else cut head+tail). Returns
 * the result itself when it fits, so an uncapped result is never re-serialised. A capped
 * result serialises within the cap, and a failed (`ok: false`) one stays failed — the
 * dispatch reads that flag as the call's error.
 */
export function capToolResult(tool: string, data: unknown, maxChars: number): unknown {
  const shaped = shapeToolResult(tool, data, { maxChars });
  if (!shaped.truncated) return data;
  const failed = failedResult(data);
  let parsed: unknown;
  try {
    parsed = JSON.parse(shaped.content) as unknown;
  } catch {
    return fittedText(shaped.content, failed, maxChars, shaped.bytes);
  }
  if (failed && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return { ...(parsed as Record<string, unknown>), ok: false };
  }
  return failed ? fittedText(shaped.content, failed, maxChars, shaped.bytes) : parsed;
}
