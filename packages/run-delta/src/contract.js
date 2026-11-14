/**
 * run-delta/contract.ts — THE run delta contract (PRD 41 §C4). Pure types, no I/O.
 *
 * Diff the facts, not the text: both sides of a run are reduced to findings and metrics by
 * deterministic rules, the delta is a set difference with lineage (memory `matchLineage`),
 * and every verdict traces to evidence. Hosts (VS Code, on-prem, cloud container) supply
 * {@link DeltaPorts}; this package never reads a file, a clock or the network.
 *
 * Rules are REGISTRY DATA (principle 5): a new check is one {@link DeltaRule} row in
 * `registry/`, never a branch in the engine. A dimension with no rule that could run reports
 * `not_measured` with a reason — a missing measurement is never shown as zero findings.
 */
/** The L3 analyzer half of the contract lives in its own module; it is part of this one. */
export * from './contract/analyzers.js';
// ─── The chat card (§C11.1) ──────────────────────────────────────────────────
/**
 * What an ignored `.builderforce/delta.json` entry is reported as. The engine's own drops ({@link OverrideResult}):
 * `unknown-key`, `invalid` (a section or one of its entries), `invalid-root` (not an object), `unsafe-regex`. The host's:
 * `invalid-json`, `unreadable` (its before side could not be read), and `truncated` (more were dropped than are kept).
 */
export const DROPPED_OVERRIDE_CODES = ['unknown-key', 'invalid', 'invalid-root', 'invalid-json', 'unsafe-regex', 'unreadable', 'truncated'];
/**
 * §12.5 hold reasons, as the run's execution record carries them (`hold.reason`): `run_delta_blocking:<rule ids>` when
 * its delta computed blocking codes, {@link RUN_DELTA_UNMEASURED} when an autonomous run that changed files could not be
 * measured (its delta failed or timed out: fail-closed). Both are released the same way.
 */
export const RUN_DELTA_HOLD_PREFIX = 'run_delta_blocking:';
export const RUN_DELTA_UNMEASURED = 'run_delta_unmeasured';
/**
 * Why `run-delta/release` was refused — the error code the host answers with, one per case the card says differently:
 * the run is not (or no longer) held, its hold is still being recorded, the release failed, the person is signed out (or
 * their identity could not be read), or the run is on a board and they lack its approver authority.
 */
export const RUN_DELTA_RELEASE_REFUSED = {
    notHeld: 'run_delta_release_refused:not_held',
    pending: 'run_delta_release_refused:pending',
    error: 'run_delta_release_refused:error',
    identityRequired: 'run_delta_release_identity_required',
    notApprover: 'run_delta_release_refused:not_approver',
};
/** A refusal's kind from the host's error text; anything unrecognised (a timeout, an older host) is `error`. */
export function releaseRefusalOf(message) {
    for (const [kind, code] of Object.entries(RUN_DELTA_RELEASE_REFUSED)) {
        if (message === code)
            return kind;
    }
    return 'error';
}
/** `run-delta/open` refused: the path is not one the stored delta names, under its root. */
export const RUN_DELTA_OPEN_REFUSED = 'run_delta_open_refused';
/** worse > not_comparable > better > same > not_measured. */
export const HEADLINE_ORDER = ['worse', 'not_comparable', 'better', 'same', 'not_measured'];
/** The decimal step the blast-radius score is quantized to (B8.2). */
export const BLAST_RADIUS_STEP = 0.001;
//# sourceMappingURL=contract.js.map