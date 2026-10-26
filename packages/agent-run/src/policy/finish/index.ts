/**
 * policy/finish — `policy/finish/**` — the placeholder, no-deliverable, CI-pending and review-verdict gates, and the sign-off requirement.
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

import type { FinishHook, PolicyContext } from "../hooks.js";

/** The finish hook, as it stands. */
export const finishHook: FinishHook = {
  gate(_ctx: PolicyContext) {
    return null;
  },
};
