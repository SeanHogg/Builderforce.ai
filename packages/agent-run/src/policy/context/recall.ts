/**
 * policy/context/recall — the recall query, built from the prompt PLUS the focus files'
 * terms, never the bare sentence.
 *
 * Ports `brain-embedded/src/runStore/runMemory.ts` `recallQuery` (PRD 35 E2). Today's
 * Evermind recall searched with the raw user sentence alone, so a run grounded on "the
 * PRD" found the wrong memory. The query is the request, plus the host's hint (the
 * focus-file paths and their top headings) when there is one.
 *
 * The query names WHAT to search; the SURFACE's `ContextSource.port` runs the search
 * and owns the `ContextPack` (§6.10). This module supplies the QUERY and reads the
 * pack's focus into the hint.
 *
 * Pure — no I/O, no `node:*`, no DOM.
 */

import type { ContextPack } from "../../contract.js";

/** The most hint text a recall query carries — the search is a query, not a document. */
export const MAX_RECALL_HINT_CHARS = 600;

/**
 * The recall query: the user's request, plus the host's hint (focus-file paths and their
 * top headings, PRD 35 E2) when there is one. No request ⇒ the request as it is — a hint
 * alone is not a question. Pure.
 */
export function recallQuery(userText: string, hint?: string | null): string {
  const extra = (hint ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_RECALL_HINT_CHARS);
  if (!extra || !userText.trim()) return userText;
  return `${userText.trim()}\n\n${extra}`;
}

/** One focus entry's term, from the path and its headings. */
function focusTerms(entry: ContextPack["focus"][number]): string {
  const path = entry.path;
  const heads = (entry.outline ?? []).map((h) => h.heading).filter(Boolean);
  return [path, ...heads].join(" ");
}

/**
 * The hint from the pack's focus files — what the run is about, as paths and headings.
 * Empty when the pack named no focus files.
 */
export function focusHint(pack: ContextPack): string {
  return pack.focus.map(focusTerms).filter(Boolean).join("\n");
}
