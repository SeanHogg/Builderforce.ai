/**
 * policy/memory — `policy/memory/**` — the per-turn brief in the volatile tail and the `codemap:` consolidation written back at run end.
 *
 * Owned by WS2e. Until WS2e lands, this hook is a NO-OP and says so: it does
 * the honest "not yet" of a module whose workstream has not shipped, so the agent
 * runs today exactly as it did before the split.
 *
 * WS2e replaces THIS FOLDER and nothing else. It ports the behaviour, brings the
 * source's existing tests along unchanged, and exposes the hook the composition in
 * `policy/index.ts` already calls.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import type { MemoryHook, PolicyContext } from "../hooks.js";

/** The memory hook, as it stands. */
export const memoryHook: MemoryHook = {
  brief(_ctx: PolicyContext) {
    return null;
  },
  consolidate(_ctx: PolicyContext) {
    return undefined;
  },
};
