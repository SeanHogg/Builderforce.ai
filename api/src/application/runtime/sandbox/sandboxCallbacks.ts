/**
 * What a run SANDBOX may say back to the Worker — the whole vocabulary.
 *
 * A sandbox runs no loop, so it has nothing to ask the Worker to decide: no model turn,
 * no commit, no finalize. Every one of those lives in the one engine. What is left is
 * the sandbox reporting what its own local services did (`event`), and — for the GitHub
 * Actions runner, which cannot be called and so PULLS — its spec and the engine's next
 * request (`spec`, `sandbox_next`, `sandbox_result`, `sandbox_status`).
 *
 * The container's live preview reports through its own op, answered by the preview
 * vertical before this module (`runtimeRoutes`).
 */
import { ExecutionStatus } from '../../../domain/shared/types';
import { TERMINAL_EXECUTION_STATUSES } from '../../../domain/execution/Execution';
import { executions } from '../../../infrastructure/database/schema';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../infrastructure/database/connection';
import type { Env } from '../../../env';
import { integrationCredentialSecret } from '../../integrations/integrationCredentialSecret';
import { resolveTicketRepoContext } from '../../repos/commitFileAsPendingChange';
import { recordCloudToolEvent } from '../cloudToolEvents';
import { cloudRunnerStub } from '../cloudRunnerStub';
import { sandboxLevers } from '../costLoop/runLevers';
import { isExecutionCancelled, type SandboxRunContext } from '../cloudAgent/runContext';

export interface SandboxCallbackResult {
  status: number;
  body: unknown;
}

/** A sandbox's timeline event (its clone, its post-edit checks, its preview). */
async function recordSandboxEvent(db: Db, ctx: SandboxRunContext, executionId: number, args: Record<string, unknown>): Promise<SandboxCallbackResult> {
  await recordCloudToolEvent(db, {
    tenantId: ctx.tenantId, cloudAgentRef: ctx.cloudAgentRef, executionId,
    toolName: String(args.toolName ?? 'tool'), category: String(args.category ?? 'tool'),
    toolCallId: typeof args.toolCallId === 'string' ? args.toolCallId : undefined,
    detail: args.detail, result: typeof args.result === 'string' ? args.result : undefined,
    durationMs: typeof args.durationMs === 'number' ? args.durationMs : undefined,
  });
  return { status: 200, body: { ok: true } };
}

/** The Actions runner's spec: what its sandbox obeys and which branch it serves. */
async function runnerSpec(env: Env, db: Db, ctx: SandboxRunContext, executionId: number): Promise<SandboxCallbackResult> {
  const [row] = await db.select({ status: executions.status }).from(executions)
    .where(and(eq(executions.id, executionId), eq(executions.tenantId, ctx.tenantId))).limit(1);
  // A queued job may start after the run ended (cancelled, failed, reaped): refuse any
  // terminal status, and the runner exits instead of working on a concluded run.
  if (!row || TERMINAL_EXECUTION_STATUSES.includes(row.status as ExecutionStatus)) {
    return { status: 409, body: { error: 'Execution had already ended before the runner started.' } };
  }
  const repo = await resolveTicketRepoContext(db, integrationCredentialSecret(env), ctx.tenantId, ctx.taskId);
  return {
    status: 200,
    body: {
      executionId,
      ...sandboxLevers(env, ctx.tenantId),
      // No clone URL: actions/checkout already cloned, and the workflow's GITHUB_TOKEN is
      // what authorises a fetch or push — no credential of ours reaches the runner.
      repo: repo.ok ? { baseBranch: repo.ctx.base, headBranch: repo.ctx.branch } : null,
    },
  };
}

/** Relay a runner poll or result to the run's CloudRunnerDO, which holds the mailbox. */
async function toRunner(env: Env, executionId: number, path: '/sandbox/next' | '/sandbox/result', body: unknown): Promise<SandboxCallbackResult> {
  if (!env.CLOUD_RUNNER) return { status: 503, body: { error: 'no durable runner is bound' } };
  const res = await cloudRunnerStub(env.CLOUD_RUNNER, executionId).fetch(`https://cloud-runner${path}`, { method: 'POST', body: JSON.stringify(body ?? {}) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

export async function handleSandboxCallback(
  env: Env,
  db: Db,
  ctx: SandboxRunContext,
  executionId: number,
  op: string,
  args: Record<string, unknown>,
): Promise<SandboxCallbackResult> {
  switch (op) {
    case 'event': return recordSandboxEvent(db, ctx, executionId, args);
    case 'spec': return runnerSpec(env, db, ctx, executionId);
    case 'sandbox_next': return toRunner(env, executionId, '/sandbox/next', {});
    case 'sandbox_result': return toRunner(env, executionId, '/sandbox/result', { id: args.id, result: args.result });
    // A running command polls this so a cancel kills it instead of waiting it out.
    case 'sandbox_status': return { status: 200, body: { cancelled: await isExecutionCancelled(db, executionId) } };
    default: return { status: 400, body: { error: `unknown op '${op}'` } };
  }
}
