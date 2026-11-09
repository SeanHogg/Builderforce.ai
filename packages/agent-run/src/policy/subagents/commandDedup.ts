/**
 * policy/subagents/commandDedup.ts — the delegation-economy GATE (fix #3, DELEGATION DEDUP).
 *
 * The two refusal rules are DEFINED once in `@builderforce/agent-tools`
 * (`delegation-economy.ts`) so every surface enforces the same ones; this module is the
 * policy-side gate for the agent core: the composition calls it before an owner
 * `run_command` dispatches and before a spawn brief is accepted, and the call never
 * reaches the surface when the gate refuses. Enforcement in code at the seam, never
 * prose a model can argue past.
 *
 *   a. {@link duplicateOfLiveChild}: while a child is LIVE, an owner `run_command`
 *      identical to a command already in the child's brief OR already started by the
 *      child — identical NORMALISED (trimmed, whitespace-collapsed, compared as
 *      cwd+command, a `cd X &&` prefix and the `cwd` argument resolved into the
 *      directory) — is REFUSED with
 *      "<handle> is already running this — call wait_agents for its result".
 *   b. {@link trivialDelegationRefusal}: a brief that is only ≤3 shell commands with no
 *      reasoning task (the verify-only delegation) is REFUSED with
 *      "... run these yourself with run_command background:true".
 *
 * The gate re-reads the live-child registry on EVERY decision (the surface supplies it
 * as a port), so a child's completion event is visible to the very next call — the
 * property that lets `wait_agents` resolve on the completion event instead of polling
 * to its timeout.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser and Node.
 */

import { duplicateOfLiveChild, trivialDelegationRefusal, type LiveChildWork } from "@builderforce/agent-tools";

/** Where the gate reads the run's live children from — the surface's child registry, supplied as a port. */
export interface DelegationGateChildren {
  /**
   * The children live RIGHT NOW. Called on every gate decision, never cached: a child
   * that settled between two calls must be gone from the second call's answer.
   */
  live(): readonly LiveChildWork[];
}

/** The delegation-economy gate for one run: the two refusals and the live-children snapshot. */
export interface DelegationGate {
  /**
   * The refusal for a spawn brief that is only ≤3 shell commands with no reasoning task
   * (the owner runs them itself, in background); null for a real delegation.
   */
  spawnRefusal(brief: string): string | null;
  /**
   * The refusal for an owner `run_command` a live child owns (briefed or started), or
   * null when no live child owns it. `cwd` is the owner's `run_command` cwd argument —
   * the same command in another directory is other work.
   */
  runCommandRefusal(command: string, cwd?: string): string | null;
  /** The children live right now — what a finish-hold or wait decision reads; empty when none. */
  liveNow(): readonly LiveChildWork[];
}

/**
 * The gate for one run. `children` is the port the surface supplies; when absent (a
 * surface with no live-child registry) the gate still refuses trivial briefs and never
 * refuses `run_command` — there is nothing for it to duplicate.
 */
export function delegationGate(children?: DelegationGateChildren): DelegationGate {
  return {
    spawnRefusal: (brief) => trivialDelegationRefusal(brief),
    runCommandRefusal: (command, cwd) => (children ? duplicateOfLiveChild(command, children.live(), cwd) : null),
    liveNow: () => (children ? children.live() : []),
  };
}
