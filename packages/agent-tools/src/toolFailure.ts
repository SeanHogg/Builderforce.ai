/** The ONE "did this tool step fail?" predicate — a leaf module (no imports): the run's memory record, the run policy and
 *  the editor's diagnostics all read it, so none keeps its own rule. */

/**
 * Did a tool result represent a failure?
 *
 * Tool results in this codebase signal failure by SHAPE, not prose: the platform
 * actions return `{ ok: false }` or `{ error: "<message>" }` (the tenant guard,
 * the dispatcher's unknown-capability, a thrown handler). We inspect that shape
 * instead of regex-scanning the whole stringified payload — the old
 * `\b(error|failed|exception)\b` scan misfired on any legit data that merely
 * CONTAINED the word "error" (e.g. a task titled "Fix login error", an audit
 * row, a search result), mis-marking a successful run as ERROR in the report.
 *
 * For a STRING result we only flag an embedded `{ ok: false }` / `"error":`
 * envelope (a stringified error object), never a free-text occurrence of the
 * word — a plain-string success like `"done"` or `"No errors found"` is not a
 * failure.
 */
export function isFailedToolResult(result: unknown): boolean {
  if (result == null) return false;
  if (typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (r.ok === false) return true;
    if (typeof r.error === "string" && r.error) return true;
    return false;
  }
  if (typeof result === "string") {
    // Only a serialized error envelope counts — not the bare word "error".
    return /"ok"\s*:\s*false/.test(result) || /"error"\s*:\s*"[^"]/.test(result);
  }
  return false;
}
