/**
 * The run's usage-ledger seams — every call it makes (`recordUsage`), how it ended
 * (`recordRunOutcome`) and the model call a PreFetch ANSWER avoided (`recordAvoidedCall`,
 * the chat's `deterministic` saving). Kept out of the run host
 * (`brainRunHost.ts`) and its port assembly (`brainRunHostPorts.ts`), which only wire them:
 *
 *   - {@link deviceLedgerPorts}: the host's ports over THIS device's usage ledger;
 *   - {@link chatLedgerRequest}: those ports bound to one chat, as the run request's fields.
 */
import { withRunUsage } from "@seanhogg/builderforce-brain-embedded";
/** The device usage ledger as the run host's usage, outcome and avoided-call ports. A failed write is logged. */
export function deviceLedgerPorts(usage, log) {
    return {
        recordUsage: (stream, run) => withRunUsage(stream, usage, run, (error) => log(`[usage ledger] write failed: ${String(error)}`)),
        recordRunOutcome: (run, end) => usage.recordOutcome({ chatId: run.chatId, ...end }),
        // A PreFetch ANSWER's avoided call — the chat's `deterministic` saving, on this device.
        recordAvoidedCall: (run, { source: _source, ...call }) => usage.recordAvoided({ chatId: run.chatId, runKey: run.chatId, ...call }),
    };
}
/** The ports bound to one chat — the run request's `recordRunOutcome` / `recordAvoidedCall`. */
export function chatLedgerRequest(ports, chatId) {
    return {
        ...(ports.recordRunOutcome ? { recordRunOutcome: (end) => ports.recordRunOutcome({ chatId }, end) } : {}),
        ...(ports.recordAvoidedCall ? { recordAvoidedCall: (call) => ports.recordAvoidedCall({ chatId }, call) } : {}),
    };
}
//# sourceMappingURL=runUsageLedgerPorts.js.map