/**
 * policy/context — `policy/context/**` — the recall query built from the prompt plus the
 * focus files' terms, never the bare sentence.
 *
 * Owned by WS2e. This module is the context policy the composition in `policy/index.ts`
 * already calls. It supplies the recall LINES the run should carry — the entries the
 * surface's memory capability returns for the prompt plus the focus-file terms. The
 * `ContextPack` itself is built by the adapter's `ContextSource` (§6.10); this hook
 * builds the QUERY, the memory capability runs the search.
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

/** The most recalled entries one run carries into its turn-context block. */
export const RECALL_LIMIT = 8;

/** The context hook, as it stands. */
export const contextHook: ContextHook = {
  /**
   * The recall lines the run should carry: the entries the surface's memory
   * (`CapabilityProvider.memory.recall`) returns for the prompt plus the focus terms, as
   * `key: content` lines. Nothing when the surface has no memory, the recall fails, or
   * there is no request to ground it on (a hint alone is not a question) — recall is
   * best-effort and never fails a run.
   */
  async recall(ctx: PolicyContext) {
    const memory = ctx.ports.capabilities?.memory;
    if (!memory || !ctx.task.prompt.trim()) return undefined;
    let hint = "";
    try {
      hint = focusHint(await ctx.ports.context.pack(ctx.task));
    } catch {
      hint = ""; // a pack that cannot build still recalls on the request alone
    }
    const query = recallQuery(ctx.task.prompt, hint);
    try {
      const recalled = await memory.recall(query, RECALL_LIMIT);
      const lines = (recalled.ok ? recalled.entries ?? [] : []).map((entry) => `${entry.key}: ${entry.content}`);
      return lines.length > 0 ? lines : undefined;
    } catch {
      return undefined;
    }
  },
};
