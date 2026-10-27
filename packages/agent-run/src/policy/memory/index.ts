/**
 * policy/memory — `policy/memory/**` — the per-turn brief in the volatile tail and the
 * `codemap:` consolidation written back at run end.
 *
 * Owned by WS2e. This module is the memory policy the composition in `policy/index.ts`
 * already calls:
 *
 * - `brief` is what the run has already established, in front of THIS turn only — so
 *   the model reasons from its own record instead of re-deriving the codebase every
 *   turn. It ports the on-prem `agent-loop.ts` brief and brain-embedded's
 *   `run.knowledge.brief()` (each successful tool call is recorded into the run's
 *   memory; the brief restates it before the turn). The composition attaches it to the
 *   volatile block, which is NEVER part of the cached prefix (PRD 35 `costLoop/
 *   volatileTail.ts`).
 * - `consolidate` is the run-end memory: the `codemap:` write-back fields from
 *   `run.consolidate({ root })` (the one rule every runtime — on-prem `knowledge-loop.ts`,
 *   cloud `runEndMemory.ts`, the editor `memoryCommit.ts` — commits the same way),
 *   PLUS the model-extracted learned facts when the run changed files and the surface
 *   opted in with a `learnedFacts` port (`clients/vscode/src/memoryCommit.ts`, the
 *   editor's addition on top of the shared code map).
 *
 * The run's record is `@builderforce/agent-tools`' `RunKnowledgeRecorder`
 * (`run-knowledge.ts`); `RunState.memory` IS its `RunKnowledgeState` — reused, never
 * redefined. {@link recorderForState} rebuilds the recorder across a step boundary.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import type { MemoryHook, PolicyContext } from "../hooks.js";
import { recorderForState, knowledgeState } from "./knowledge.js";
import { extractAndWriteLearnedFacts } from "./learnedFacts.js";

/** The memory hook, as it stands. */
export const memoryHook: MemoryHook = {
  /**
   * The brief for this turn, or null when there is nothing worth saying. The recorder
   * is restored from `state.memory` (once per state object), so a resumed run's brief
   * continues the SAME record a continuous run holds.
   */
  brief(ctx: PolicyContext) {
    const recorder = recorderForState(ctx.state);
    // The recorder's record is written back, so a later turn (and a resume) sees it.
    ctx.state.memory = knowledgeState(recorder);
    return recorder.brief();
  },

  /**
   * The consolidated memory the run produced, written back through `store.commitMemory`.
   * The code map (the `codemap:` write-back fields) is returned for the store; the
   * learned-facts step runs behind the injected `learnedFacts` port when the run
   * changed files. A read-only investigation still maps (PRD 35 E8): `consolidate`
   * maps ≥3 files READ as readily as ≥3 changed, so the next run asked about this area
   * starts warm.
   */
  async consolidate(ctx: PolicyContext) {
    const recorder = recorderForState(ctx.state);
    ctx.state.memory = knowledgeState(recorder);
    const map = recorder.consolidate({ root: ctx.task.workspace?.defaultRepo });
    const facts = await extractAndWriteLearnedFacts({
      activity: recorder.activity,
    });
    // `undefined` (no map) leaves the store's commitMemory alone; a map is always
    // committed even when no learned fact landed — the map is the deterministic half.
    return map ?? (facts !== null && facts.length > 0 ? { facts } : undefined);
  },
};
