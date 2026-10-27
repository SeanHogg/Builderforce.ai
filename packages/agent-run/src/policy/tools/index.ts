/**
 * policy/tools — `policy/tools/**` — the one catalog strategy, the capability gate, the pinning, the read coverage and the window-sized result cap.
 *
 * Owned by WS2f. Until WS2f lands, this hook is a NO-OP and says so: it does
 * the honest "not yet" of a module whose workstream has not shipped, so the agent
 * runs today exactly as it did before the split.
 *
 * WS2f replaces THIS FOLDER and nothing else. It ports the behaviour, brings the
 * source's existing tests along unchanged, and exposes the hook the composition in
 * `policy/index.ts` already calls.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import type { ToolSchema } from "@builderforce/agent-tools";
import type { PolicyContext, ToolsHook } from "../hooks.js";

/** The tools hook, as it stands. */
export const toolsHook: ToolsHook = {
  select(_ctx: PolicyContext, _tools: readonly ToolSchema[]) {
    return undefined;
  },
};
