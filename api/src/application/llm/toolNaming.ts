/**
 * toolNaming — the ONE translation from a catalog tool id to the name a model sees.
 *
 * ── WHY IT IS ITS OWN MODULE ─────────────────────────────────────────────────────
 * This lived inside `builtinMcpService.ts`, a module that pulls in most of the
 * application layer. Any PROMPT BUILDER that needs it therefore had a choice between
 * importing a very heavy module (often an import cycle) or hand-typing the tool name —
 * and hand-typing is what happened, twice, with the same consequence both times.
 *
 * ── THE FAILURE ──────────────────────────────────────────────────────────────────
 * A prompt naming `manager.digest` — the internal catalog id — handed the model a string
 * that appears nowhere in its tool list. The model did not error: it DESCRIBED the calls
 * it could not make ("The tools required are manager.digest, manager.decisions…") and
 * finished successfully. There is no failure signal anywhere in that loop.
 *
 * The same defect then shipped in `kanban/signoffRequest.ts`, which is the instruction
 * EVERY reviewer and producer run receives on a lifecycle-managed board. It said "call
 * the `kanban.signoff` tool"; the tool is advertised as `builtin_kanban_signoff`.
 * Measured on project 11, 2026-07-28: **492 agent runs completed, 0 forward lane moves,
 * 0 tickets finished**, 281 tickets stalled on `awaiting_signoff` (longest idle 48 days)
 * and 17 slots classified `exhausted` — an agent that "finished every run without
 * recording a verdict". The agents were doing the work and then being asked to report it
 * through a door that did not exist.
 *
 * A prompt that references a tool MUST route through {@link advertisedName}, never a
 * hand-typed literal. Enforced by `api/scripts/check-prompt-tool-names.mjs`.
 */

/**
 * The name a tool is advertised to the MODEL under.
 *
 * Keep in lockstep with the name attached to each tool in `listBuiltinTools()` —
 * `agentReplyPrompt.test.ts` asserts every catalog entry satisfies it.
 */
export function advertisedName(tool: string): string {
  return `builtin_${tool.replace(/[^a-zA-Z0-9]+/g, '_')}`;
}

/**
 * Sentinel `extensionId` the gateway routes to the in-process platform catalog.
 *
 * It lives beside {@link advertisedName} because the two answer the same question —
 * how a first-party tool is ADDRESSED — and every consumer that classifies a catalog
 * entry by source needs it without importing `builtinMcpService` (and its whole
 * dependency graph) to read one string. Re-exported from there for existing callers.
 */
export const BUILTIN_EXTENSION_ID = 'builtin';
