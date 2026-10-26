/**
 * policy/subagents — `policy/subagents/**` — the child that is the SAME agent with its own ports, the delegation nudge and the end-of-run backstop.
 *
 * Owned by WS2c. Until WS2c lands, this hook is a NO-OP and says so: it does
 * the honest "not yet" of a module whose workstream has not shipped, so the agent
 * runs today exactly as it did before the split.
 *
 * WS2c replaces THIS FOLDER and nothing else. It ports the behaviour, brings the
 * source's existing tests along unchanged, and exposes the hook the composition in
 * `policy/index.ts` already calls.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import type { PolicyContext, SubagentsHook } from "../hooks.js";

/** The subagents hook, as it stands. */
export const subagentsHook: SubagentsHook = {
  select(_ctx: PolicyContext) {
    return undefined;
  },
};
