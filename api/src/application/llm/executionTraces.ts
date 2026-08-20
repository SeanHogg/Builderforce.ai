/**
 * A cloud run's LLM turns, read from the diagnostic trace table.
 *
 * A run's model and token facts existed in three places and were READABLE in none
 * of them: `llm_usage_log` had the tokens but not the cascade, `tool_audit_events`
 * had the model buried inside a JSON `args` string that only the UI knew how to
 * parse, and `llm_traces` had everything — with no way to say which run a row
 * belonged to. Migration 0949 adds `llm_traces.execution_id` and the cloud engine
 * stamps it, so "this run's turns" is now one indexed read.
 *
 * What this returns is deliberately the SUMMARY projection, not the row: an
 * `llm_traces` row also holds the full request/response bodies, which are
 * builder-side-only (superadmin) data. The trace id travels so a superadmin can
 * open the full row in /admin; everything else here is the structured
 * model + token detail a tenant is entitled to see about their own run.
 */
import { asc, eq } from 'drizzle-orm';
import { buildTransactionalDatabase } from '../../infrastructure/database/connection';
import { llmTraces } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { HonoEnv } from '../../env';

type Env = HonoEnv['Bindings'];

/** One traced LLM turn of a cloud run, as an execution surface may render it. */
export interface ExecutionLlmTurn {
  /** `llm-<uuid>` — the deep-link key into the superadmin trace viewer. */
  traceId: string;
  ts: string | null;
  model: string | null;
  vendor: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  status: number | null;
  success: boolean;
  outcome: string | null;
  /** The cascade this turn actually walked, when it walked more than one model. */
  candidateChain: string[] | null;
  errorMessage: string | null;
}

/** Hard ceiling so a runaway 500-step run can't return an unbounded array. */
const MAX_TURNS = 200;

function parseChain(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : null;
  } catch {
    return null;
  }
}

/**
 * The traced LLM turns of one execution, oldest first. Tenant-scoped.
 *
 * Best-effort by the same rule the writes follow: `llm_traces` lives in the
 * operational database, which is allowed to be unbound or briefly unavailable, and
 * a run's timeline must still render when it is. A failure returns no turns, never
 * an error.
 */
export async function listExecutionLlmTurns(
  env: Env,
  tenantId: number,
  executionId: number,
): Promise<ExecutionLlmTurn[]> {
  try {
    const rows = await buildTransactionalDatabase(env)
      .select({
        traceId:          llmTraces.traceId,
        createdAt:        llmTraces.createdAt,
        resolvedModel:    llmTraces.resolvedModel,
        resolvedVendor:   llmTraces.resolvedVendor,
        promptTokens:     llmTraces.promptTokens,
        completionTokens: llmTraces.completionTokens,
        totalTokens:      llmTraces.totalTokens,
        durationMs:       llmTraces.durationMs,
        status:           llmTraces.status,
        success:          llmTraces.success,
        outcome:          llmTraces.outcome,
        candidateChain:   llmTraces.candidateChain,
        errorMessage:     llmTraces.errorMessage,
      })
      .from(llmTraces)
      .where(scopedToTenant(llmTraces, tenantId, eq(llmTraces.executionId, executionId)))
      .orderBy(asc(llmTraces.createdAt))
      .limit(MAX_TURNS);

    return rows.map((r) => ({
      traceId:          r.traceId,
      ts:               r.createdAt ? r.createdAt.toISOString() : null,
      model:            r.resolvedModel,
      vendor:           r.resolvedVendor,
      promptTokens:     r.promptTokens ?? 0,
      completionTokens: r.completionTokens ?? 0,
      totalTokens:      r.totalTokens ?? 0,
      durationMs:       r.durationMs ?? 0,
      status:           r.status,
      success:          r.success === true,
      outcome:          r.outcome,
      candidateChain:   parseChain(r.candidateChain),
      errorMessage:     r.errorMessage,
    }));
  } catch (error) {
    reportCaughtError(error, { source: 'application/llm/executionTraces.ts', operation: 'listExecutionLlmTurns' });
    return [];
  }
}
