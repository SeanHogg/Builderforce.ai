/**
 * policy/finish — the placeholder, no-deliverable, CI-pending, source-quality,
 * review-verdict (sign-off) and honesty finish gates, and the @-reply verify pin.
 *
 * Owned by WS2d. Ports `api/src/application/runtime/cloudAgent/finishGates.ts` behind
 * the `FinishHook.gate` contract `policy/hooks.ts` names. The engine's repo/db couplings
 * (branch-CI polling, the placeholder scan, the structural completion-claim record,
 * live-child tracking) arrive as optional PORTS a surface binds with
 * {@link createFinishHook}; absent, that gate is an honest no-op rather than an invented
 * check.
 *
 * The sign-off requirement (`RunPolicy.signoff`) is satisfied only by a SUCCESSFUL
 * `builtin_kanban_signoff` call for the exact role/lane slot — the source's
 * `matchesRequiredReviewSignoff`. The gate reads that evidence from the run's own
 * transcript and records it in `RunState.finish.reviewVerdictRecorded`, so it survives a
 * later compaction and a step boundary.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser and
 * Node.
 */

import type { RunMessage } from "../../contract.js";
import type { FinishHook, PolicyContext } from "../hooks.js";
import type { CiFinishDecision } from "./ciGate.js";
import { evaluateFinishGates, matchesRequiredReviewSignoff, missingReviewVerdictMessage, type RequiredReviewSignoff } from "./gates.js";
import { applyVerifyPhase } from "../verify/runEndMemory.js";

/** The optional engine ports a surface binds with {@link createFinishHook}. */
export interface FinishPorts {
  read?: (path: string) => Promise<string | null>;
  pollBranchCi?: () => Promise<CiFinishDecision>;
  scanPlaceholders?: (paths: readonly string[]) => Promise<{ flagged: Array<{ path: string; markers: string[] }> }>;
}

/**
 * Read the run's written paths. `runAgent.ts` maintains `state.writtenPaths`; the @-reply
 * path carried its own set — both arrive here through the state, never by recomputing.
 */
function writtenPathsOf(ctx: PolicyContext): readonly string[] {
  return ctx.state.writtenPaths ?? [];
}

/** A tool row's result, as the transcript holds it (`JSON.stringify(result.data)`). */
function succeeded(row: RunMessage | undefined): boolean {
  if (!row) return false;
  try {
    const data = JSON.parse(row.content) as unknown;
    return !(data && typeof data === "object" && (data as { ok?: unknown }).ok === false);
  } catch {
    return row.content.trim().length > 0;
  }
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Did this run record the sign-off verdict its policy requires? A successful
 * `builtin_kanban_signoff` for the exact slot — a narrative summary is not evidence.
 */
export function signoffRecorded(messages: readonly RunMessage[], required: RequiredReviewSignoff | undefined): boolean {
  if (!required) return false;
  const results = new Map<string, RunMessage>();
  for (const row of messages) if (row.role === "tool" && row.toolCallId) results.set(row.toolCallId, row);
  return messages.some((row) =>
    row.role === "assistant" &&
    (row.toolCalls ?? []).some((call) =>
      matchesRequiredReviewSignoff(required, call.name, parseArgs(call.arguments), succeeded(results.get(call.id))),
    ),
  );
}

/**
 * Record the sign-off verdict once the transcript holds it, so it survives a later
 * compaction and a step boundary. True when the run's required verdict is recorded.
 */
function noteSignoff(ctx: PolicyContext): boolean {
  if (ctx.state.finish.reviewVerdictRecorded) return true;
  if (!signoffRecorded(ctx.messages, ctx.policy.signoff)) return false;
  ctx.state.finish = { ...ctx.state.finish, reviewVerdictRecorded: true };
  return true;
}

/**
 * The sign-off hold on a PROSE answer: a reviewer run owes its `builtin_kanban_signoff`
 * verdict whether it ends through the `finish` tool or in prose — the cloud loop held
 * both. Null when no sign-off is owed or it is recorded.
 */
export function signoffSettleBlock(ctx: PolicyContext): string | null {
  const required = ctx.policy.signoff;
  if (!required || noteSignoff(ctx)) return null;
  return missingReviewVerdictMessage(required);
}

/**
 * The finish hook for a surface's engine couplings. `ctx.content` is the finish summary.
 * An adapter binds its ports with `composePolicyHooks({ finish: createFinishHook(ports) })`.
 */
export function createFinishHook(ports: FinishPorts = {}): FinishHook {
  return {
    settleBlock: signoffSettleBlock,
    async gate(ctx: PolicyContext): Promise<string | null> {
      noteSignoff(ctx);
      const verdict = await evaluateFinishGates({
        writtenPaths: writtenPathsOf(ctx),
        requiredSignoff: ctx.policy.signoff,
        delegated: ctx.task.dispatch.parentRunId !== undefined,
        summary: typeof ctx.content === "string" ? ctx.content : "",
        output: "",
        gates: ctx.state.finish,
        enterVerify: () => {
          ctx.state.model = applyVerifyPhase(ctx.state.model);
        },
        ports,
      });
      if (verdict.block) {
        ctx.state.finish = { ...ctx.state.finish, finishBlockedOnce: true };
      }
      return verdict.block;
    },
  };
}

/** The finish hook with no engine couplings: sign-off, no-deliverable and honesty still gate. */
export const finishHook: FinishHook = createFinishHook();
