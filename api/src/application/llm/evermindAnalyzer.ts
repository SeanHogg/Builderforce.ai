/**
 * Evermind knowledge ANALYZER — audit what a project's Evermind has learned, decide
 * which of it is wrong, and repair it.
 *
 * The learning loop is write-only from the operator's point of view: runs, teaches and
 * imports pour exemplars into the model, and nothing ever asks "is any of this
 * actually correct?". A single bad exemplar (a run that ended in a wrong conclusion, a
 * teacher fault that recorded the question as its own answer, knowledge that has since
 * gone stale) is learned exactly as confidently as a good one and then recalled forever.
 *
 * This module closes that loop:
 *   1. CHEAP LOCAL SCREEN — every memory is graded by the shared coherence gate first.
 *      Garbage is provably garbage without spending a frontier token.
 *   2. FRONTIER REVIEW — the remaining memories go to the project's pinned TEACHER (or,
 *      unpinned, the gateway's premium cascade) in ONE batched call that returns a
 *      verdict + a corrected answer per memory.
 *   3. REPAIR — applying a finding FORGETS the bad memory (it leaves the recall ring, so
 *      it can never ground another reply) and RE-TEACHES the correction against the same
 *      task prompt, which is how write-through cognition supersedes knowledge: update ==
 *      replace. A closing flush merges the corrections into a new version.
 *
 * Analysis is READ-ONLY unless the caller explicitly applies findings, so an operator
 * always sees what would change before anything does.
 */
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { llmProxyForPlan, readProxyChoice } from './LlmProxyService';
import { resolveTenantLlmCredentials } from './tenantProviderKeyService';
import { resolveEvermindTeacherModel } from './evermindTeacher';
import { assessTextCoherence } from './textCoherence';
import {
  getProjectEvermindContributions,
  getProjectEvermindHead,
  listProjectEvermindMemories,
  dispatchProjectEvermindLearnText,
  forgetProjectEvermindMemories,
  flushProjectEvermind,
  type ProjectEvermindRecentEntry,
} from './projectEvermind';

/**
 * How many learned memories one analysis pass reviews.
 *
 * This was 24 because that was the whole inspection ring — everything older was
 * invisible to the audit while still being in the weights and still recallable. The
 * coordinator now stores every memory durably under its own key, so the audit walks
 * the real history and this is a per-PASS budget (frontier prompt size + review cost),
 * not a horizon. A project with more memories than this is audited over several
 * passes, oldest-unreviewed continuing from `before`.
 */
export const ANALYZE_MAX_MEMORIES = 120;
/** Chars of each memory sent for review — enough to judge, capped for cost. */
const MEMORY_EXCERPT_CHARS = 900;
/** Chars of a memory echoed back in the finding for display. */
const DISPLAY_EXCERPT_CHARS = 400;
/** Output ceiling for the review call (verdicts + corrections for one pass's memories). */
const ANALYZE_MAX_OUTPUT_TOKENS = 4096;
/** How many memories go to the frontier auditor in ONE call. The local coherence
 *  screen runs over the whole pass for free; only what survives it is batched here,
 *  so a long history costs several review calls rather than one oversized prompt
 *  that would be truncated (silently dropping memories from the audit). */
const REVIEW_BATCH_SIZE = 24;

/**
 * What is wrong with a learned memory.
 *   `ok`        — sound; leave it alone.
 *   `incoherent`— not language / not an answer (the local screen catches these free).
 *   `incorrect` — factually wrong or self-contradictory.
 *   `outdated`  — was true, has been superseded by later knowledge in the same model.
 *   `unusable`  — a fault artefact: the question recorded as its own answer, an error
 *                 message, a truncated fragment. Nothing to correct — just forget it.
 *   `redundant` — duplicates another memory; keeping both dilutes recall.
 */
export type KnowledgeVerdict = 'ok' | 'incoherent' | 'incorrect' | 'outdated' | 'unusable' | 'redundant';

/** Verdicts that mean "this memory should not stay as it is". */
const ACTIONABLE: ReadonlySet<KnowledgeVerdict> = new Set<KnowledgeVerdict>(['incoherent', 'incorrect', 'outdated', 'unusable', 'redundant']);

/** One reviewed memory. */
export interface KnowledgeFinding {
  /** The learned memory's stable ring id. */
  id: number;
  verdict: KnowledgeVerdict;
  /** One sentence on what is wrong (empty for `ok`). */
  issue: string;
  /** The task this memory answered, when known — the key the correction re-teaches under. */
  prompt?: string;
  /** Short excerpt of the memory AS IT STANDS, for display. */
  excerpt: string;
  /**
   * The corrected knowledge to learn in its place. Absent when the memory is sound, or
   * when it is unrepairable (`unusable`/`redundant`) — those are forgotten, not rewritten.
   */
  correction?: string;
  /** Who produced the verdict: the cheap local coherence screen, or the frontier model. */
  source: 'coherence-gate' | 'frontier';
}

/** The result of an analysis pass (no writes). */
export interface KnowledgeAnalysis {
  version: number;
  /** How many memories were reviewed. */
  analyzed: number;
  /** The frontier model that graded, or null when only the local screen ran. */
  model: string | null;
  findings: KnowledgeFinding[];
  /** How many memories the project holds in total. `analyzed` is what THIS pass
   *  reviewed; the two differ once a project has learned more than one pass's budget. */
  total: number;
  /** True when there is more history than this pass reviewed, so a reader is not
   *  told "clean" about a model whose older knowledge was never looked at. */
  truncated: boolean;
  /** Present when the frontier review could not run — the local screen's findings are
   *  still returned, so the pass degrades rather than failing. */
  warning?: string;
}

/** The result of APPLYING findings — what was actually repaired. */
export interface KnowledgeRepairResult {
  /** Memories re-taught with corrected knowledge. */
  corrected: number;
  /** Memories dropped from the recall ring (unrepairable or superseded). */
  forgotten: number;
  /** Contributions merged by the closing flush. */
  merged: number;
  /** The model version after the flush. */
  version: number;
  /** Ids that could not be applied, with the reason. */
  skipped: Array<{ id: number; reason: string }>;
}

const ANALYZER_SYSTEM =
  'You are auditing the knowledge a small self-learning model has absorbed about ONE software project. '
  + 'Each item is a memory the model learned: a task prompt (sometimes absent) and the answer text it learned. '
  + 'For each item decide whether the knowledge is sound and, when it is not, write the corrected knowledge.\n\n'
  + 'Verdicts:\n'
  + '- "ok": sound, useful knowledge. Leave it.\n'
  + '- "incorrect": factually wrong, self-contradictory, or bad advice.\n'
  + '- "outdated": was true but a LATER item in this same list supersedes it.\n'
  + '- "unusable": not usable knowledge at all — the question recorded as its own answer, '
  + 'an error message, a stack trace, a truncated fragment, or pure noise.\n'
  + '- "redundant": says the same thing as another item; keeping both dilutes recall.\n\n'
  + 'Rules:\n'
  + '- Judge only what you can see. If an item is plausible and you have no evidence against it, it is "ok".\n'
  + '- Provide "correction" ONLY for "incorrect" or "outdated": the full corrected answer, standalone, '
  + 'in the same voice and roughly the same length. Never provide a correction for "unusable" or "redundant".\n'
  + '- "issue" is ONE short sentence naming the problem. Omit it for "ok".\n\n'
  + 'Respond with STRICT JSON and nothing else: '
  + '{"findings":[{"id":<number>,"verdict":"ok|incorrect|outdated|unusable|redundant","issue":"...","correction":"..."}]}. '
  + 'Include every id you were given exactly once.';

/** Pull the first JSON object out of a model reply that may be fenced or prefaced. */
function parseAnalyzerJson(raw: string): { findings?: unknown } | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as { findings?: unknown };
  } catch {
    return null;
  }
}

function toVerdict(x: unknown): KnowledgeVerdict | null {
  return typeof x === 'string' && ['ok', 'incoherent', 'incorrect', 'outdated', 'unusable', 'redundant'].includes(x)
    ? (x as KnowledgeVerdict)
    : null;
}

/** The text a memory actually carries (the learned answer, else the task). */
function memoryText(e: ProjectEvermindRecentEntry): string {
  return (e.text ?? '').trim() || (e.prompt ?? '').trim();
}

function excerpt(s: string, max = DISPLAY_EXCERPT_CHARS): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/**
 * Review what a project's Evermind has learned. Read-only.
 *
 * The local coherence screen runs first and its findings are FINAL for the memories it
 * condemns — they are not sent to the frontier model (no point paying to confirm that
 * gibberish is gibberish, and it keeps the audit useful even with no teacher, no budget
 * and no network).
 */
export async function analyzeProjectEvermindKnowledge(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  opts: { limit?: number; signal?: AbortSignal } = {},
): Promise<KnowledgeAnalysis> {
  const contrib = await getProjectEvermindContributions(env, db, tenantId, projectId);
  const limit = Math.min(Math.max(1, opts.limit ?? ANALYZE_MAX_MEMORIES), ANALYZE_MAX_MEMORIES);
  // Walk the REAL history, not the console's first page. `contrib.recent` is one page
  // (24 memories); auditing that alone left everything older unreviewable and
  // unforgettable while it was still in the weights.
  const history = await listProjectEvermindMemories(env, tenantId, projectId, { max: limit });
  // Only TEXT contributions carry inspectable knowledge; a weight delta has no text to audit.
  const memories = history.memories.filter((e) => e.kind === 'text' && memoryText(e).length > 0);
  const base: KnowledgeAnalysis = {
    version: contrib.version,
    analyzed: memories.length,
    model: null,
    findings: [],
    total: history.total,
    // True when the project holds more memories than one pass reviews — the caller
    // says so rather than implying the whole model was audited.
    truncated: history.truncated,
  };
  if (memories.length === 0) return base;

  // 1) Local screen — free, deterministic, and works with no frontier access at all.
  const findings: KnowledgeFinding[] = [];
  const forReview: ProjectEvermindRecentEntry[] = [];
  for (const m of memories) {
    const body = memoryText(m);
    const verdict = assessTextCoherence(body, { ...(m.prompt ? { context: m.prompt } : {}) });
    if (!verdict.coherent) {
      findings.push({
        id: m.id,
        verdict: 'incoherent',
        issue: `Not usable knowledge — ${verdict.detail}.`,
        ...(m.prompt ? { prompt: m.prompt } : {}),
        excerpt: excerpt(body),
        source: 'coherence-gate',
      });
      continue;
    }
    forReview.push(m);
  }
  if (forReview.length === 0) return { ...base, findings };

  // 2) Frontier review, in batches. `forReview` can now be the whole history rather
  // than one 24-entry page, and a single prompt carrying all of it would be truncated
  // upstream — which drops memories from the audit SILENTLY, the exact failure this
  // work exists to remove. One call per batch; a failing batch degrades that batch
  // only, and the local screen's findings always stand.
  const teacher = await resolveEvermindTeacherModel(env, db, tenantId, contrib.teacherModel);
  const creds = await resolveTenantLlmCredentials(env, tenantId).catch(() => null);
  const proxy = llmProxyForPlan(env, 'pro', true, {
    ...(creds?.anthropicOAuthToken ? { anthropicOAuthToken: creds.anthropicOAuthToken } : {}),
    ...(creds && Object.values(creds.vendorKeys).some(Boolean) ? { tenantVendorKeys: creds.vendorKeys } : {}),
  });

  let resolvedModel: string | null = null;
  const warnings: string[] = [];
  for (let i = 0; i < forReview.length; i += REVIEW_BATCH_SIZE) {
    const batch = forReview.slice(i, i + REVIEW_BATCH_SIZE);
    const items = batch.map((m) => ({
      id: m.id,
      task: excerpt(m.prompt ?? '', 300) || null,
      learned: excerpt(memoryText(m), MEMORY_EXCERPT_CHARS),
    }));
    try {
      const result = await proxy.complete(
        {
          ...(teacher.model ? { model: teacher.model } : {}),
          messages: [
            { role: 'system', content: ANALYZER_SYSTEM },
            {
              role: 'user',
              content: `Project #${projectId} — Evermind v${contrib.version}. Audit these ${items.length} learned memories:

`
                + JSON.stringify(items, null, 1),
            },
          ],
          temperature: 0.1,
          max_tokens: ANALYZE_MAX_OUTPUT_TOKENS,
          response_format: { type: 'json_object' },
          useCase: 'task_execution',
        } as never,
        undefined,
        undefined,
        opts.signal,
      );
      if (result.response.status >= 400) {
        warnings.push(`HTTP ${result.response.status}`);
        continue;
      }
      const { content } = await readProxyChoice(result);
      const parsed = parseAnalyzerJson(content);
      if (!parsed || !Array.isArray(parsed.findings)) {
        warnings.push('unusable JSON');
        continue;
      }
      resolvedModel = result.resolvedModel || teacher.model || resolvedModel;

      const byId = new Map(batch.map((m) => [m.id, m]));
      for (const raw of parsed.findings) {
        if (!raw || typeof raw !== 'object') continue;
        const r = raw as Record<string, unknown>;
        const id = typeof r['id'] === 'number' ? r['id'] : NaN;
        const memory = byId.get(id);
        const verdict = toVerdict(r['verdict']);
        if (!memory || !verdict || verdict === 'ok') continue;
        const correction = typeof r['correction'] === 'string' ? r['correction'].trim() : '';
        findings.push({
          id,
          verdict,
          issue: typeof r['issue'] === 'string' && r['issue'].trim() ? r['issue'].trim() : 'Flagged by the knowledge review.',
          ...(memory.prompt ? { prompt: memory.prompt } : {}),
          excerpt: excerpt(memoryText(memory)),
          // A correction only makes sense for knowledge that has a right answer; the
          // model is told this, and it is enforced here so a stray correction on an
          // `unusable` row can't be re-taught.
          ...(correction && (verdict === 'incorrect' || verdict === 'outdated') ? { correction } : {}),
          source: 'frontier',
        });
      }
    } catch (err) {
      warnings.push(err instanceof Error ? err.message : String(err));
    }
  }

  const reviewed = Math.max(0, forReview.length - warnings.length * REVIEW_BATCH_SIZE);
  return {
    ...base,
    model: resolvedModel,
    findings,
    // Name how much of the pass the frontier actually graded — a partial review must
    // not read as a clean bill of health for the batches that never ran.
    ...(warnings.length > 0
      ? { warning: `${warnings.length} of ${Math.ceil(forReview.length / REVIEW_BATCH_SIZE)} review batches did not complete (${[...new Set(warnings)].slice(0, 3).join('; ')}); ~${reviewed} of ${forReview.length} memories were graded by the model, the rest only by the local coherence screen.` }
      : {}),
  };
}

/**
 * APPLY findings — the repair half.
 *
 * For each actionable finding: forget the bad memory (it leaves the recall ring, so it
 * stops grounding replies immediately) and, when a correction exists, re-teach it under
 * the SAME task prompt so the model relearns the right answer for that question. One
 * closing flush merges the corrections into a new version rather than leaving them
 * queued behind the debounce window, so "Fix" is done when it says it is.
 *
 * Only ids present in `findings` are touched, and a finding with no correction is only
 * ever forgotten — this never invents knowledge.
 */
export async function applyKnowledgeRepairs(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  findings: KnowledgeFinding[],
): Promise<KnowledgeRepairResult> {
  const head = await getProjectEvermindHead(env, db, tenantId, projectId);
  const skipped: Array<{ id: number; reason: string }> = [];
  const actionable = findings.filter((f) => ACTIONABLE.has(f.verdict));
  if (actionable.length === 0) return { corrected: 0, forgotten: 0, merged: 0, version: head.version, skipped };
  if (head.mode !== 'connected') {
    return {
      corrected: 0,
      forgotten: 0,
      merged: 0,
      version: head.version,
      skipped: actionable.map((f) => ({ id: f.id, reason: 'learning is frozen — set this Evermind to Connected before applying fixes' })),
    };
  }

  // Re-teach corrections first, serialized: the coordinator is a single DO that adapts
  // each exemplar in its alarm, so concurrency here only contends on the same lock.
  let corrected = 0;
  for (const f of actionable) {
    const correction = f.correction?.trim();
    if (!correction) continue;
    const res = await dispatchProjectEvermindLearnText(env, tenantId, projectId, correction, undefined, f.prompt ?? undefined);
    if (res.ok) { corrected++; continue; }
    const err = res.body['error'];
    skipped.push({ id: f.id, reason: typeof err === 'string' ? err : `could not re-teach (${res.status})` });
  }

  // Then forget every bad memory in one call — including the ones just corrected, whose
  // replacement is already queued. This is the "replace" half of write-through: the old
  // knowledge must not survive alongside its correction.
  const forgetIds = actionable.filter((f) => !skipped.some((s) => s.id === f.id)).map((f) => f.id);
  const forget = await forgetProjectEvermindMemories(env, tenantId, projectId, forgetIds);
  const forgotten = typeof forget.body['forgotten'] === 'number' ? (forget.body['forgotten'] as number) : 0;

  // Merge now so the corrections are real weights, not a queue entry.
  let merged = 0;
  let version = head.version;
  if (corrected > 0) {
    const flush = await flushProjectEvermind(env, tenantId, projectId);
    if (flush.ok) {
      merged = typeof flush.body['merged'] === 'number' ? (flush.body['merged'] as number) : 0;
      version = typeof flush.body['version'] === 'number' ? (flush.body['version'] as number) : head.version;
    }
  }
  return { corrected, forgotten, merged, version, skipped };
}
