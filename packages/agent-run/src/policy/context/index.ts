/**
 * policy/context — `policy/context/**` — the recall query built from the prompt plus the
 * focus files' terms, never the bare sentence.
 *
 * Owned by WS2e. This module is the context policy the composition in `policy/index.ts`
 * already calls. It supplies the recall LINES the run should carry — the prompt plus
 * the focus-file terms, as the query the surface's memory recall runs on. The
 * `ContextPack` itself is built by the adapter's `ContextSource.port` (§6.10); this
 * hook names WHAT to recall, the port runs the search and owns the pack.
 *
 * It ports `brain-embedded/src/runStore/runMemory.ts` `recallQuery` (PRD 35 E2) —
 * today's recall searched with the raw user sentence alone, so a run grounding on
 * "the PRD" found the wrong memory — and reads the pack's focus files into the hint,
 * the third part of the editor's `runContextFor` (the pack's recall line is built once
 * per run with no model call, time-boxed and failure-tolerant).
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import type { ContextHook, PolicyContext } from "../hooks.js";
import { focusHint, recallQuery } from "./recall.js";

/** The context hook, as it stands. */
export const contextHook: ContextHook = {
  /**
   * The recall lines the run should carry, queried with the prompt and the focus terms.
   * Returns the query the surface's memory recall runs on, or nothing when there is no
   * request to ground the recall on (a hint alone is not a question).
   */
  async recall(ctx: PolicyContext) {
    let pack;
    try {
      pack = await ctx.ports.context.pack(ctx.task);
    } catch {
      return undefined; // best-effort: a pack that cannot build carries no recall
    }
    const query = recallQuery(ctx.task.prompt, focusHint(pack));
    return query ? [query] : undefined;
  },
};
