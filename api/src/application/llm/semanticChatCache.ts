/**
 * B2 — the semantic cache on the gateway's OWN completion path.
 *
 * `semanticCache.ts` (the LSH index) was reachable only through `/v1/semantic-cache`,
 * so a paraphrase of a question the gateway had just answered was re-billed unless the
 * client did its own embedding round trip. This step puts it beside the exact-match
 * cache in `completeChat`: exact repeat → hash + L1; paraphrase → one embedding + four
 * bucket reads.
 *
 * ── WHAT MAY BE ANSWERED ─────────────────────────────────────────────────────
 * Only what the exact tier already deems answerable from another request's bytes (an
 * idempotent `useCase`, no tools, no stream — `isCacheableRequest`) with the
 * temperature ceiling relaxed to {@link SEMANTIC_MAX_TEMPERATURE}. Never a chat turn.
 *
 * ── WHAT A MATCH IS ──────────────────────────────────────────────────────────
 * Meaning is matched on the LAST USER MESSAGE only. Everything before it (the system
 * instructions, any few-shot turns) plus the response format and sampling bounds is
 * matched EXACTLY, through a hash folded into the partition: two classifications with
 * one long shared rubric and different inputs would otherwise score as near-identical
 * on the rubric alone and swap answers.
 *
 * The partition is THE cache scope (`cacheScope`): tenant + project + principal/role +
 * model CLASS (a tier, not the exact id), so an answer never crosses a person or a
 * permission role, and a premium answer is never served to a free-tier request.
 *
 * ── WHEN A MATCH IS STALE ────────────────────────────────────────────────────
 * Each entry records the project-facts revision token and the file anchors (path +
 * content hash) the request declared. A candidate whose revision differs, or whose
 * anchored file now hashes differently, is skipped — the next candidate may still hold.
 *
 * Cosine bar {@link SEMANTIC_HIT_THRESHOLD}; candidates in
 * [{@link SEMANTIC_NEAR_MISS_FLOOR}, threshold) are logged (`semantic_cache.near_miss`)
 * so the bar can be tuned from data rather than guessed.
 *
 * Storage: the index entry's response is a POINTER to an exact-tier entry holding the
 * upstream body, so a hit is served by the same `readResponseCacheHit` as an exact hit
 * (same `response_cache_hit` outcome, never metered as spend) and buckets stay small.
 * Both writes carry the 7-day TTL.
 *
 * Index: KV, LSH-bucketed and bounded per bucket (`semanticCache.ts`). There is no
 * Vectorize binding in `api/wrangler.toml`; moving the index there needs that binding
 * plus a deploy.
 */

import type { Env } from '../../env';
import { stableStringify } from '@builderforce/agent-tools';
import { sha256Hex } from '../../infrastructure/crypto/digest';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { embedMemoryText } from '../memory/memoryEmbedding';
import { cacheScopeKey, principalScope, type CachePrincipal } from './cacheScope';
import { cacheEligibilityOf, isCacheableRequest, storeCachedResponse } from './responseCache';
import { readResponseCacheHit } from './proxyResponseCache';
import { SEMANTIC_CACHE_TTL_SECONDS, semanticCandidates, semanticStore, type SemanticEntryMeta } from './semanticCache';
import {
  anchorsAreStale,
  normalizeFileAnchors,
  projectFactsVersion,
  type FactFileAnchor,
  type FileContentHashReader,
} from './projectFactsStore';
import { canonicalModelId } from './modelPool';
import { tierForModel } from './vendors/registry';
import type { ChatCompletionRequest, ProxyEnv, ProxyResult } from './proxyTypes';

/** Cosine at/above which a paraphrase is served. */
export const SEMANTIC_HIT_THRESHOLD = 0.92;
/** Below the bar but at/above this: logged as a near miss for tuning. */
export const SEMANTIC_NEAR_MISS_FLOOR = 0.85;
/** The semantic tier's temperature ceiling (the exact tier's is lower). */
export const SEMANTIC_MAX_TEMPERATURE = 0.3;
/** Longest query text embedded — the classify family's inputs are short; a huge one is not a paraphrase. */
const MAX_QUERY_CHARS = 8_000;

/**
 * The caller's permission to cache (`CompleteOptions.responseCache`): the tenant the
 * call is billed to, plus whatever the caller knows about whose answer this is and what
 * it was grounded in. Every field past `tenantId` is optional; an absent principal is
 * the tenant-internal one.
 */
export interface ResponseCacheGrant {
  tenantId: number;
  projectId?: number | null;
  principal?: CachePrincipal | null;
  /** Files the answer depends on, with their CURRENT content hashes. */
  fileAnchors?: readonly FactFileAnchor[] | null;
  /** Reads a file's current hash, when the caller has a file store. */
  readFileHash?: FileContentHashReader;
}

/** Injected collaborators — real ones by default, fakes in tests. */
export interface SemanticChatDeps {
  embed?: (env: Env, text: string) => Promise<number[] | null>;
  factsRevision?: (env: Env, tenantId: number, projectId: number) => Promise<string>;
  log?: (line: Record<string, unknown>) => void;
}

/** One request's resolved semantic-cache plan. */
export interface SemanticChatPlan {
  tenantId: number;
  useCase: string;
  namespace: string;
  embedding: number[];
  /** The exact-tier key this request's answer is stored under, and the index points at. */
  pointerKey: string;
  /** What this request relies on — stored with its answer, compared against on lookup. */
  grounds: SemanticEntryMeta;
}

const asEnv = (env: ProxyEnv): Env => env as unknown as Env;

const defaultLog = (line: Record<string, unknown>): void => {
  // Structured single line — greppable in Workers logs as `semantic_cache.*`.
  console.log(JSON.stringify(line));
};

/**
 * A cache dependency that failed degrades to `fallback` (a miss, never a wrong hit),
 * and says so as `semantic_cache.dependency_failed` instead of swallowing the error.
 */
async function orMiss<T>(step: string, work: Promise<T>, fallback: T): Promise<T> {
  try {
    return await work;
  } catch (err) {
    defaultLog({ event: 'semantic_cache.dependency_failed', step, error: err instanceof Error ? err.message : String(err) });
    return fallback;
  }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : ''))
      .join(' ');
  }
  return '';
}

/** The meaning-matched query (last user message) and the exactly-matched rest. */
export function splitSemanticQuery(messages: unknown): { query: string; context: unknown[] } | null {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i] as { role?: unknown; content?: unknown } | null;
    if (m?.role !== 'user') continue;
    const query = textOf(m.content).trim();
    if (!query || query.length > MAX_QUERY_CHARS) return null;
    return { query, context: [...messages.slice(0, i), ...messages.slice(i + 1)] };
  }
  return null;
}

/** The model CLASS a request asked for — a tier, so interchangeable ids share answers. */
export function modelClassOf(model: unknown): string {
  if (typeof model !== 'string' || !model.trim()) return 'auto';
  try {
    return String(tierForModel(canonicalModelId(model) || model)).toLowerCase();
  } catch {
    return 'auto';
  }
}

/** Anchors with a recorded hash, in the compact stored form. */
function anchorGrounds(anchors: readonly FactFileAnchor[] | null | undefined): Array<{ p: string; h: string }> {
  return (normalizeFileAnchors(anchors ?? null) ?? [])
    .filter((a): a is FactFileAnchor & { contentHash: string } => !!a.contentHash)
    .map((a) => ({ p: a.path, h: a.contentHash }));
}

/**
 * The plan for this request, or null when it may not use the semantic tier (not
 * eligible, no user text, no embedding available).
 */
export async function planSemanticChat(
  env: ProxyEnv,
  body: ChatCompletionRequest,
  grant: ResponseCacheGrant,
  deps: SemanticChatDeps = {},
): Promise<SemanticChatPlan | null> {
  const eligibility = cacheEligibilityOf(body);
  if (!isCacheableRequest({ ...eligibility, maxTemperature: SEMANTIC_MAX_TEMPERATURE })) return null;
  const split = splitSemanticQuery((body as { messages?: unknown }).messages);
  if (!split) return null;
  const b = body as { response_format?: unknown; max_tokens?: unknown; top_p?: unknown; model?: unknown };
  const useCase = eligibility.useCase as string;
  const projectId = grant.projectId != null && Number.isInteger(grant.projectId) && grant.projectId > 0 ? grant.projectId : null;

  const contextHash = (await sha256Hex(stableStringify({
    context: split.context,
    responseFormat: b.response_format,
    maxTokens: b.max_tokens,
    topP: b.top_p,
  }))).slice(0, 16);
  const scope = cacheScopeKey({
    tenantId: grant.tenantId,
    projectId,
    principal: principalScope(grant.principal),
    modelClass: modelClassOf(b.model),
  });
  const namespace = `chat:${useCase}:${contextHash}:${scope}`;

  const embed = deps.embed ?? embedMemoryText;
  const embedding = await orMiss('embed', embed(asEnv(env), split.query), null);
  if (!embedding || embedding.length === 0) return null;

  const factsRevision = deps.factsRevision ?? projectFactsVersion;
  const fr = projectId != null
    ? await orMiss('facts_revision', factsRevision(asEnv(env), grant.tenantId, projectId), undefined)
    : undefined;
  const a = anchorGrounds(grant.fileAnchors);
  const grounds: SemanticEntryMeta = { ...(fr ? { fr } : {}), ...(a.length ? { a } : {}) };

  return {
    tenantId: grant.tenantId,
    useCase,
    namespace,
    embedding,
    pointerKey: `semresp:${grant.tenantId}:${await sha256Hex(`${namespace}\n${split.query}`)}`,
    grounds,
  };
}

/**
 * Do a stored answer's grounds still hold for this request? The facts revision must
 * match exactly; an anchored file is stale only when its current hash is KNOWN (from
 * the request's own anchors, else the caller's reader) and differs — a file nobody can
 * read is not evidence of change (the `anchorsAreStale` contract).
 */
export async function groundsHold(
  stored: SemanticEntryMeta | undefined,
  current: SemanticEntryMeta,
  readFileHash?: FileContentHashReader,
): Promise<boolean> {
  if ((stored?.fr ?? null) !== (current.fr ?? null)) return false;
  if (!stored?.a?.length) return true;
  const known = new Map((current.a ?? []).map((x) => [x.p, x.h]));
  const reader: FileContentHashReader = async (path) => known.get(path) ?? (readFileHash ? readFileHash(path) : null);
  // A failed staleness check is treated as stale: a miss costs one call, a wrong hit costs trust.
  const stale = await orMiss('anchors', anchorsAreStale(stored.a.map((x) => ({ path: x.p, contentHash: x.h })), reader), true);
  return !stale;
}

/** A served paraphrase as an (un-finalized) ProxyResult, or null on a miss. */
export async function lookupSemanticChat(
  env: ProxyEnv,
  plan: SemanticChatPlan,
  grant: ResponseCacheGrant,
  deps: SemanticChatDeps = {},
): Promise<ProxyResult | null> {
  const log = deps.log ?? defaultLog;
  try {
    const candidates = await semanticCandidates(asEnv(env), plan.tenantId, plan.namespace, plan.embedding, SEMANTIC_NEAR_MISS_FLOOR);
    for (const candidate of candidates) {
      const score = Number(candidate.score.toFixed(6));
      if (candidate.score < SEMANTIC_HIT_THRESHOLD) {
        // Sorted best first: the first one under the bar is the closest miss.
        log({ event: 'semantic_cache.near_miss', tenantId: plan.tenantId, useCase: plan.useCase, score, threshold: SEMANTIC_HIT_THRESHOLD });
        return null;
      }
      if (!(await groundsHold(candidate.meta, plan.grounds, grant.readFileHash))) {
        log({ event: 'semantic_cache.stale', tenantId: plan.tenantId, useCase: plan.useCase, score });
        continue;
      }
      const hit = await readResponseCacheHit(env, candidate.response);
      if (hit) {
        log({ event: 'semantic_cache.hit', tenantId: plan.tenantId, useCase: plan.useCase, score });
        return hit;
      }
    }
  } catch (error) {
    // A cache read must never fail a request — degrade to a miss.
    reportCaughtError(error, { source: 'application/llm/semanticChatCache.ts', operation: 'lookupSemanticChat' });
  }
  return null;
}

/**
 * Store a successful completion for later paraphrases: the body under the plan's
 * pointer key, then the pointer into the index. CLONES the response (the caller still
 * has to read it). Best-effort — a failed store costs a future miss and nothing else.
 */
export async function storeSemanticChat(env: ProxyEnv, plan: SemanticChatPlan, result: ProxyResult): Promise<void> {
  try {
    const body = await result.response.clone().json();
    await storeCachedResponse(env, plan.pointerKey, {
      body,
      resolvedModel: result.resolvedModel,
      resolvedVendor: result.resolvedVendor,
    }, SEMANTIC_CACHE_TTL_SECONDS);
    await semanticStore(asEnv(env), plan.tenantId, plan.namespace, plan.embedding, plan.pointerKey, plan.grounds);
  } catch (error) {
    reportCaughtError(error, { source: 'application/llm/semanticChatCache.ts', operation: 'storeSemanticChat' });
  }
}
