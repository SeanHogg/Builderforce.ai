/**
 * `relayRunSinks` — how the relay renders an on-prem ticket run's progress: the sinks the
 * adapter reports to ({@link OnPremRunSinks}), built over the relay's two outputs — the live
 * socket (`chat.message` frames) and the durable tool-audit trail (the timeline that outlives
 * the run). The frames are the ones the portal already renders for every engine, so a ticket
 * run reads exactly as it always did.
 *
 * A sub-agent is observed on its own ({@link OnPremRunSinks.forChild}): its calls and its
 * outcome row (which names its owner) go to the audit trail tagged with its label, never to
 * the owner's chat.
 */

import type { ToolAuditEvent } from "../infra/builderforce-relay-outboxes.js";
import type { OnPremRunSinks } from "./onPremEvents.js";

/** What the relay lends the sinks. */
export interface RelayRunSinkDeps {
  /** The execution the run belongs to; stamped on every audit row. */
  executionId?: number;
  /** The live socket: a frame to every subscriber, best-effort. */
  sendToRelay(frame: Record<string, unknown>): unknown;
  /** Live AND durable, exactly once (the relay DO persists the frame; HTTP only when the socket is down). */
  emitAudit(event: ToolAuditEvent): void;
  /** Durable only: a timeline row with no live `tool.audit` frame (its live form is another frame). */
  persistAudit(event: ToolAuditEvent): void;
}

/** The sinks for one run. */
export function relayRunSinks(deps: RelayRunSinkDeps): OnPremRunSinks {
  const { executionId } = deps;
  return {
    onAssistantText: (text) => {
      // Live view…
      deps.sendToRelay({ type: "chat.message", role: "assistant", text, session: "main" });
      // …and durable persistence, so the run's natural-language turns show on the
      // Logs/Timeline after it ends (parity with V1's `agent.message`).
      deps.persistAudit({ executionId, toolName: "agent.message", category: "message", result: text });
    },
    onToolUse: (toolName, toolCallId, args) => {
      deps.emitAudit({ executionId, toolName, toolCallId, category: "v2", args });
    },
    onResult: () => {
      /* terminal state is reported by the relay from the run's return value */
    },
    onSteerApplied: (text) => {
      // Acknowledge on the timeline exactly as the cloud loop does (`steer.applied`, category
      // `message`, args.text) — live + durable. The relay DO already echoed the user's turn to
      // browsers, so only the acknowledgement is emitted here.
      deps.emitAudit({ executionId, toolName: "steer.applied", category: "message", args: { text }, result: text.slice(0, 280) });
    },
    onOutcome: (row) => {
      // The uniform outcome row (PRD 35 §8.2), one per run, on the durable audit trail.
      deps.emitAudit({ executionId, toolName: "run.outcome", category: "run", args: row });
    },
    forChild: (label) => ({
      onAssistantText: () => undefined,
      onToolUse: (toolName, toolCallId, args) => {
        deps.emitAudit({ executionId, toolName, toolCallId, category: "v2-child", args: { child: label, args } });
      },
      onResult: () => undefined,
      onOutcome: (row) => {
        deps.emitAudit({ executionId, toolName: "run.outcome", category: "run", args: { ...row, child: label } });
      },
    }),
  };
}
