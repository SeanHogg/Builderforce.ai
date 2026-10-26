/**
 * policy/stall — `policy/stall/**` — narration, announced-but-untaken calls, repetition and the forced final synthesis.
 *
 * Owned by WS2b. Until WS2b lands, this hook is a NO-OP and says so: it does
 * the honest "not yet" of a module whose workstream has not shipped, so the agent
 * runs today exactly as it did before the split.
 *
 * WS2b replaces THIS FOLDER and nothing else. It ports the behaviour, brings the
 * source's existing tests along unchanged, and exposes the hook the composition in
 * `policy/index.ts` already calls.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import type { PolicyContext, StallHook } from "../hooks.js";

/** The stall hook, as it stands. */
export const stallHook: StallHook = {
  recover(_ctx: PolicyContext) {
    return undefined;
  },
};
