/**
 * policy/compaction — `policy/compaction/**` — the transcript fold, the reserve tokens and the window fit.
 *
 * Owned by WS2a. Until WS2a lands, this hook is a NO-OP and says so: it does
 * the honest "not yet" of a module whose workstream has not shipped, so the agent
 * runs today exactly as it did before the split.
 *
 * WS2a replaces THIS FOLDER and nothing else. It ports the behaviour, brings the
 * source's existing tests along unchanged, and exposes the hook the composition in
 * `policy/index.ts` already calls.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import type { CompactionHook, PolicyContext } from "../hooks.js";

/** The compaction hook, as it stands. */
export const compactionHook: CompactionHook = {
  compact(_ctx: PolicyContext) {
    return undefined;
  },
};
