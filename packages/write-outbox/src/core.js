/**
 * The outbox without the browser stores (`./stores.ts` types against `IDBFactory`), for
 * hosts that compile with no DOM lib — the API Worker and its Durable Objects, and the
 * Node agent runtime. Browser hosts import the package root, which re-exports this.
 */
export { createOutbox } from "./outbox.js";
export { classifyOutboxWork, BEST_EFFORT_WORK, DURABLE_USER_WORK } from "./classification.js";
export { exportDeadLetters, repairDeadLetter } from "./deadLetter.js";
export { exportDeadLetterAction } from "./deadLetterExport.js";
export { classifyQueue, isDurableUserWorkQueue, isTelemetryQueue } from "./classifyQueue.js";
export { exportAndRequeueDeadLetter, exportDeadLettersForRepair, requeueDeadLetter, } from "./deadLetterRepair.js";
export { isPermanentHttpFailure, OUTBOX_MAX_ENTRIES, OUTBOX_MAX_ITEMS, OUTBOX_MAX_WAIT_MS, OUTBOX_RETRY_BASE_MS, OUTBOX_RETRY_MAX_MS, } from "./policy.js";
export { assertSendAllowed, createRevokeGate, filterSendable, gateOutboxSend, guardSend, isPermissionRevoked, PERMISSION_REVOKED, permissionRevokedError, } from "./revokeGate.js";
//# sourceMappingURL=core.js.map