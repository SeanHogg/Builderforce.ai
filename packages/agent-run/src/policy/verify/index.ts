/**
 * policy/verify — `policy/verify/**` — the declared checks run in a shell, or the branch's CI, with honest exit codes.
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

import type { PolicyContext, VerifyHook } from "../hooks.js";

/** The verify hook, as it stands. */
export const verifyHook: VerifyHook = {
  verify(_ctx: PolicyContext) {
    return undefined;
  },
};
