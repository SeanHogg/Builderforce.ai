/**
 * policy/steering — `policy/steering/**` — the drain of user messages between steps, the steer that interrupts a step, and the stop that kills the tool in flight.
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

import type { PolicyContext, SteeringHook } from "../hooks.js";

/** The steering hook, as it stands. */
export const steeringHook: SteeringHook = {
  inject(_ctx: PolicyContext, _steered: readonly string[]) {
    return undefined;
  },
};
