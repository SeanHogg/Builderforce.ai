/**
 * policy/ask — `policy/ask/**` — asking a human: the option list, the pending answer and the lift of a prose question into a real ask.
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

import type { HumanAnswer } from "../../contract.js";
import type { AskHook, PolicyContext } from "../hooks.js";

/** The ask hook, as it stands. */
export const askHook: AskHook = {
  async answer(_ctx: PolicyContext, _question: string, _options?: readonly string[]): Promise<HumanAnswer> {
    return { kind: "paused" };
  },
};
