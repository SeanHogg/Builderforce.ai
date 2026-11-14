/**
 * G09 — policy must survive sign-out, and a missing snapshot must deny.
 *
 * Sign-out drops the in-memory gate cache. The next launch must not treat that
 * hole as permission to call the platform. This module is the pure rule:
 * keep the snapshot that already governs the record, and boot from it.
 * A missing snapshot denies. A manufactured default-allow is refused.
 *
 * Pure: no `vscode` import. Activation wires
 * `configurePolicyGatesPersistence(createPolicyGatesPersistence(store, { deviceId }))`
 * from `extension.ts`. This file does not make that call.
 */
/** The allow a missing cache must never be replaced with. */
export const DEFAULT_ALLOW_REASON = "default-allow";
const NO_SNAPSHOT = Object.freeze({
    allowsPlatform: false,
    reason: "no_snapshot",
});
export function isDefaultAllowDecision(decision) {
    if (decision == null)
        return true;
    if (decision.reason === DEFAULT_ALLOW_REASON)
        return true;
    return decision.allowsPlatform === true && decision.reason.trim() === "";
}
/**
 * Keep the snapshot that already governs managed records.
 * Returns the same object. Never null. Never a default-allow.
 */
export function retainOnSignOut(snapshot) {
    if (snapshot == null) {
        throw new TypeError("policy snapshot must survive sign-out; refusing null");
    }
    if (isDefaultAllowDecision(snapshot.decision)) {
        throw new TypeError("sign-out must not retain a default-allow policy");
    }
    return snapshot;
}
/**
 * Boot decision for the next launch.
 * No stored snapshot denies platform calls. A stored snapshot answers with its decision.
 */
export function bootPolicy(stored) {
    if (stored == null)
        return { ...NO_SNAPSHOT };
    return stored.decision;
}
//# sourceMappingURL=policySnapshotRetention.js.map