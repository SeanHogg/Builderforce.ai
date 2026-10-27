/**
 * policy/guards — `policy/guards/**` — the A3 progress detector, the D1 cascade, the D7 post-edit check and the D8 parallel reads.
 *
 * Owned by WS2d. Until WS2d lands, this hook is a NO-OP and says so: it does
 * the honest "not yet" of a module whose workstream has not shipped, so the agent
 * runs today exactly as it did before the split.
 *
 * WS2d replaces THIS FOLDER and nothing else. It ports the behaviour, brings the
 * source's existing tests along unchanged, and exposes the hook the composition in
 * `policy/index.ts` already calls.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import type { GuardsHook, PolicyContext, PolicyToolCall } from "../hooks.js";

/** The guards hook, as it stands. */
export const guardsHook: GuardsHook = {
  beforeDispatch(_ctx: PolicyContext, _call: PolicyToolCall) {
    return undefined;
  },
  observe(_ctx: PolicyContext, _call: PolicyToolCall, _result: unknown) {
    return undefined;
  },
};
