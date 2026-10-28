/**
 * The run's usage-ledger seams — every call it makes (`recordUsage`), how it ended
 * (`recordRunOutcome`) and the model call a PreFetch ANSWER avoided (`recordAvoidedCall`,
 * the chat's `deterministic` saving). Kept out of the run host
 * (`brainRunHost.ts`) and its port assembly (`brainRunHostPorts.ts`), which only wire them:
 *
 *   - {@link deviceLedgerPorts}: the host's ports over THIS device's usage ledger;
 *   - {@link chatLedgerRequest}: those ports bound to one chat, as the run request's fields.
 */

import { withRunUsage, type AvoidedRunCall, type RunOutcomeReport } from "@seanhogg/builderforce-brain-embedded";
import type { BrainRunHostPorts } from "./brainRunHostContract";
import type { localBrainApplication } from "./localFirstStore";

type LedgerPorts = Pick<BrainRunHostPorts, "recordRunOutcome" | "recordAvoidedCall">;
type DeviceLedgerPorts = Required<Pick<BrainRunHostPorts, "recordUsage">> & Required<LedgerPorts>;
type DeviceUsage = ReturnType<typeof localBrainApplication>["usage"];

/** The device usage ledger as the run host's usage, outcome and avoided-call ports. A failed write is logged. */
export function deviceLedgerPorts(usage: DeviceUsage, log: (line: string) => void): DeviceLedgerPorts {
  return {
    recordUsage: (stream, run) => withRunUsage(stream, usage, run, (error) => log(`[usage ledger] write failed: ${String(error)}`)),
    recordRunOutcome: (run, end) => usage.recordOutcome({ chatId: run.chatId, ...end }),
    // A PreFetch ANSWER's avoided call — the chat's `deterministic` saving, on this device.
    recordAvoidedCall: (run, { source: _source, ...call }) => usage.recordAvoided({ chatId: run.chatId, runKey: run.chatId, ...call }),
  };
}

/** The ports bound to one chat — the run request's `recordRunOutcome` / `recordAvoidedCall`. */
export function chatLedgerRequest(ports: LedgerPorts, chatId: number): {
  recordRunOutcome?: (end: RunOutcomeReport) => Promise<void>;
  recordAvoidedCall?: (call: AvoidedRunCall) => Promise<void>;
} {
  return {
    ...(ports.recordRunOutcome ? { recordRunOutcome: (end: RunOutcomeReport) => ports.recordRunOutcome!({ chatId }, end) } : {}),
    ...(ports.recordAvoidedCall ? { recordAvoidedCall: (call: AvoidedRunCall) => ports.recordAvoidedCall!({ chatId }, call) } : {}),
  };
}
