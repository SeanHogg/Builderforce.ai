/**
 * projectFacts WRITES — the write-through upsert (replace by stable key, never
 * accumulate) and the by-key delete. Every write bumps the project's fact version so no
 * cached read serves a stale set. Primitives live in `projectFactsStore`.
 */
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { memoryEmbeddingText } from '../memory/memoryEmbedding';
import { NO_MEMORY_EMBEDDING, memoryEmbeddingFieldsFor } from '../memory/memoryEmbeddingPolicy';
import { projectFacts } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { clamp01 } from '../../domain/shared/numbers';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import {
  bumpProjectFactsVersion,
  factContentHash,
  factImportance,
  normalizeFileAnchors,
  originCostColumns,
  resolveFactOrigin,
  stampAnchorHashes,
  type FactFileAnchor,
  type FactImportance,
  type FactOriginCost,
} from './projectFactsStore';

/**
 * Write-through upsert a fact under a stable `key` (replace-on-write). Bumps the
 * recall cache so the next read reflects it. No-op on an invalid project / empty
 * key or content.
 */
export async function upsertProjectFact(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  key: string,
  content: string,
  source = 'agent',
  /** Governance metadata (0371): which run formed the belief, and when it lapses.
   *  Optional so the six existing callers are unchanged; supplied by
   *  application/memory/memoryService, which is the governed write path.
   *
   *  1242 adds the retirement half: `importance` (real weight, not the 0.5 every row
   *  used to carry), the `contentHash` this call computes to decide whether the write
   *  CORRECTED a belief, and `fileAnchors` naming the files it was read out of. */
  opts?: {
    expiresAt?: Date | null;
    originExecutionId?: number | null;
    origin?: FactOriginCost | null;
    /** Explicit weight; scored from the content when omitted. */
    importance?: number;
    kind?: FactImportance;
    /** Files the fact is about. `contentHash` is the file hash at write time. */
    fileAnchors?: FactFileAnchor[];
  },
): Promise<boolean> {
  const k = (key ?? '').trim().slice(0, 255);
  const c = (content ?? '').trim();
  if (!k || !c || !Number.isInteger(projectId) || projectId <= 0) return false;
  const expiresAt = opts?.expiresAt ?? null;
  const originExecutionId = opts?.originExecutionId ?? null;
  // Provenance is the execution id the caller already has, plus the model of that
  // run's own trace when the caller did not pass a triple. A missing id stays null.
  const origin = await resolveFactOrigin(db, tenantId, originExecutionId, opts?.origin);
  const originCost = originCostColumns(origin);
  // Content score, then a small lift from how often recall has already returned
  // this key. A brand-new key has no prior count, so it keeps the content score.
  let prior: Array<{ recallCount: number }> = [];
  try {
    const result = await db
      .select({ recallCount: projectFacts.recallCount })
      .from(projectFacts)
      .where(and(eq(projectFacts.tenantId, tenantId), eq(projectFacts.projectId, projectId), eq(projectFacts.key, k)))
      .limit(1);
    prior = result;
  } catch (err) {
    // A brand-new key has no prior count, which is the normal path here. A FAILED
    // count read is not, and it would flatter the fact: recallCount 0 skips the
    // recall-frequency lift. Report it rather than writing a belief whose
    // importance was computed from a stand-in zero.
    reportCaughtError(err, { source: 'project-facts', operation: 'prior-recall-count', level: 'warning', context: { tenantId, projectId } });
    prior = [] as Array<{ recallCount: number }>;
  }
  const recallCount = prior[0]?.recallCount ?? 0;
  const baseImportance = opts?.importance ?? factImportance(c, opts?.kind);
  const importance = clamp01(baseImportance + Math.min(0.1, recallCount * 0.01));
  // Stamped on every write, on BOTH branches below. This digest is what tells a
  // corrected belief from a re-assertion of the same one.
  const contentHash = await factContentHash(k, c);
  const fileAnchors = await stampAnchorHashes(db, tenantId, normalizeFileAnchors(opts?.fileAnchors));
  // Embed on write so the fact is semantically reachable on the next recall (1134).
  // Best-effort, and now actually so: the `catch` used to be MISSING, so a provider
  // error propagated out of this function and the belief was never written at all —
  // the exact opposite of what the comment below it claimed. Losing a write to an
  // embedding outage is the worse failure of the two; the vector is a cache.
  const now = new Date();
  // Every embedding column (1536 and, since 1256, the free 1024 space) is set or
  // cleared together, so a rewrite never leaves a vector of the OLD content behind.
  const embeddingFields = await memoryEmbeddingFieldsFor(env, tenantId, memoryEmbeddingText(k, c), now).catch((err: unknown) => {
    reportCaughtError(err, { source: 'project-facts', operation: 'embed-on-write', level: 'warning', context: { tenantId, projectId } });
    return { ...NO_MEMORY_EMBEDDING };
  });

  // Retire what this write CONTRADICTS, and do it BEFORE the new row lands — otherwise
  // both beliefs are live for the window between the two writes, which is the exact
  // replay this fixes. A fact whose content moved under the same anchor is the codebase
  // correcting itself, and the old row must stop being served. It is RETIRED, never
  // deleted, so "why did the agent believe this last month" stays answerable.
  //
  // Scoped to the ANCHOR, not the key, and that is the load-bearing choice: the whole
  // failure is two beliefs about one subject arriving under DIFFERENT keys, so matching
  // on the key would find nothing and leave both live forever. Same key + changed hash
  // is the other half, handled by the ON CONFLICT branch below, which replaces in
  // place rather than leaving a duplicate to retire.
  //
  // Best-effort, like everything else here: if the UPDATE fails the new belief still
  // gets written, and the worst case is the old one lingering — which is the state
  // this code ran in for months — rather than the write being lost.
  if (opts?.fileAnchors?.length) {
    const anchors = opts.fileAnchors.map((a) => a.path.trim().toLowerCase()).filter(Boolean);
    if (anchors.length) {
      await db
        .update(projectFacts)
        .set({ supersededBy: 0 })
        .where(and(
          scopedToTenant(projectFacts, tenantId),
          eq(projectFacts.projectId, projectId),
          isNull(projectFacts.supersededBy),
          ne(projectFacts.contentHash, contentHash),
          // `->0` is the FIRST anchor: one fact asserts one thing about one place, so
          // the first anchor identifies it without an array-containment operator that
          // cannot use an index.
          sql`lower(${projectFacts.fileAnchors}->0->>'path') IN (${sql.join(anchors.map((p) => sql`${p}`), sql`, `)})`,
        ))
        .catch((err: unknown) => {
          reportCaughtError(err, { source: 'project-facts', operation: 'supersede-by-anchor', level: 'warning', context: { tenantId, projectId } });
        });
    }
  }

  await db
    .insert(projectFacts)
    .values({ tenantId, projectId, key: k, content: c, source: source.slice(0, 64), expiresAt, originExecutionId, importance, contentHash, fileAnchors, ...originCost, ...embeddingFields })
    .onConflictDoUpdate({
      target: [projectFacts.tenantId, projectFacts.projectId, projectFacts.key],
      // A re-write REPLACES the governance metadata too: re-remembering a fact without
      // a TTL makes it durable again, which is the only reading of "update == replace"
      // that does not leave a stale expiry silently attached to fresh content. The
      // vector goes with it — an embedding of superseded content ranks the fact by
      // what it used to say.
      //
      // `supersededBy: null` REVIVES a retired row when someone re-asserts the belief:
      // a retirement is "this was contradicted", not "this is forbidden", and a fresh
      // assertion is exactly the evidence that it is live again.
      set: {
        content: c, source: source.slice(0, 64), expiresAt, importance, contentHash, fileAnchors, supersededBy: null, ...embeddingFields, updatedAt: now,
        // A rewrite that does not know its run must not wipe a stamp a previous write
        // recorded. Insert still writes null when nothing is known (values above).
        ...(originExecutionId != null ? { originExecutionId } : {}),
        ...(origin ? originCost : {}),
      },
    });
  await bumpProjectFactsVersion(env, tenantId, projectId);
  return true;
}

/**
 * Delete one project fact by key. The project-scope half of memory_forget; the
 * tenant/ticket half lives in application/memory/memoryService against `agent_memory`.
 */
export async function deleteProjectFact(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  key: string,
): Promise<boolean> {
  const k = (key ?? '').trim().slice(0, 255);
  if (!k || !Number.isInteger(projectId) || projectId <= 0) return false;
  const removed = await db
    .delete(projectFacts)
    .where(and(eq(projectFacts.tenantId, tenantId), eq(projectFacts.projectId, projectId), eq(projectFacts.key, k)))
    .returning({ id: projectFacts.id })
    .catch((err: unknown) => {
      // Returning `false` on a FAILED DELETE would tell the caller the belief is gone
      // when it is still stored and will be recalled again — the one outcome worse
      // than an error. So the rejection is reported as an error (not a warning) and
      // the caller still gets its honest `false`, with the failure now visible.
      reportCaughtError(err, { source: 'project-facts', operation: 'delete-project-fact', level: 'error', context: { tenantId, projectId } });
      return [] as Array<{ id: string }>;
    });
  if (removed.length > 0) await bumpProjectFactsVersion(env, tenantId, projectId);
  return removed.length > 0;
}
