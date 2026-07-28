/**
 * signoffContract — the FINGERPRINT of the ask, so a fixed platform can un-wedge its own
 * backlog.
 *
 * ── THE MEASURED FAILURE ─────────────────────────────────────────────────────────
 * `attestRoleRun` counts how many times a reviewing role finished a run WITHOUT recording
 * a verdict, and at {@link MAX_UNATTESTED_RUNS} it marks the slot `exhausted`: the manager
 * stops asking and hands it to a human. That ceiling is right — re-asking what has ignored
 * three asks is the livelock this platform already named.
 *
 * It is right ONLY if the asks were answerable. Twice now they were not:
 *
 *   1. the instruction told the agent to POST an HTTP route it has no tool for;
 *   2. the instruction named the tool by its CATALOG ID (`kanban.signoff`) while the model
 *      is advertised `builtin_kanban_signoff`, so the sentence named nothing it had.
 *
 * Both were fixed at the source. Neither fix reached the backlog, because the COUNTERS
 * outlived the defect: measured on project 11 (api 2026.7.171), **108 required sign-off
 * slots** sat `exhausted` — "agent-owed but NEVER ANSWERS (asking stopped)" — with
 * `dispatchable: 0`, so the gate held 18 tickets in a 30-decision window and dispatched
 * NOBODY to sign off on any of them. Every one of those silences was recorded while
 * recording a verdict was structurally impossible.
 *
 * A ceiling counted against an impossible ask is not a ceiling, it is a tombstone.
 *
 * ── WHY A FINGERPRINT AND NOT A VERSION CONSTANT ─────────────────────────────────
 * The obvious fix is `SIGNOFF_CONTRACT_VERSION = 3`, bumped by hand whenever the
 * instruction changes. That is the same class of defect one layer up: the whole reason
 * both bugs shipped is that a human had to remember to keep two things in sync and did
 * not. A constant nobody bumps re-wedges the board exactly as before, silently.
 *
 * So the version IS the instruction. {@link SIGNOFF_CONTRACT} is a hash of the rendered
 * reviewer and producer instructions, computed at module load from the very functions the
 * agent is sent. Editing either template — a tool name, a required argument, a reworded
 * demand — changes the fingerprint by construction, and every slot whose silence was
 * counted under the old wording is re-armed automatically. There is nothing to forget.
 *
 * A cosmetic edit re-arms too. That is deliberate and cheap: a reworded ask IS a new ask,
 * the re-arm costs at most {@link MAX_UNATTESTED_RUNS} further asks per slot, and the
 * alternative — a hand-maintained list of "which edits were semantic" — is the judgement
 * call that produced this bug twice.
 *
 * Pure string maths, no IO, no clock.
 */
import { buildProducerRequestInstruction, buildSignoffRequestInstruction } from './signoffRequest';

/**
 * The spec the templates are rendered with to take the fingerprint.
 *
 * Fixed and arbitrary — only the SHAPE of the instruction is being fingerprinted, never
 * one ticket's values. Every field is populated so the optional clauses (lane, PR, title)
 * are all present in the hashed text and an edit to any of them is caught.
 */
const FINGERPRINT_SPEC = {
  taskId: 0,
  taskTitle: 'contract fingerprint',
  roleKey: 'role',
  roleName: 'Role',
  laneKey: 'lane',
  prUrl: 'pr',
} as const;

/** FNV-1a (32-bit), hex. Small, dependency-free, and stable across isolates/deploys. */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    // 32-bit FNV prime multiply, kept in range with Math.imul.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * The current ask contract's fingerprint — the value stamped alongside a counted silence.
 *
 * Computed once at module load from BOTH instruction builders, so a change to either the
 * reviewer or the producer contract re-arms the slots that went silent under it.
 */
export const SIGNOFF_CONTRACT: string = fingerprint(
  `${buildSignoffRequestInstruction(FINGERPRINT_SPEC)} ${buildProducerRequestInstruction(FINGERPRINT_SPEC)}`,
);

/**
 * Was this slot's counted silence recorded under the CURRENT ask contract? PURE.
 *
 * False for an unstamped slot, which is the load-bearing case: every count written before
 * this module existed was recorded under an instruction that named a tool the agent did
 * not have, so "no stamp" must read as "obsolete", never as "assume current". That single
 * choice is what clears the measured 108 on the first pass after deploy.
 */
export function isCurrentSignoffContract(evidence: unknown, contract: string = SIGNOFF_CONTRACT): boolean {
  if (!evidence || typeof evidence !== 'object') return false;
  return (evidence as { attestationContract?: unknown }).attestationContract === contract;
}
