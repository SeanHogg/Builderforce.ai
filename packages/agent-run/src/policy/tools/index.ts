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
 *   • the policy-gate evaluation (`gates.ts` — the former on-prem `policy-gate-seam.ts`: blocks
 *     refuse at dispatch, an unscoped block withholds the tool, `require-approval` asks once per call);
 *   • the window-sized result cap (`caps.ts` `resultCapFor` / `capToolResult` —
 *     `tool-output-policy`'s `windowedCap` sized by `ModelTransport.window()`, applied to
 *     every dispatched result; `truncation.ts` — on-prem `tool-result-truncation.ts`,
 *     reusing the same package for the budget and the cut);
 *   • read coverage (`readCoverage.ts` — `@builderforce/run-guards`' `ReadCoverage`,
 *     WS8a, bound to the agent's vocabulary over `RunState.reads.served`): the hook's
 *     `beforeDispatch` answers a read already served, `observe` records what was served.
 *
 * Not in this module:
 *   • default repo — resolved by the adapter with agent-tools' `resolveDefaultRepo` (WS8b)
 *     into `RunTask.workspace.defaultRepo`; git tools and the shell read it there;
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
import { selectPlatformCatalog } from "./platform.js";
import { selectToolsForTurn } from "./selectTools.js";
import { isChatReplyScope, CHAT_REPLY_SCOPED_TOOLS } from "./toolset.js";
import { coveredReadAnswer, recordServedRead } from "./readCoverage.js";
import { gateCall, isToolWithheld } from "./gates.js";

/** The tools hook, as ported. `select` narrows the surface's schemas to what this run may call. */
export const toolsHook: ToolsHook = {
  select(ctx: PolicyContext, offered: readonly ToolSchema[]) {
    const { policy, task } = ctx;
    // A tool an unscoped `block` gate withholds is never advertised (governance, every surface).
    const tools = offered.filter((t) => !isToolWithheld(policy.approvalGates, t.function?.name ?? ""));

    // The addressed-reply scope advertises only the chat-scoped tools plus whatever the
    // surface already gated to them; the autonomous scopes advertise the one catalog.
    if (isChatReplyScope(policy.toolScope)) {
      const allowed = new Set(CHAT_REPLY_SCOPED_TOOLS);
      return tools.filter((t) => {
        const name = t.function?.name;
        return name ? allowed.has(name) : false;
      });
    }

    const pinned = pinnedNames(ctx);

    // A surface whose own tools are the whole catalog advertises exactly those, ranked by
    // the same selector; the shared registry's core set is a repository's catalog, not a board's.
    const own = selectPlatformCatalog(ctx, pinned);
    if (own) return own;

    // The ONE catalog strategy: role core set + tool_search + find_symbol, with the
    // pinned, required and prompt-named tools kept. The lexical selector then trims an
    // oversized catalog to the turn's fixed set (stable advertised bytes).
    const catalog = selectCatalog(tools, policy.role, catalogCaps(ctx), {
      pinned,
      prompt: task.prompt,
    });
    const selected = selectToolsForTurn(catalog, {
      query: task.prompt,
      pinned,
    });
    return selected.tools;
  },
  gate: gateCall,
  beforeDispatch: coveredReadAnswer,
  observe: recordServedRead,
};

// The capability set is the surface's to report (`CapabilityProvider.capabilities`): the
// catalog adds `find_symbol` wherever `repo.symbols` backs it, cloud included.
function catalogCaps(ctx: PolicyContext): ReadonlySet<Capability> {
  return ctx.ports.capabilities?.capabilities ?? new Set<Capability>();
}

// Pinned tools are the ones the run already called: a tool the model used stays
// advertised, so the turn's set never drops what the run is mid-way through using.
function pinnedNames(ctx: PolicyContext): readonly string[] {
  const names = new Set<string>();
  for (const message of ctx.messages) {
    for (const call of message.toolCalls ?? []) if (call.name) names.add(call.name);
  }
  return [...names];
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
export { windowedCap, toolOutputCap, resultCapFor, capToolResult } from "./caps.js";
export { AGENT_READ_TRAITS, coveredReadAnswer, recordServedRead } from "./readCoverage.js";
export { evaluatePolicyGateSeam, policyRefusalMessage, policyGateCallKey, gateCall, isToolWithheld } from "./gates.js";
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
