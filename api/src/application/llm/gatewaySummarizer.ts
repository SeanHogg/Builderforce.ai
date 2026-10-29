/**
 * gatewaySummarizer — the cloud's summary model for compaction (PRD 35 WS3): the SURFACE half
 * of compaction. The fold itself (when to compact, what to keep, the reserve) is the agent's
 * (`policy/compaction`); this is the gateway-backed `CompactionSummarizer` the cloud binds it
 * with — a single non-streaming completion on the free pool, or on an admitted specialist
 * (cost lever E2). Moved out of the retired `compactMessages.ts` twin.
 */
import { compactionSummaryRequest, type CompactionSummarizer } from '@builderforce/agent-run';
import type { Env } from '../../env';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { ideProxy, readProxyChoice } from './LlmProxyService';
import { resolveSpecialist } from './specialists/resolveSpecialist';
import { captureSpecialistSample, type SpecialistRequest } from './specialists/evalCaseStore';

export { compactionSummaryRequest };

/** The tenant id as the eval-case store keys it (a numeric tenant), or null. */
function numericTenant(tenantId: string | number | null | undefined): number | null {
  const n = typeof tenantId === 'string' ? Number(tenantId) : tenantId;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
}

/** One summary completion on the free gateway — pinned to `model` when given. */
async function summarizeOn(env: Env, request: SpecialistRequest, model?: string): Promise<string | null> {
  try {
    const result = await ideProxy(env).complete({
      ...request,
      ...(model ? { model, modelStrict: true } : {}),
      temperature: 0,
    });
    if (result.response.status >= 400) return null;
    const { content } = await readProxyChoice(result);
    return content ? content : null;
  } catch (error) {
    reportCaughtError(error, { source: 'application/llm/gatewaySummarizer.ts', operation: 'summarizeOn', context: { model: model ?? null } });
    return null;
  }
}

/**
 * Build the gateway-backed {@link CompactionSummarizer} — the live "builder memory"
 * compressor. Runs a single non-streaming completion on the FREE pool (cheap), with
 * the same intent as BrainService's chat summariser. Returns null on any failure so
 * compaction degrades to elision rather than breaking the run.
 *
 * Cost lever E2: when a specialist is admitted for `compaction_summary`
 * (`specialists/resolveSpecialist`), the summary is asked of that model first (strict
 * pin); its failure falls back to the free pool, so the lever can only save. While no
 * specialist serves, a sampled share of the requests is kept as the job's eval set.
 */
export function buildGatewaySummarizer(env: Env): CompactionSummarizer {
  return async (conversationText: string, ctx) => {
    const request = compactionSummaryRequest(conversationText);
    const specialist = await resolveSpecialist(env, ctx?.tenantId ?? null, 'compaction_summary');
    if (specialist) {
      const fromSpecialist = await summarizeOn(env, request, specialist.model);
      if (fromSpecialist) return fromSpecialist;
    }
    const summary = await summarizeOn(env, request);
    if (summary && !specialist) {
      void captureSpecialistSample(env, { jobId: 'compaction_summary', tenantId: numericTenant(ctx?.tenantId), request });
    }
    return summary;
  };
}
