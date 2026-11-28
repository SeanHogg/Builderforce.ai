/**
 * memoryService — the ONE governed path in and out of agent memory.
 *
 * Before this module, memory was three stores with no owner: `agent_memory` (tenant),
 * `project_facts` (project) and whatever each caller decided to do, with
 * `buildCloudMemoryCapability` picking a table purely on whether the run had a
 * projectId. Nothing enforced who may remember what, where a belief came from, or when
 * it stops being true. Those three invariants now live in domain/memory/memoryScope.ts,
 * and this module is the only thing that turns them into queries.
 *
 * WHICH BACKING HOLDS WHICH SCOPE (routing, not duplication):
 *   project → `project_facts`, unchanged. That table is the SHARED cross-surface store
 *             VS Code, the web Brain, the cloud loop and on-prem all read; moving
 *             project scope anywhere else would break a live contract for no gain.
 *   tenant  → `agent_memory` with scope_kind='tenant' — exactly what it always was.
 *   ticket  → `agent_memory` with scope_kind='ticket', scope_id=<taskId>. New: the
 *             narrow end of the chain, so a run's working belief no longer has to be
 *             promoted to the whole workspace just to be written down.
 *
 * RECALL is a union over the run's visible chain, narrowest first, expired rows
 * excluded, then collapsed by specificity so a ticket-local override beats the
 * workspace default. A sibling project is unreachable because the chain never emits
 * one — isolation by construction rather than by remembering a predicate.
 *
 * CACHING. Recall is read-heavy and runs on every agent turn, so it is served through
 * the canonical read-through cache. The keyspace (arbitrary query strings × scopes) is
 * unbounded, so the key embeds VERSION tokens rather than an enumerated key list — and
 * it embeds BOTH stores' tokens (see {@link scopeCacheToken}), because `project_facts`
 * has four other writers that know nothing about this module. Expiry is ALSO applied in
 * SQL, so a lapsed fact stops being recalled when it lapses, not when a sweep runs.
 */

import { and, desc, eq, gt, ilike, inArray, isNull, or, type SQL } from 'drizzle-orm';
import type {
  MemoryCapability,
  MemoryEntry,
  MemoryForgetResult,
  MemoryRecallResult,
  MemoryRememberResult,
  MemoryScopeKind,
} from '@builderforce/agent-tools';
import {
  dedupeBySpecificity,
  expiryFromTtlDays,
  isExpired,
  resolveWriteScope,
  visibleScopeChain,
  type MemoryOrigin,
  type MemoryScopeContext,
  type ResolvedScope,
} from '../../domain/memory/memoryScope';
import { agentMemory, projectFacts } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { bumpCacheVersion, getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { QA_CACHE_SOURCE, projectFactsVersion, type FactFileAnchor } from '../llm/projectFactsStore';
import { loadProjectFactRecallArms, stampFactRecall } from '../llm/projectFactsRecall';
import { writeProjectFact } from '../knowledge/writeProjectFact';
import { deleteKnowledgeFact, type FactDeleteActor } from '../knowledge/deleteKnowledgeFact';
import { knowledgeWritePortsFor } from '../knowledge/knowledgeWritePorts';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { rankMemoryArms } from './memoryRecallRanking';
import { memoryVersionKey } from './memoryCacheVersion';
import { memoryEmbeddingText } from './memoryEmbedding';
import { memoryEmbeddingFieldsFor, memoryQueryVectors } from './memoryEmbeddingPolicy';
import { annAcrossSpaces, annRecallScoped, type RecalledRow } from './memorySemanticRecall';
import { cutRecall } from '../llm/retrievalK';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { clamp01 } from '../../domain/shared/numbers';
import { queryTerms } from '../../domain/shared/queryTerms';

const RECALL_DEFAULT = 5;
const RECALL_MAX = 20;
const RECALL_L1_TTL_MS = 30_000;
/** Candidates pulled per arm per scope, as a multiple of the caller's limit —
 *  the same widening on-prem hybrid retrieval uses before it fuses. */
const CANDIDATE_MULTIPLIER = 4;

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const versionKey = memoryVersionKey;

/**
 * The COMPOSITE cache token for a scope context.
 *
 * A governed read unions two stores, and they are invalidated independently: this
 * module bumps `mem:ver:<tenant>` on its own writes, while `project_facts` is also
 * written by the Brain, VS Code, the MCP tool and `projectFactsRoutes`, which bump only
 * the project-facts token. Keying on ours alone meant a fact written by any of those
 * surfaces stayed invisible to `memory_recall` for the whole cache TTL — minutes of
 * stale reads on the one path whose job is "recall what we already know".
 *
 * Composing both tokens makes EITHER write invalidate the union, with no cross-module
 * bump and therefore no import cycle.
 *
 * Exported for the one other reader of this store — the team feed
 * (`teamMemoryFeed.ts`) — so it keys on THIS token rather than minting a second
 * one that `remember` would not know to bump.
 */
export async function scopeCacheToken(env: Env, ctx: MemoryScopeContext, chain: ResolvedScope[]): Promise<string> {
  const projectScope = chain.find((s) => s.kind === 'project');
  const [ownVersion, factsVersion] = await Promise.all([
    getCacheVersion(env, versionKey(ctx.tenantId)),
    projectScope ? projectFactsVersion(env, ctx.tenantId, projectScope.id) : Promise.resolve('0'),
  ]);
  const scopeSig = chain.map((s) => `${s.kind}${s.id}`).join('|');
  return `${ownVersion}.${factsVersion}:${scopeSig}`;
}

/** Everything a governed write needs beyond the fact itself. */
export interface MemoryWriteContext extends MemoryScopeContext {
  /** Provenance: who formed this belief. */
  origin: MemoryOrigin;
  /** The run that formed it, when an agent did. */
  executionId?: number | null;
}

export interface RememberInput {
  key: string;
  content: string;
  tags?: string[];
  importance?: number;
  scope?: MemoryScopeKind;
  ttlDays?: number;
  /** Files the fact names. Anchored on a PROJECT-scope write only (`project_facts` holds
   *  anchors; `agent_memory` does not). Never runs the single-subject anchor sweep: a
   *  governed write naming a file is not a correction of every other fact about it. */
  fileAnchors?: FactFileAnchor[];
}

/**
 * Write one fact under the governed contract. The SCOPE OWNER always comes from the
 * run context, never from the caller's scope string — which is what makes it
 * impossible for an agent to aim a write at a project it is not running in.
 */
export async function remember(env: Env, db: Db, ctx: MemoryWriteContext, input: RememberInput): Promise<MemoryRememberResult> {
  const key = (input.key ?? '').trim().slice(0, 255);
  const content = (input.content ?? '').trim();
  if (!key || !content) return { ok: false, error: 'key and content are required' };

  const now = new Date();
  const scope = resolveWriteScope(ctx, input.scope);
  const expiresAt = expiryFromTtlDays(input.ttlDays, now);

  try {
    if (scope.kind === 'project') {
      // The ONE knowledge writer: origin stamped `agent` server-side, row-bounded, version-bumped.
      const ok = await writeProjectFact({ env, db, tenantId: ctx.tenantId, projectId: scope.id }, {
        key, content, source: ctx.origin, expiresAt,
        originExecutionId: ctx.executionId ?? null,
        ...(input.fileAnchors?.length ? { fileAnchors: input.fileAnchors } : {}),
      });
      if (!ok) return { ok: false, error: 'project-scoped write rejected (invalid project or empty value)' };
      await bumpCacheVersion(env, versionKey(ctx.tenantId));
      return { ok: true, key };
    }

    // Embed on write so the fact is semantically reachable on the very next recall.
    // Best-effort: a failed embed leaves the columns null and the backfill sweep
    // retries — a memory that is stored but not yet vectorised is still recalled by
    // the lexical arm, whereas refusing the write would lose the fact entirely.
    // Which vector space it lands in (1536 paid / 1024 free) is the E3 policy's call.
    const embeddingFields = await memoryEmbeddingFieldsFor(env, ctx.tenantId, memoryEmbeddingText(key, content), now);

    await db
      .insert(agentMemory)
      .values({
        tenantId: ctx.tenantId,
        key,
        content,
        ...embeddingFields,
        tags: JSON.stringify(input.tags ?? []),
        importance: clamp01(input.importance ?? 0.5),
        scopeKind: scope.kind,
        scopeId: scope.id,
        origin: ctx.origin,
        originExecutionId: ctx.executionId ?? null,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [agentMemory.tenantId, agentMemory.scopeKind, agentMemory.scopeId, agentMemory.key],
        // Replace the governance metadata alongside the content: re-remembering
        // without a TTL makes the fact durable again, rather than leaving a stale
        // expiry silently attached to fresh content.
        set: {
          content,
          tags: JSON.stringify(input.tags ?? []),
          importance: clamp01(input.importance ?? 0.5),
          origin: ctx.origin,
          originExecutionId: ctx.executionId ?? null,
          expiresAt,
          // Re-remembering REPLACES the vector too — a stale embedding of the old
          // content would rank the fact by what it used to say.
          ...embeddingFields,
          updatedAt: now,
        },
      });
    await bumpCacheVersion(env, versionKey(ctx.tenantId));
    return { ok: true, key };
  } catch (e) {
    return { ok: false, error: errMessage(e) };
  }
}

/**
 * Recall across the run's visible scope chain — narrowest first, expired excluded,
 * collapsed so each key appears once at its most specific scope.
 */
export async function recall(
  env: Env,
  db: Db,
  ctx: MemoryScopeContext,
  query: string,
  limit?: number,
): Promise<MemoryRecallResult> {
  const n = Math.min(Math.max(1, Math.trunc(limit ?? RECALL_DEFAULT)), RECALL_MAX);
  const chain = visibleScopeChain(ctx);
  const projectScope = chain.find((scope) => scope.kind === 'project');
  try {
    const token = await scopeCacheToken(env, ctx, chain);
    const entries = await getOrSetCached(
      env,
      `mem:recall:v3:${ctx.tenantId}:${token}:${n}:${query}`,
      async () => {
        // The semantic arm needs a query vector; without one (no key, or the vendor
        // failed) recall is the lexical arm alone, which is the pre-1134 behaviour.
        // One query vector per vector space the tenant reads (E3 dual-read).
        const stores = projectScope ? ['agent_memory', 'project_facts'] as const : ['agent_memory'] as const;
        const queryVectors = memoryQueryVectors(env, ctx.tenantId, query, stores).catch((error: unknown) => {
          reportCaughtError(error, { source: 'memory-service', operation: 'query-embedding', level: 'warning' });
          return [];
        });
        // Pull more candidates per arm than the caller asked for, so fusion has
        // something to choose between rather than re-ordering the final N.
        const perArm = n * CANDIDATE_MULTIPLIER;
        const scopedKinds = chain.filter((s) => s.kind !== 'project');

        // Four reads, fanned out — not an N+1: each store answers its whole scope
        // chain in ONE query per arm.
        const [scopedLexical, project, scopedVector] = await Promise.all([
          scopedKinds.length === 0
            ? Promise.resolve([] as Array<{ key: string; content: string; scopeKind: string; origin: string; expiresAt: Date | null; importance: number; updatedAt: Date | null }>)
            : (() => {
                const words = queryTerms(query);
                const matchers = words.map((w) => ilike(agentMemory.content, `%${w}%`));
                const scopeClause = or(
                  ...scopedKinds.map((s) => and(eq(agentMemory.scopeKind, s.kind), eq(agentMemory.scopeId, s.id))),
                );
                const unexpiredNow = or(isNull(agentMemory.expiresAt), gt(agentMemory.expiresAt, new Date()));
                const lexical: SQL | undefined = matchers.length > 0 ? or(...matchers) : undefined;
                return db
                  .select({
                    key: agentMemory.key,
                    content: agentMemory.content,
                    scopeKind: agentMemory.scopeKind,
                    origin: agentMemory.origin,
                    expiresAt: agentMemory.expiresAt,
                    importance: agentMemory.importance,
                    updatedAt: agentMemory.updatedAt,
                  })
                  .from(agentMemory)
                  .where(scopedToTenant(agentMemory, ctx.tenantId, scopeClause, unexpiredNow, lexical))
                  .orderBy(desc(agentMemory.importance), desc(agentMemory.updatedAt))
                  .limit(perArm);
              })(),
          projectScope
            ? loadProjectFactRecallArms(db, ctx.tenantId, projectScope.id, query, perArm, queryVectors).catch((error: unknown) => {
                reportCaughtError(error, { source: 'memory-service', operation: 'project-recall', level: 'warning' });
                return { vector: [], text: [] };
              })
            : Promise.resolve({ vector: [], text: [] }),
          scopedKinds.length > 0
            ? queryVectors.then((vectors) => annAcrossSpaces(vectors, (literal, opts) => annRecallScoped(db, ctx.tenantId, scopedKinds, literal, perArm, opts)))
            : Promise.resolve([] as RecalledRow[]),
        ]);

        const scopedText: RecalledRow[] = scopedLexical.map((row) => ({
          ...row,
          id: `scoped:${row.scopeKind}:${row.key}`,
          importance: Number(row.importance ?? 0.5),
          updatedAt: row.updatedAt ? new Date(row.updatedAt) : null,
          vectorScore: 0,
        }));
        const fused = rankMemoryArms<RecalledRow>([...scopedVector, ...project.vector], [...scopedText, ...project.text]);
        const deduped = dedupeBySpecificity(fused.map((candidate) => ({
          ...candidate, key: candidate.row.key, scope: candidate.row.scopeKind as MemoryScopeKind,
        })));
        // The cut: `n` as before, or reranked (C6) / adaptively sized (C4) when on.
        // The cache key above holds the REQUESTED `n`, so an adaptive cut never
        // fragments it.
        return cutRecall<MemoryEntry>({
          env,
          tenantId: ctx.tenantId,
          query,
          ranked: deduped.map(({ row, score, scope }) => ({
            row: {
              key: row.key,
              content: row.content,
              scope,
              origin: row.origin,
              expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
            },
            score,
          })),
          requested: n,
          textOf: (row) => memoryEmbeddingText(row.key, row.content),
        });
      },
      { l1TtlMs: RECALL_L1_TTL_MS },
    );
    // Cache version tokens change on writes, not when the clock crosses an expiry.
    // Revalidate every cached entry at the return seam so neither L1 nor KV can keep
    // a lapsed belief alive for the remainder of its cache TTL.
    const now = new Date();
    const live = entries.filter((entry) => !isExpired(entry.expiresAt, now));
    if (projectScope) {
      const keys = live.filter((entry) => entry.scope === 'project').map((entry) => entry.key);
      await stampFactRecall(db, ctx.tenantId, projectScope.id, keys).catch((error: unknown) => {
        reportCaughtError(error, { source: 'memory-service', operation: 'stamp-recall', level: 'warning' });
      });
    }
    return { ok: true, query, entries: live };
  } catch (e) {
    return { ok: false, error: errMessage(e) };
  }
}

/**
 * Delete a fact by key from the NARROWEST scope that holds it. Narrowest-first is the
 * only safe direction: forgetting a ticket-local override must not silently expose the
 * workspace-wide fact it was shadowing without the caller asking for that.
 */
export async function forget(
  env: Env,
  db: Db,
  ctx: MemoryScopeContext,
  key: string,
  /** Who is forgetting. Absent = a machine/agent: it may not delete a person's fact (§8.3). */
  actor: FactDeleteActor = { userId: null, role: null },
): Promise<MemoryForgetResult> {
  const k = (key ?? '').trim().slice(0, 255);
  if (!k) return { ok: false, error: 'key is required' };
  try {
    for (const scope of visibleScopeChain(ctx)) {
      if (scope.kind === 'project') {
        // Relations go with the fact, and the author/admin rule applies (§8.3).
        const { store } = knowledgeWritePortsFor(env, db, ctx.tenantId, scope.id);
        const res = await deleteKnowledgeFact({ env, db, tenantId: ctx.tenantId, projectId: scope.id, store }, actor, k);
        if (!res.ok) return { ok: false, error: res.error };
        if (res.removed) {
          await bumpCacheVersion(env, versionKey(ctx.tenantId));
          return { ok: true, key: k, deleted: true };
        }
        continue;
      }
      const removed = await db
        .delete(agentMemory)
        .where(
          and(
            eq(agentMemory.tenantId, ctx.tenantId),
            eq(agentMemory.scopeKind, scope.kind),
            eq(agentMemory.scopeId, scope.id),
            eq(agentMemory.key, k),
          ),
        )
        .returning({ id: agentMemory.id });
      if (removed.length > 0) {
        await bumpCacheVersion(env, versionKey(ctx.tenantId));
        return { ok: true, key: k, deleted: true };
      }
    }
    return { ok: true, key: k, deleted: false };
  } catch (e) {
    return { ok: false, error: errMessage(e) };
  }
}

/** One row as the governance UI renders it — the fact PLUS why it is trusted. */
export interface GovernedMemoryRow {
  key: string;
  content: string;
  scope: MemoryScopeKind;
  scopeId: number;
  origin: string;
  originExecutionId: number | null;
  importance: number;
  expiresAt: string | null;
  updatedAt: string;
}

/**
 * The governance read: every fact visible in a scope context, with its provenance and
 * expiry, for the Memory tab. Read-through cached on the same version token as recall,
 * so a write invalidates the browser view and the agent's recall together.
 */
export async function listGovernedMemories(
  env: Env,
  db: Db,
  ctx: MemoryScopeContext,
  opts?: { limit?: number },
): Promise<GovernedMemoryRow[]> {
  const limit = Math.min(Math.max(1, Math.trunc(opts?.limit ?? 200)), 500);
  const chain = visibleScopeChain(ctx);
  try {
    const token = await scopeCacheToken(env, ctx, chain);
    return await getOrSetCached(
      env,
      `mem:governed:${ctx.tenantId}:${token}:${limit}`,
      async () => {
        const scopedKinds = chain.filter((s) => s.kind !== 'project');
        const projectScope = chain.find((s) => s.kind === 'project');
        const [scoped, project] = await Promise.all([
          scopedKinds.length === 0
            ? Promise.resolve([])
            : db
                .select({
                  key: agentMemory.key,
                  content: agentMemory.content,
                  scopeKind: agentMemory.scopeKind,
                  scopeId: agentMemory.scopeId,
                  origin: agentMemory.origin,
                  originExecutionId: agentMemory.originExecutionId,
                  importance: agentMemory.importance,
                  expiresAt: agentMemory.expiresAt,
                  updatedAt: agentMemory.updatedAt,
                })
                .from(agentMemory)
                .where(
                  and(
                    eq(agentMemory.tenantId, ctx.tenantId),
                    inArray(
                      agentMemory.scopeKind,
                      scopedKinds.map((s) => s.kind),
                    ),
                    or(...scopedKinds.map((s) => and(eq(agentMemory.scopeKind, s.kind), eq(agentMemory.scopeId, s.id)))),
                  ),
                )
                .orderBy(desc(agentMemory.updatedAt))
                .limit(limit),
          projectScope
            ? db
                .select({
                  key: projectFacts.key,
                  content: projectFacts.content,
                  origin: projectFacts.source,
                  originExecutionId: projectFacts.originExecutionId,
                  importance: projectFacts.importance,
                  expiresAt: projectFacts.expiresAt,
                  updatedAt: projectFacts.updatedAt,
                })
                .from(projectFacts)
                .where(and(eq(projectFacts.tenantId, ctx.tenantId), eq(projectFacts.projectId, projectScope.id)))
                .orderBy(desc(projectFacts.updatedAt))
                .limit(limit)
            : Promise.resolve([]),
        ]);

        const rows: GovernedMemoryRow[] = [
          ...scoped.map((r) => ({
            key: r.key,
            content: r.content,
            scope: r.scopeKind as MemoryScopeKind,
            scopeId: r.scopeId,
            origin: r.origin,
            originExecutionId: r.originExecutionId,
            importance: r.importance,
            expiresAt: r.expiresAt ? new Date(r.expiresAt).toISOString() : null,
            updatedAt: new Date(r.updatedAt).toISOString(),
          })),
          ...project
            // Q&A cache rows are a replay cache, not beliefs — excluded from recall
            // already, and excluded here so the governance view shows knowledge only.
            .filter((r) => r.origin !== QA_CACHE_SOURCE)
            .map((r) => ({
              key: r.key,
              content: r.content,
              scope: 'project' as const,
              scopeId: projectScope?.id ?? 0,
              origin: r.origin,
              originExecutionId: r.originExecutionId,
              importance: r.importance,
              expiresAt: r.expiresAt ? new Date(r.expiresAt).toISOString() : null,
              updatedAt: new Date(r.updatedAt).toISOString(),
            })),
        ];
        return rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, limit);
      },
      { l1TtlMs: RECALL_L1_TTL_MS },
    );
  } catch {
    return [];
  }
}

/**
 * The governed {@link MemoryCapability} handed to an agent run. Replaces the old
 * `buildCloudMemoryCapability` table-picking logic: the SCOPE decides the backing, and
 * the run context decides the scope, so the capability itself has no policy in it.
 */
export function buildMemoryCapability(args: {
  db: Db;
  env: Env;
  tenantId: number;
  projectId?: number | null;
  ticketId?: number | null;
  origin?: MemoryOrigin;
  executionId?: number | null;
}): MemoryCapability {
  const ctx: MemoryWriteContext = {
    tenantId: args.tenantId,
    projectId: args.projectId ?? null,
    ticketId: args.ticketId ?? null,
    origin: args.origin ?? 'agent',
    executionId: args.executionId ?? null,
  };
  return {
    remember: (key, content, opts) =>
      remember(args.env, args.db, ctx, {
        key,
        content,
        tags: opts?.tags,
        importance: opts?.importance,
        scope: opts?.scope,
        ttlDays: opts?.ttlDays,
        ...(opts?.fileAnchors?.length ? { fileAnchors: opts.fileAnchors } : {}),
      }),
    recall: (query, limit) => recall(args.env, args.db, ctx, query, limit),
    forget: (key) => forget(args.env, args.db, ctx, key),
  };
}
