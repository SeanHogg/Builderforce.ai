/**
 * cloudAdapterPorts — the cloud run's events, people and steering ports (PRD 35 WS3).
 *
 *   events   — the run TIMELINE: every trace event the agent emits lands as a tool-audit row
 *              in the shape the Observability UI has always read (`recordCloudToolEvent`),
 *              plus the WS6 uniform outcome row, best-effort like every timeline write;
 *   human    — the durable pause: the surface parks the run on an approval and /resume wakes
 *              it. A question the agent asks arrives here ALREADY parked (the `ask_human` tool
 *              or a guard created the approval), so `ask` only reports the pause; a governance
 *              gate that needs an approver creates its approval in `approve`;
 *   steering — the execution's pending user steers (`executionSteering.pullPendingSteering`),
 *              drained at every step boundary, each recorded as `steer.applied`.
 * None of this is policy: what a gate means, when to steer and how to ask are the agent's.
 */
import { and, eq } from 'drizzle-orm';
import { cascadeReason } from '@builderforce/agent-run';
import { approvals } from '../../infrastructure/database/schema';
import type { EventSink, HumanChannel, RunEvent, RunOutcomeRow, SteeringSource } from '@builderforce/agent-run';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { recordTypedExecutionClaim } from '../provenance/finishClaimService';
import { recordCloudToolEvent } from './cloudToolEvents';
import { applyPendingSteering } from './cloudLoopControl';
import { pauseExecutionForQuestion } from './executionPause';

/** Whose run these ports serve. */
export interface CloudRunRefs {
  tenantId: number;
  projectId: number;
  taskId: number;
  executionId: number;
  cloudAgentRef?: string;
  agentLabel: string;
}

const base = (run: CloudRunRefs) => ({ tenantId: run.tenantId, cloudAgentRef: run.cloudAgentRef, executionId: run.executionId });

type Row = Omit<Parameters<typeof recordCloudToolEvent>[1], 'tenantId' | 'cloudAgentRef' | 'executionId'>;

/** A tool whose success is a typed claim the finish evidence reads back: validation ran, or a review verdict was recorded. */
const CLAIM_TOOLS: ReadonlySet<string> = new Set(['run_checks', 'run_command', 'builtin_reviews_record']);

/** The timeline row a trace event becomes, or null when the event is recorded elsewhere. */
function rowFor(event: RunEvent, meta: { durationMs?: number } | undefined, served: () => string | null): Row | null {
  switch (event.kind) {
    case 'tool.dispatched': {
      const args = event.args ?? {};
      return {
        toolName: event.tool, category: 'tool', ...(event.callId ? { toolCallId: event.callId } : {}),
        detail: event.tool === 'write_file' ? { path: args.path, summary: args.summary } : args,
        result: JSON.stringify(event.result ?? null).slice(0, 300),
        ...(meta?.durationMs !== undefined ? { durationMs: meta.durationMs } : {}),
      };
    }
    case 'model.cascade':
      return { toolName: 'model.cascade', category: 'llm', detail: { step: event.step, from: event.from, reason: event.status != null ? String(event.status) : 'transport' }, result: cascadeReason({ kind: 'retry_turn', released: event.from ?? undefined, ...(event.status != null ? { status: event.status } : {}) } as never) };
    case 'stall.recovered': {
      const d = event.detail ?? {};
      if (event.action === 'steer') {
        return { toolName: 'loop.stall_recovery', category: 'llm', detail: { step: event.step, model: d.model ?? null, attempt: d.attempt, shape: d.shape }, result: `turn made no tool call (${String(d.shape ?? 'stall')}) — re-prompted to act (${String(d.attempt ?? '')})` };
      }
      if (event.action === 'escalate') {
        return { toolName: 'model.failover', category: 'llm', detail: { step: event.step, from: d.from ?? null, to: d.to, attempt: d.attempt, of: d.of, shape: d.shape }, result: String(d.notice ?? event.note ?? 'moved to another model') };
      }
      return { toolName: 'loop.stall_unrecovered', category: 'error', detail: { step: event.step, model: d.model ?? null, tried: d.tried, shape: d.shape }, result: String(event.note ?? 'the run stopped').slice(0, 600) };
    }
    case 'context.tools':
      return {
        toolName: 'context.tools', category: 'context',
        detail: { step: event.step, advertised: event.advertised, catalog: event.catalog, toolsTokens: event.toolsTokens, loaded: event.loaded },
        result: `${event.advertised}/${event.catalog} tools advertised (~${event.toolsTokens} tokens of schemas)`,
      };
    case 'policy.blocked':
      return { toolName: 'policy.blocked', category: 'tool', detail: { tool: event.tool, gateId: event.gateId, reason: event.reason }, result: `Blocked ${event.tool}: ${event.reason}` };
    case 'finish.blocked':
      return { toolName: 'finish.blocked', category: 'tool', detail: { reason: event.reason, ...event.detail }, result: event.block };
    case 'loop.repetition':
      return {
        toolName: 'llm.repetition_loop', category: 'llm', detail: { step: event.step, model: served(), copies: event.copies },
        result: `the model repeated one block ${event.copies} times — kept the first copy: "${event.block.trim().slice(0, 120)}"`,
      };
    case 'context.compacted':
      return {
        toolName: 'context.compacted', category: 'llm',
        detail: { step: event.step, beforeTokens: event.beforeTokens, afterTokens: event.afterTokens, summarized: event.summarized, droppedMessages: event.dropped, maskedObservations: event.masked ?? 0 },
        result: `compressed ~${event.beforeTokens ?? '?'} → ~${event.afterTokens ?? '?'} tokens (${event.summarized ? 'builder-memory summary' : event.dropped === 0 && event.masked ? 'stale tool outputs masked' : 'elided'})`,
      };
    case 'model.preflight':
    case 'llm.model_downgrade':
    case 'run.started':
    case 'run.finished':
      return { toolName: event.kind, category: event.kind.startsWith('run.') ? 'run' : 'llm', detail: { ...event }, result: event.kind };
    default:
      return null; // turn / model.completed / steer events: the gateway call, the steer drain and the loop already recorded them
  }
}

/** The run timeline; the outcome row's counts are handed to `onOutcome`. A sink that cannot write records nothing; it never fails the run. */
export function timelineSink(db: Db, run: CloudRunRefs, served: () => string | null = () => null, onOutcome?: (row: RunOutcomeRow) => void): EventSink {
  const write = (row: Row): Promise<void> =>
    recordCloudToolEvent(db, { ...base(run), ...row }).catch((error) =>
      reportCaughtError(error, { source: 'application/runtime/cloudAdapterPorts.ts', operation: 'timelineSink', context: { logMessage: '[cloud-run] timeline write failed', details: { executionId: run.executionId, error } } }),
    ) as Promise<void>;
  return {
    async emit(event, meta) {
      // With an outcome owner the trace closes with the LANDED status (`cloudOutcomeRow`), not the agent's.
      const row = onOutcome && event.kind === 'run.finished' ? null : rowFor(event, meta, served);
      if (row) await write(row);
      // A successful validation / review verdict is a TYPED claim the finish evidence reads back.
      if (event.kind === 'tool.dispatched' && event.ok && CLAIM_TOOLS.has(event.tool)) {
        const kind = event.tool === 'builtin_reviews_record' ? 'review_verdict' : 'validation';
        await recordTypedExecutionClaim(db, { tenantId: run.tenantId, executionId: run.executionId, kind, statement: `${event.tool} completed successfully` })
          .catch((error) => reportCaughtError(error, { source: 'application/runtime/cloudAdapterPorts.ts', operation: 'typedClaim', context: { executionId: run.executionId, error } }));
      }
    },
    // With an `onOutcome` owner (the cloud adapter's tail) the row is NOT written here: it hands the COUNTS over, and the one writer
    // (`cloudOutcomeRow`) records the row at the terminal transition. A sink with no owner records the agent's row itself.
    outcome(outcome: RunOutcomeRow) {
      if (onOutcome) { onOutcome(outcome); return; }
      return write({ toolName: 'run.outcome', category: 'run', detail: { ...outcome }, result: `${outcome.terminalStatus} after ${outcome.steps} step(s)` });
    },
  };
}

/** The durable human channel (see the file header for who creates the approval). */
export function durableHuman(env: Env, db: Db, run: CloudRunRefs): HumanChannel {
  return {
    ask: async () => ({ kind: 'paused' }),
    approve: async (gate, call) => {
      // The retried call of a run that parked on this approval: read the approval's STRUCTURED status — never the answer's words.
      if (call?.approvalId) {
        const [row] = await db.select({ status: approvals.status, reviewNote: approvals.reviewNote }).from(approvals)
          .where(and(eq(approvals.id, call.approvalId), eq(approvals.tenantId, run.tenantId))).limit(1);
        if (row?.status === 'approved') return { kind: 'answered', answer: row.reviewNote ?? '', approved: true };
        if (row?.status === 'rejected') return { kind: 'answered', answer: row.reviewNote ?? '', approved: false };
        return { kind: 'paused', approvalId: call.approvalId }; // still pending: park again on the SAME approval
      }
      const { approvalId } = await pauseExecutionForQuestion(env, db, {
        tenantId: run.tenantId, executionId: run.executionId, taskId: run.taskId, projectId: run.projectId,
        ...(run.cloudAgentRef ? { cloudAgentRef: run.cloudAgentRef } : {}),
        agentLabel: run.agentLabel,
        question: `Approve the agent's use of "${call?.tool ?? gate.tool ?? 'this tool'}"? ${call?.reason ?? gate.reason ?? ''}`.trim(),
        // Same surface, same record: a governance park and an `ask_human` park are the same pause, so a
        // gated run also lands in needs-attention and restores its lane on resume.
        context: `Governance gate "${gate.id}" requires human approval before this tool may run with these arguments: ${JSON.stringify(call?.args ?? {}).slice(0, 500)}`,
        kind: 'approval',
        surface: 'durable',
      });
      return { kind: 'paused', approvalId };
    },
  };
}

/**
 * The execution's pending steers, drained at each step boundary. `stepOf` names the step for the timeline row. A steer is
 * delivered exactly once because DRAINING it stamps it consumed (`pullPendingSteering`) — that, not a comparison against the
 * transcript, is the dedupe: two identical steers (a second "Approved.") are two steers, and both reach the run.
 */
export function pendingSteering(db: Db, run: CloudRunRefs, stepOf: () => number): SteeringSource {
  return {
    drain: () => applyPendingSteering(db, { ...base(run), messages: [], step: stepOf() }),
  };
}
