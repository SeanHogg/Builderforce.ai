/**
 * The context pack's ONE deadline rule: every pre-turn part (the pack's fan-out, the
 * symbol lookups behind its areas, the pre-search hits, the where-answer) is raced
 * against its budget and replaced by a fallback when it is late or fails — a slow part
 * is left out, never waited on, never a run failure.
 *
 * The rule itself lives in `@builderforce/prefetch` (`deadline.ts`), where the run's
 * PreFetch gate enforces executor budgets with it; the pack's modules import it here.
 */

export { withinMs } from "@builderforce/prefetch";
