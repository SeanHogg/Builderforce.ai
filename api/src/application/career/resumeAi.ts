/**
 * Résumé AI — the model-assisted use cases, sitting ON TOP of the deterministic half.
 *
 * ── THE ORDER MATTERS ────────────────────────────────────────────────────────────
 * Every method here runs the deterministic function FIRST and hands its structured
 * output to the model as grounding. It never replaces it. `scoreResume` still decides
 * which bullets are weak, `consolidateResumes` still decides which bullets are the same
 * accomplishment, and `resumeAiPrompts` still verifies whatever comes back. The model
 * supplies wording and judgement; it is not allowed to supply facts.
 *
 * That ordering is also what makes the failure mode benign. If the proxy 502s, the model
 * returns prose instead of JSON, or the tenant has no plan at all, every method here
 * still returns the deterministic reading with `degraded: true` — which is the same
 * answer the tool catalog has always given, arrived at with one wasted call. A résumé
 * tool that shows nothing when the model is down would be worse than the one that
 * existed before it.
 *
 * ── WHAT IS CACHED, AND WHY THAT IS ALLOWED ──────────────────────────────────────
 * An LLM call is not a cacheable read. This one is, because the key is CONTENT-ADDRESSED:
 * a SHA-256 over the exact inputs (capability, résumé text, job description, limit) plus
 * the tenant, since the tenant decides which model the cascade reaches. Same bytes in,
 * same bytes out — asking twice about an unchanged document is not a second question.
 *
 * What is stored is the model's RAW reply, not the finished verdict. Verification lives
 * in `resumeAiPrompts` and gets tightened; freezing its output in KV would mean a
 * fabricated metric caught by today's guard still being served from a cache filled by
 * yesterday's. Re-parsing a cached string costs microseconds and keeps the guard live.
 */

import { completeForTenant, TenantAiService } from '../llm/tenantProxy';
import { readProxyChoice } from '../llm/LlmProxyService';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';
import { scoreResume, type ResumeScore } from './resumeAnalysis';
import {
  buildBulletMergePrompt, buildGradePrompt, buildXyzRewritePrompt,
  parseBulletMergeResponse, parseGradeResponse, parseXyzRewriteResponse,
  planBulletMerge, planXyzRewrite,
  type BulletMergeBrief, type BulletMergeResult, type ResumeGrade,
  type XyzRewriteBrief, type XyzRewriteResult,
} from './resumeAiPrompts';

/** Bumped when a PROMPT changes — a cached reply to a superseded prompt is not an answer. */
const PROMPT_VERSION = 'v1';
/** Long enough that a person iterating on one document pays for one call, short enough
 *  that a model improvement reaches them the same day. */
const CACHE_TTL_SECONDS = 3600;

/** What every capability reports about HOW the answer was reached. */
export interface AiProvenance {
  /** The model the cascade actually resolved to, when the call was made. */
  model: string | null;
  /** True when only the deterministic half is present — the model call did not land. */
  degraded: boolean;
  /** Why it degraded, in a sentence for the person reading the screen. */
  degradedReason?: string;
  /** True when the reply came from the content-addressed cache rather than a fresh call. */
  cached: boolean;
}

export interface XyzRewriteOutcome extends AiProvenance {
  brief: XyzRewriteBrief;
  result: XyzRewriteResult;
}

export interface BulletMergeOutcome extends AiProvenance {
  brief: BulletMergeBrief;
  result: BulletMergeResult;
}

export interface ResumeGradeOutcome extends AiProvenance {
  grade: ResumeGrade;
}

interface ModelReply {
  content: string;
  model: string | null;
  cached: boolean;
  failure: string | null;
}

/**
 * The model-assisted résumé capabilities for one tenant.
 *
 * Extends {@link TenantAiService} rather than reaching for a proxy directly, so the
 * tenant's connected BYO account is honoured and no model id is pinned here — the
 * cascade picks. A second LLM client in this domain is exactly the drift that base class
 * exists to prevent.
 */
export class ResumeAiService extends TenantAiService {
  constructor(env: Env) {
    super(env);
  }

  /**
   * Rewrite the weak bullets into "accomplished [X] as measured by [Y], by doing [Z]".
   *
   * Only the bullets the deterministic pass flagged are sent. A bullet that already owns
   * its verb, carries a number and names a method is left completely alone: rewriting it
   * would spend a model call to move words around a line that already works.
   */
  async rewriteToXyz(tenantId: number, resumeText: string, opts?: { limit?: number; userId?: string | null }): Promise<XyzRewriteOutcome> {
    const brief = planXyzRewrite(resumeText, opts?.limit == null ? undefined : { limit: opts.limit });
    if (brief.candidates.length === 0) {
      return {
        brief,
        result: {
          rewrites: [], accepted: 0, refusedForInventedMetric: 0,
          instruction: 'Every bullet already carries an ownership verb, a number and a method. There is nothing here worth a rewrite.',
        },
        model: null, degraded: false, cached: false,
      };
    }

    const prompt = buildXyzRewritePrompt(brief);
    const reply = await this.ask(tenantId, 'resume_xyz_rewrite', prompt, [resumeText, String(brief.candidates.length)], opts?.userId);
    if (reply.failure) {
      return { brief, result: parseXyzRewriteResponse('', brief), model: null, degraded: true, degradedReason: reply.failure, cached: false };
    }
    return { brief, result: parseXyzRewriteResponse(reply.content, brief), model: reply.model, degraded: false, cached: reply.cached };
  }

  /**
   * Merge the near-duplicate bullets that accumulate across versions of one résumé.
   *
   * `consolidateResumes` finds the groups AND the bullets that exist in only one source;
   * the second half is the one a hand-merge loses and no model is asked about it. Only
   * the merged WORDING of a group needs writing.
   */
  async mergeBullets(tenantId: number, resumeTexts: readonly string[], opts?: { userId?: string | null }): Promise<BulletMergeOutcome> {
    const brief = planBulletMerge(resumeTexts);
    if (brief.groups.length === 0) {
      return {
        brief,
        result: {
          merged: [], accepted: 0, refusedForInventedMetric: 0,
          uniqueBullets: brief.consolidation.uniqueBullets,
          mergedSkills: brief.consolidation.mergedSkills,
          instruction: 'No bullet appears in more than one of these documents, so there is nothing to merge — keep every line and union the skills.',
        },
        model: null, degraded: false, cached: false,
      };
    }

    const prompt = buildBulletMergePrompt(brief);
    const reply = await this.ask(tenantId, 'resume_bullet_merge', prompt, resumeTexts, opts?.userId);
    if (reply.failure) {
      return { brief, result: parseBulletMergeResponse('', brief), model: null, degraded: true, degradedReason: reply.failure, cached: false };
    }
    return { brief, result: parseBulletMergeResponse(reply.content, brief), model: reply.model, degraded: false, cached: reply.cached };
  }

  /**
   * Grade a résumé twice — once by counting, once by reading — and report both.
   *
   * The model is held to the SAME five categories `scoreResume` uses, which is the whole
   * point: two answers on one scale can be compared, and where they diverge the divergence
   * is the finding. Two answers on two different scales would just be two opinions.
   */
  async gradeResume(tenantId: number, resumeText: string, jobDescription?: string, opts?: { userId?: string | null }): Promise<ResumeGradeOutcome> {
    const score = scoreResume(resumeText);
    const prompt = buildGradePrompt(score, jobDescription);
    const reply = await this.ask(tenantId, 'resume_grade', prompt, [resumeText, jobDescription ?? ''], opts?.userId);
    if (reply.failure) {
      return { grade: parseGradeResponse('', score), model: null, degraded: true, degradedReason: reply.failure, cached: false };
    }
    return { grade: parseGradeResponse(reply.content, score), model: reply.model, degraded: false, cached: reply.cached };
  }

  /** The deterministic reading on its own — what every capability falls back to. */
  measure(resumeText: string): ResumeScore {
    return scoreResume(resumeText);
  }

  /**
   * One model call, content-addressed, metered, and never allowed to throw.
   *
   * The `inputs` are what the cache key is a hash OF — not the rendered prompt, because a
   * prompt that changes for reasons unrelated to the inputs (a typo fix) should not
   * silently invalidate every tenant's cache. `PROMPT_VERSION` is the deliberate lever
   * for the times it should.
   */
  private async ask(
    tenantId: number,
    useCase: string,
    prompt: { system: string; user: string },
    inputs: readonly string[],
    userId?: string | null,
  ): Promise<ModelReply> {
    let cached = true;
    try {
      const key = `career-ai:${useCase}:${PROMPT_VERSION}:${tenantId}:${await fingerprint(inputs)}`;
      const stored = await getOrSetCached(this.aiEnv, key, async () => {
        cached = false;
        const result = await completeForTenant(this.aiEnv, tenantId, {
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2,
          max_tokens: 3000,
          useCase,
        }, { meterUseCase: useCase, userId: userId ?? null });
        if (result.response.status >= 400) throw new ModelUnavailableError(`The model service answered ${result.response.status}.`);
        const choice = await readProxyChoice(result);
        if (!choice.content) throw new ModelUnavailableError('The model returned an empty reply.');
        return { content: choice.content, model: result.resolvedModel ?? null };
      }, { kvTtlSeconds: CACHE_TTL_SECONDS });
      return { content: stored.content, model: stored.model, cached, failure: null };
    } catch (error) {
      // Never rethrown: the deterministic half is a complete, useful answer on its own,
      // and turning a model outage into a 500 would take the working half down with it.
      // The reason travels back to the caller as `degradedReason` so the screen can say
      // what happened instead of quietly showing less.
      const failure = error instanceof ModelUnavailableError
        ? error.message
        : `The model call failed: ${error instanceof Error ? error.message : String(error)}`;
      return { content: '', model: null, cached: false, failure };
    }
  }
}

/** A model outage, distinguished from a programming error so the message can be plain. */
class ModelUnavailableError extends Error {}

/** SHA-256 over the exact inputs — the content address a cached model reply is keyed by. */
async function fingerprint(inputs: readonly string[]): Promise<string> {
  const encoded = new TextEncoder().encode(inputs.join('\u0000'));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 40);
}
