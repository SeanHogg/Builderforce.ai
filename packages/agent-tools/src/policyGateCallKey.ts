/**
 * The identity of ONE `require-approval` decision: the gate, the tool it gated, and the
 * exact arguments of the call. One definition for every surface — the cloud engine and the
 * one agent (`agent-run`'s governance gate) both key the calls a person has decided by it.
 */

import { stableStringify } from "./stableStringify.js";

/** FNV-1a (32-bit), hex. Not cryptographic — this only needs to be stable, cheap, and
 *  short enough that a run's approved-call list stays small in the persisted run state.
 *  A collision would merely let one distinct call reuse another's approval, which is
 *  vanishingly unlikely and bounded by the gates a single run reaches. */
function hash32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Keying the run's approved set by `gateId` ALONE (the original bug) made approval
 * once-per-RUN: a human approving `run_command("ls")` also silently pre-approved
 * `run_command("rm -rf /")` and every later call the same gate covered, for the whole
 * run — the gate stopped gating after its first hit. Keying by gate + tool + argument
 * hash makes approval once-per-CALL: each DISTINCT invocation is approved on its own
 * merits, while a RETRIED identical call (same tool, same args — e.g. the agent
 * re-issuing the call after the resume) matches the stored key and proceeds instead of
 * re-parking the run forever.
 *
 * A plain string so it stays JSON-serializable in the run's state across ticks. Pure.
 */
export function policyGateCallKey(gateId: string, toolName: string, args: Record<string, unknown>): string {
  return `${gateId}|${toolName}|${hash32(stableStringify(args))}`;
}
