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

import { and, desc, eq, gt, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
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
  resolveWriteScope,
  visibleScopeChain,
  type MemoryOrigin,
  type MemoryScopeContext,
  type ResolvedScope,
} from '../../domain/memory/memoryScope';
import { agentMemory, projectFacts } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { bumpCacheVersion, getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { QA_CACHE_SOURCE, deleteProjectFact, projectFactsVersion, recallProjectFacts, upsertProjectFact } from '../llm/projectFacts';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

const RECALL_DEFAULT = 5;
const RECALL_MAX = 20;
const RECALL_L1_TTL_MS = 30_000;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const versionKey = (tenantId: number): string => `mem:ver:${tenantId}`;

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
 */
async function scopeCacheToken(env: Env, ctx: MemoryScopeContext, chain: ResolvedScope[]): Promise<string> {
  const projectScope = chain.find((s) => s.kind === 'project');
  const [ownVersion, factsVersion] = await Promise.all([
    getCacheVersion(env, versionKey(ctx.tenantId)),
    projectScope ? projectFactsVersion(env, ctx.tenantId, projectScope.id) : Promise.resolve('0'),
  ]);
  const scopeSig = chain.map((s) => `${s.kind}${s.id}`).join('|');
  return `${ownVersion}.${factsVersion}:${scopeSig}`;
}

/** Significant lowercase words (drop 1-char noise) — each becomes an ILIKE matcher. */
function tokenize(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^a-z0-9]+/i).filter((w) => w.length > 1))].slice(0, 12);
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
      const ok = await upsertProjectFact(env, db, ctx.tenantId, scope.id, key, content, ctx.origin, {
        expiresAt,
        originExecutionId: ctx.executionId ?? null,
      });
      if (!ok) return { ok: false, error: 'project-scoped write rejected (invalid project or empty value)' };
      await bumpCacheVersion(env, versionKey(ctx.tenantId));
      return { ok: true, key };
    }

    await db
      .insert(agentMemory)
      .values({
        tenantId: ctx.tenantId,
        key,
        content,
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
  try {
    const token = await scopeCacheToken(env, ctx, chain);
    const entries = await getOrSetCached(
      env,
      `mem:recall:${ctx.tenantId}:${token}:${n}:${query}`,
      async () => {
        // The two backings are read CONCURRENTLY — a fan-out of two, not an N+1: the
        // scoped store answers tenant+ticket in ONE query via an IN over the chain.
        const scopedKinds = chain.filter((s) => s.kind !== 'project');
        const projectScope = chain.find((s) => s.kind === 'project');

        const [scopedRows, projectRows] = await Promise.all([
          scopedKinds.length === 0
            ? Promise.resolve([] as Array<{ key: string; content: string; scopeKind: string; origin: string; expiresAt: Date | null }>)
            : (() => {
                const words = tokenize(query);
                const matchers = words.map((w) => ilike(agentMemory.content, `%${w}%`));
                const scopeClause = or(
                  ...scopedKinds.map((s) => and(eq(agentMemory.scopeKind, s.kind), eq(agentMemory.scopeId, s.id))),
                );
                const unexpired = or(isNull(agentMemory.expiresAt), gt(agentMemory.expiresAt, new Date()));
                const lexical: SQL | undefined = matchers.length > 0 ? or(...matchers) : undefined;
                return db
                  .select({
                    key: agentMemory.key,
                    content: agentMemory.content,
                    scopeKind: agentMemory.scopeKind,
                    origin: agentMemory.origin,
                    expiresAt: agentMemory.expiresAt,
                  })
                  .from(agentMemory)
                  .where(scopedToTenant(agentMemory, ctx.tenantId, scopeClause, unexpired, lexical))
                  .orderBy(desc(agentMemory.importance), desc(agentMemory.updatedAt))
                  .limit(n * chain.length);
              })(),
          projectScope
            ? recallProjectFacts(env, db, ctx.tenantId, projectScope.id, { query, limit: n })
            : Promise.resolve([] as Array<{ key: string; content: string }>),
        ]);

        // Order by the CHAIN, not by the query order, so `dedupeBySpecificity` (a
        // stable first-wins pass) resolves a key collision toward the narrower scope.
        const byScope = new Map<MemoryScopeKind, MemoryEntry[]>();
        for (const r of scopedRows) {
          const kind = r.scopeKind as MemoryScopeKind;
          const list = byScope.get(kind) ?? [];
          list.push({
            key: r.key,
            content: r.content,
            scope: kind,
            origin: r.origin,
            expiresAt: r.expiresAt ? new Date(r.expiresAt).toISOString() : null,
          });
          byScope.set(kind, list);
        }
        if (projectScope) {
          byScope.set(
            'project',
            projectRows.map((r) => ({ key: r.key, content: r.content, scope: 'project' as const, origin: 'agent' })),
          );
        }
        const ordered: MemoryEntry[] = chain.flatMap((s) => byScope.get(s.kind) ?? []);
        return dedupeBySpecificity<MemoryEntry>(ordered).slice(0, n);
      },
      { l1TtlMs: RECALL_L1_TTL_MS },
    );
    return { ok: true, query, entries };
  } catch (e) {
    return { ok: false, error: errMessage(e) };
  }
}

/**
 * Delete a fact by key from the NARROWEST scope that holds it. Narrowest-first is the
 * only safe direction: forgetting a ticket-local override must not silently expose the
 * workspace-wide fact it was shadowing without the caller asking for that.
 */
export async function forget(env: Env, db: Db, ctx: MemoryScopeContext, key: string): Promise<MemoryForgetResult> {
  const k = (key ?? '').trim().slice(0, 255);
  if (!k) return { ok: false, error: 'key is required' };
  try {
    for (const scope of visibleScopeChain(ctx)) {
      if (scope.kind === 'project') {
        if (await deleteProjectFact(env, db, ctx.tenantId, scope.id, k)) {
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

/**
 * Delete every lapsed fact from BOTH stores. Housekeeping only — recall already
 * excludes expired rows in SQL, so this reclaims space and keeps the governance view
 * honest; correctness never depends on it having run. Wired into the retention sweep.
 */
export async function purgeExpiredMemories(env: Env, db: Db, tenantId?: number): Promise<{ agentMemory: number; projectFacts: number }> {
  const now = new Date();
  try {
    // The tenant predicate is written INLINE in each statement (rather than hoisted
    // into a variable) so the tenant-scope guard can see it, and so the two modes are
    // visibly distinct: an operator sweep is one tenant, the nightly cron is global.
    const [am, pf] = await Promise.all([
      db
        .delete(agentMemory)
        .where(
          and(
            sql`${agentMemory.expiresAt} IS NOT NULL`,
            sql`${agentMemory.expiresAt} <= ${now}`,
            tenantId != null ? eq(agentMemory.tenantId, tenantId) : undefined,
          ),
        )
        .returning({ id: agentMemory.id })
        .catch(() => [] as Array<{ id: string }>),
      db
        .delete(projectFacts)
        .where(
          and(
            sql`${projectFacts.expiresAt} IS NOT NULL`,
            sql`${projectFacts.expiresAt} <= ${now}`,
            tenantId != null ? eq(projectFacts.tenantId, tenantId) : undefined,
          ),
        )
        .returning({ id: projectFacts.id })
        .catch(() => [] as Array<{ id: string }>),
    ]);
    if (tenantId != null && am.length + pf.length > 0) await bumpCacheVersion(env, versionKey(tenantId));
    return { agentMemory: am.length, projectFacts: pf.length };
  } catch {
    return { agentMemory: 0, projectFacts: 0 };
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
      }),
    recall: (query, limit) => recall(args.env, args.db, ctx, query, limit),
    forget: (key) => forget(args.env, args.db, ctx, key),
  };
}
