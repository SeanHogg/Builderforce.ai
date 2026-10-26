/**
 * policy/model — `policy/model/**` — the role ladder, the cascade, the learned routing, the pins and the preflight that names a degraded model before turn 1.
 *
 * Owned by WS2g. Until WS2g lands, this hook is a NO-OP and says so: it does
 * the honest "not yet" of a module whose workstream has not shipped, so the agent
 * runs today exactly as it did before the split.
 *
 * WS2g replaces THIS FOLDER and nothing else. It ports the behaviour, brings the
 * source's existing tests along unchanged, and exposes the hook the composition in
 * `policy/index.ts` already calls.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import type { ModelHook, PolicyContext } from "../hooks.js";

/** The model hook, as it stands. */
export const modelHook: ModelHook = {
  resolve(_ctx: PolicyContext) {
    return undefined;
  },
};
