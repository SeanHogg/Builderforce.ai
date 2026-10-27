/**
 * policy/tools — `policy/tools/**` — the one catalog strategy, the capability gate, the
 * pinning, the read coverage and the window-sized result cap.
 *
 * Owned by WS2f. This index is the module's hook: it composes the ported pieces behind
 * the `ToolsHook` interface the composition in `policy/index.ts` already calls, and
 * exposes each piece for the tests that came along from the sources.
 *
 * What is ported here (each in its own file):
 *   • the cloud surface capability set and its lever/sandbox/delegation narrowing (`caps.ts`
 *     — `cloudAgentTools.ts` + `runSurfaceCaps.ts`);
 *   • the ONE catalog strategy: a role core set (≤ 20) plus `tool_search`, with the pinned,
 *     required and prompt-named tools kept, and `find_symbol` wherever `repo.symbols` backs
 *     it (`catalog.ts` — `deferredTools.ts`; `selectTools.ts` — `selectTools.ts` lexical
 *     rank + synonyms + pinning; `searchHelpers.ts` — the `tool_search` meta tool);
 *   • `toolScope: 'chat-reply'` data (`toolset.ts` — `cloudAgentToolset.ts` `CHAT_SCOPED_AGENT_TOOLS`);
 *   • the on-prem policy-gate evaluation (`gates.ts` — `policy-gate-seam.ts` + the SDK
 *     `allowedToolsAfterGates` allowlist shape);
 *   • the window-sized result cap (`truncation.ts` — on-prem `tool-result-truncation.ts`,
 *     reusing `@builderforce/tool-output-policy` for the budget and the cut).
 *
 * Deferred (named in the WS2f report, not ported now):
 *   • read coverage binding — after WS8a;
 *   • default repo — after WS8b;
 *   • the on-prem `bash-tools.exec-runtime.ts` background exec + `process` poll (node-only,
 *     belongs to the on-prem adapter WS5, not this worker-safe module);
 *   • the canvas tool port (no standalone canvas source exists to port verbatim today).
 *
 * `RunState.reads` reuses `@builderforce/run-guards`' `CoveredRead` / `ReadsWithoutSpawnState`
 * — this module consumes and updates that state slice but does not redefine it.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser and Node.
 */

import type { Capability, ToolSchema } from "@builderforce/agent-tools";
import type { PolicyContext, ToolsHook } from "../hooks.js";
import { selectCatalog } from "./catalog.js";
import { selectToolsForTurn } from "./selectTools.js";
import { isChatReplyScope, CHAT_REPLY_SCOPED_TOOLS } from "./toolset.js";
import { windowedCap, toolOutputCap } from "./caps.js";

/** The tools hook, as ported. `select` narrows the surface's schemas to what this run may call. */
export const toolsHook: ToolsHook = {
  select(ctx: PolicyContext, tools: readonly ToolSchema[]) {
    const { policy, task } = ctx;

    // The addressed-reply scope advertises only the chat-scoped tools plus whatever the
    // surface already gated to them; the autonomous scopes advertise the one catalog.
    if (isChatReplyScope(policy.toolScope)) {
      const allowed = new Set(CHAT_REPLY_SCOPED_TOOLS);
      return tools.filter((t) => {
        const name = t.function?.name;
        return name ? allowed.has(name) : false;
      });
    }

    // The ONE catalog strategy: role core set + tool_search + find_symbol, with the
    // pinned, required and prompt-named tools kept. The lexical selector then trims an
    // oversized catalog to the turn's fixed set (stable advertised bytes).
    const catalog = selectCatalog(tools, policy.role, ctx.state.reads ? catalogCaps(ctx) : new Set(), {
      pinned: pinnedNames(ctx),
      prompt: task.prompt,
    });
    const selected = selectToolsForTurn(catalog, {
      query: task.prompt,
      pinned: pinnedNames(ctx),
    });
    return selected.tools;
  },
};

// The capability set is the surface's to report; the tools policy only reasons about what
// the catalog already gated. Until the surface threads capabilities through the context,
// the catalog strategy treats the full catalog as capability-backed (find_symbol is added
// by the caller when it knows `repo.symbols` exists). This indirection exists so WS3 can
// supply `repo.symbols` without touching this module.
function catalogCaps(_ctx: PolicyContext): ReadonlySet<Capability> {
  return new Set<Capability>();
}

// Pinned tools are the ones the run already called — the read-coverage state records
// served windows, not calls, so the caller (runAgent composition) passes the pinned set
// through `ctx.state.reads` extensions when WS8a lands. Today: nothing pinned yet.
function pinnedNames(_ctx: PolicyContext): readonly string[] {
  return [];
}

/** Re-exports so the module's tests (brought along from the sources) import one home. */
export {
  selectCatalog,
  coreToolNames,
  ALWAYS_CORE_TOOLS,
  ROLE_CORE_TOOLS,
} from "./catalog.js";
export { selectToolsForTurn, PINNED_OVERFLOW, DEFAULT_TOOL_LIMIT } from "./selectTools.js";
export { runToolSearch, TOOL_SEARCH_MAX, promptNamedTools } from "./searchHelpers.js";
export { CHAT_REPLY_SCOPED_TOOLS, isChatReplyScope, CHAT_REPLY_TOOL_SCOPE } from "./toolset.js";
export { windowedCap, toolOutputCap } from "./caps.js";
export { evaluatePolicyGateSeam, canUseToolDecision, policyRefusalMessage } from "./gates.js";
export {
  truncateToolResultText,
  truncateToolResultMessage,
  truncateOversizedToolResultsInMessages,
  calculateMaxToolResultChars,
  isOversizedToolResult,
  sessionLikelyHasOversizedToolResults,
} from "./truncation.js";
// The `tool_search` meta tool's schema and name live in the shared package; re-export the
// name the catalog appends so the module's single home answers for it.
export { TOOL_SEARCH_TOOL, TOOL_SEARCH_SCHEMA } from "@builderforce/agent-tools";
