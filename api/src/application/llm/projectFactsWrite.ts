/**
 * projectFacts WRITES — the write-through upsert (replace by stable key, never
 * accumulate) and the by-key delete. Every write bumps the project's fact version so no
 * cached read serves a stale set. Primitives live in `projectFactsStore`.
 */
import { CONSOLIDATED_KEY_PREFIX, mergeConsolidated } from '@seanhogg/builderforce-memory/working';
import { and, eq, getTableColumns, inArray, isNull, ne, notLike, sql } from 'drizzle-orm';
import { memoryEmbeddingText } from '../memory/memoryEmbedding';
import { NO_MEMORY_EMBEDDING, memoryEmbeddingFieldsFor } from '../memory/memoryEmbeddingPolicy';
import { projectFacts } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { clamp01 } from '../../domain/shared/numbers';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { codemapAnchorsForWrite, isCodemapKey, pathKey, pathKeySql } from './projectFactsCodemap';
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
  type FileContentHashReader,
  hostDirectoryHashesFor,
} from './projectFactsStore';

/**
 * Write-through upsert a fact under a stable `key` (replace-on-write). Bumps the
 * recall cache so the next read reflects it. No-op on an invalid project / empty
 * key or content.
 */
async function prepareFactRow(
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
    /** The person who asserted it (1278) — stamped on INSERT only, so a rewrite never
     *  transfers authorship. Null/absent for agent and host writes. */
    createdBy?: string | null;
    /** Knowledge-graph origin (1278). Replaced on every write that states one. */
    factOrigin?: 'model' | 'human' | 'agent';
    /** Retire OTHER live facts whose first anchor is this write's (the single-subject
     *  correction sweep below). Default true. A write that is not a single-subject
     *  belief about its anchored file — a knowledge-graph claim or entity (many per
     *  file), a run outcome that merely names what it touched — passes false, or every
     *  such write would retire its siblings. */
    retireByAnchor?: boolean;
    /** Skip this call's version bump; the caller bumps ONCE for its whole batch
     *  (`writeKnowledge`). KV allows one write per second per key, so 500 bumps of one
     *  token in a burst would each wait out the rate limit. */
    deferVersionBump?: boolean;
  },
  shared: PrepareShared = { embed: true },
): Promise<PreparedFact | null> {
  const k = (key ?? '').trim().slice(0, 255);
  const incoming = (content ?? '').trim();
  if (!k || !incoming || !Number.isInteger(projectId) || projectId <= 0) return null;
  const expiresAt = opts?.expiresAt ?? null;
  const originExecutionId = opts?.originExecutionId ?? null;
  // Provenance is the execution id the caller already has, plus the model of that
  // run's own trace when the caller did not pass a triple. A missing id stays null.
  const origin = await resolveFactOrigin(db, tenantId, originExecutionId, opts?.origin);
  const originCost = originCostColumns(origin);
  // Content score, then a small lift from how often recall has already returned
  // this key. A brand-new key has no prior count, so it keeps the content score.
  let prior: PriorFact[] = [];
  if (shared.priors) {
    const known = shared.priors.get(k);
    prior = known ? [known] : [];
  } else try {
    const result = await db
      .select({ recallCount: projectFacts.recallCount, content: projectFacts.content, expiresAt: projectFacts.expiresAt, supersededBy: projectFacts.supersededBy, fileAnchors: projectFacts.fileAnchors })
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
    prior = [];
  }
  const recallCount = prior[0]?.recallCount ?? 0;
  // A code map ADDS to the area's map instead of replacing it (`mergeConsolidated`): the
  // one place every runtime's write lands, so a one-file run cannot erase the twelve
  // files an earlier investigation mapped. Every other key replaces, as before. Only a
  // LIVE prior is merged — a map the decay sweep expired or a newer belief superseded
  // was retired on purpose, and folding it back in would resurrect it.
  const live = prior[0] && prior[0].supersededBy == null && !(prior[0].expiresAt && prior[0].expiresAt.getTime() <= Date.now());
  const c = mergeConsolidated(k, live ? prior[0]!.content : null, incoming);
  // A map's anchors follow its merge: the union of the live prior's and this write's,
  // limited to the files the merged map lists — so an earlier run's files stay anchored
  // (and can go stale one by one) instead of being wiped by a write that did not name them.
  // A map written WITHOUT anchors (on-prem, V2 relay, cloud run end) is anchored here from
  // the files it lists, so per-file staleness holds for every runtime, not just the VSIX.
  const codemap = isCodemapKey(k);
  const anchorsIn = codemap ? codemapAnchorsForWrite(c, incoming, live ? prior[0]!.fileAnchors : null, opts?.fileAnchors) : opts?.fileAnchors;
  const baseImportance = opts?.importance ?? factImportance(c, opts?.kind);
  const importance = clamp01(baseImportance + Math.min(0.1, recallCount * 0.01));
  // Stamped on every write, on BOTH branches below. This digest is what tells a
  // corrected belief from a re-assertion of the same one.
  const contentHash = await factContentHash(k, c);
  const fileAnchors = await stampAnchorHashes(db, tenantId, normalizeFileAnchors(anchorsIn), shared.reader);
  // Embed on write so the fact is semantically reachable on the next recall (1134).
  // Best-effort, and now actually so: the `catch` used to be MISSING, so a provider
  // error propagated out of this function and the belief was never written at all —
  // the exact opposite of what the comment below it claimed. Losing a write to an
  // embedding outage is the worse failure of the two; the vector is a cache.
  const now = new Date();
  // Every embedding column (1536 and, since 1256, the free 1024 space) is set or
  // cleared together, so a rewrite never leaves a vector of the OLD content behind.
  // A batch (pack sync) skips the per-fact provider call — that is one subrequest per fact — and stores no
  // vector; the embedding backfill sweep fills it in, exactly as for any fact written while embedding was down.
  const embeddingFields = shared.embed
    ? await memoryEmbeddingFieldsFor(env, tenantId, memoryEmbeddingText(k, c), now).catch((err: unknown) => {
      reportCaughtError(err, { source: 'project-facts', operation: 'embed-on-write', level: 'warning', context: { tenantId, projectId } });
      return { ...NO_MEMORY_EMBEDDING };
    })
    : { ...NO_MEMORY_EMBEDDING };

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
  //
  // CODE MAPS are not single-subject beliefs, so neither side of this applies to them.
  // A map anchors every file it lists (up to sixteen), so retiring by its anchors retired
  // the maps of OTHER areas and unrelated facts that merely shared a file; and a map's
  // first anchor is just its first-listed file, so an ordinary fact about that file
  // retired a whole area's map. A map is retired by its own KEY only — the merge below
  // replaces it in place — and the anchor sweep never selects a map.
  if (!codemap && opts?.retireByAnchor !== false && opts?.fileAnchors?.length) {
    // One path identity (`pathKey`) on both sides: a `.\src\a.ts` anchor and a stored
    // `src/a.ts` are the same file, as they already are for code-map staleness.
    const anchors = opts.fileAnchors.map((a) => pathKey(a.path)).filter(Boolean);
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
          sql`${pathKeySql(sql`${projectFacts.fileAnchors}->0->>'path'`)} IN (${sql.join(anchors.map((p) => sql`${p}`), sql`, `)})`,
          notLike(projectFacts.key, `${CONSOLIDATED_KEY_PREFIX}%`),
        ))
        .catch((err: unknown) => {
          reportCaughtError(err, { source: 'project-facts', operation: 'supersede-by-anchor', level: 'warning', context: { tenantId, projectId } });
        });
    }
  }

  return {
    values: { tenantId, projectId, key: k, content: c, source: source.slice(0, 64), expiresAt, originExecutionId, importance, contentHash, fileAnchors, createdBy: opts?.createdBy ?? null, origin: opts?.factOrigin ?? null, ...originCost, ...embeddingFields },
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
      ...(opts?.factOrigin ? { origin: opts.factOrigin } : {}),
      // A rewrite that does not know its run must not wipe a stamp a previous write
      // recorded. Insert still writes null when nothing is known (values above).
      ...(originExecutionId != null ? { originExecutionId } : {}),
      ...(origin ? originCost : {}),
    },
  };
}

type PriorFact = { recallCount: number; content: string | null; expiresAt: Date | null; supersededBy: number | null; fileAnchors?: unknown };
type FactValues = typeof projectFacts.$inferInsert;
interface PreparedFact { values: FactValues; set: Record<string, unknown> }
interface PrepareShared {
  /** The facts' prior rows, read for the whole batch in ONE query (absent: read this fact's own). */
  priors?: Map<string, PriorFact>;
  /** Embed on write (the single-fact path). A batch passes false and leaves the vector to the backfill sweep. */
  embed: boolean;
  /** One content-hash reader for the whole batch (one query), so unhashed anchors do not cost a query each. */
  reader?: FileContentHashReader;
}

/** One fact of a batch: `upsertProjectFact`'s arguments after the scope. */
export interface ProjectFactInput {
  key: string;
  content: string;
  source?: string;
  opts?: Parameters<typeof prepareFactRow>[7];
}

/** Rows per INSERT: 200 rows of ~25 columns stay far under the driver's parameter limit. */
const FACT_INSERT_CHUNK = 200;
/** Columns a batch's conflict update takes from the incoming row; the rest are kept when the row states nothing. */
const TAKEN_FROM_INCOMING = ['content', 'source', 'expiresAt', 'importance', 'contentHash', 'fileAnchors'] as const;
/** The vector columns: a rewrite of the SAME content keeps the vector it has (a batch embeds nothing, so excluded holds none). */
const VECTOR_COLUMNS = ['embedding', 'embeddingModel', 'embeddedAt', 'embedding1024', 'embedding1024Model', 'embedded1024At'] as const;
const KEPT_WHEN_ABSENT = ['origin', 'originExecutionId', 'originModel', 'originPromptTokens', 'originCompletionTokens'] as const;

/**
 * The conflict update of a MULTI-row insert, as SQL text (one SET cannot name a different literal per row):
 * `col = excluded.col`; the vector columns keep the stored vector when the content hash is unchanged
 * (`CASE WHEN … IS NOT DISTINCT FROM`), else take the incoming (cleared) one; and the origin / cost columns
 * `COALESCE(excluded.col, table.col)`, so a rewrite that does not know its run never wipes a stamp.
 * Exported so a test can render it and pin the statement.
 */
export function batchConflictSet(updatedAt: Date = new Date()): Record<string, unknown> {
  const cols = getTableColumns(projectFacts) as unknown as Record<string, { name: string }>;
  const set: Record<string, unknown> = { supersededBy: null, updatedAt };
  const col = (k: string): string => cols[k]!.name;
  for (const k of TAKEN_FROM_INCOMING) set[k] = sql.raw(`excluded."${col(k)}"`);
  for (const k of VECTOR_COLUMNS) {
    set[k] = sql.raw(`CASE WHEN "project_facts"."${col('contentHash')}" IS NOT DISTINCT FROM excluded."${col('contentHash')}" THEN "project_facts"."${col(k)}" ELSE excluded."${col(k)}" END`);
  }
  for (const k of KEPT_WHEN_ABSENT) set[k] = sql.raw(`COALESCE(excluded."${col(k)}", "project_facts"."${col(k)}")`);
  return set;
}

/**
 * THE fact writer: upserts a batch in multi-row statements (PRD 41 A11 rule 4a) — one prior read for the
 * whole batch, then one INSERT … ON CONFLICT per {@link FACT_INSERT_CHUNK} rows. `upsertProjectFact` is the
 * one-fact call of this function, so there is no second writer. Pass a transaction handle as `db` to make the
 * batch part of a larger atomic write. Returns the keys written (an invalid key or empty content is skipped).
 * A later item with the same key replaces an earlier one in the batch.
 */
export async function upsertProjectFacts(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  items: readonly ProjectFactInput[],
  batch: { embed?: boolean; deferVersionBump?: boolean } = {},
): Promise<Set<string>> {
  const embed = batch.embed ?? items.length <= 1;
  const byKey = new Map<string, ProjectFactInput>();
  for (const it of items) {
    const k = (it.key ?? '').trim().slice(0, 255);
    const earlier = byKey.get(k);
    // The single-fact path folds a code map into the stored one; two writes of one map in a batch fold the same way.
    byKey.set(k, earlier && isCodemapKey(k)
      ? { ...it, content: mergeConsolidated(k, earlier.content, it.content), opts: { ...it.opts, fileAnchors: [...(earlier.opts?.fileAnchors ?? []), ...(it.opts?.fileAnchors ?? [])] } }
      : it);
  }
  byKey.delete('');
  const keys = [...byKey.keys()];
  let priors: Map<string, PriorFact> | undefined;
  if (keys.length > 1) {
    priors = new Map();
    for (let i = 0; i < keys.length; i += FACT_INSERT_CHUNK) {
      const rows = await db
        .select({ key: projectFacts.key, recallCount: projectFacts.recallCount, content: projectFacts.content, expiresAt: projectFacts.expiresAt, supersededBy: projectFacts.supersededBy, fileAnchors: projectFacts.fileAnchors })
        .from(projectFacts)
        .where(and(eq(projectFacts.tenantId, tenantId), eq(projectFacts.projectId, projectId), inArray(projectFacts.key, keys.slice(i, i + FACT_INSERT_CHUNK))));
      for (const r of rows) priors.set(r.key, r);
    }
  }
  // Anchors that name no content hash are looked up for the WHOLE batch in one query (a lone fact keeps its own read).
  let reader: FileContentHashReader | undefined;
  if (byKey.size > 1) {
    const unhashed = [...byKey.values()].flatMap((it) => (it.opts?.fileAnchors ?? []).filter((a) => !a.contentHash).map((a) => a.path));
    if (unhashed.length > 0) reader = await hostDirectoryHashesFor(db, tenantId, unhashed);
  }
  const prepared: PreparedFact[] = [];
  for (const it of byKey.values()) {
    const row = await prepareFactRow(env, db, tenantId, projectId, it.key, it.content, it.source ?? 'agent', it.opts, {
      embed, ...(priors ? { priors } : {}), ...(reader ? { reader } : {}),
    });
    if (row) prepared.push(row);
  }
  for (let i = 0; i < prepared.length; i += FACT_INSERT_CHUNK) {
    const chunk = prepared.slice(i, i + FACT_INSERT_CHUNK);
    const target = [projectFacts.tenantId, projectFacts.projectId, projectFacts.key];
    // One row keeps its own literal update (the long-standing single-fact semantics); several take each
    // row's values from `excluded`, since one SET cannot name a different literal per row.
    if (chunk.length === 1) {
      await db.insert(projectFacts).values(chunk[0]!.values).onConflictDoUpdate({ target, set: chunk[0]!.set as never });
    } else {
      await db.insert(projectFacts).values(chunk.map((p) => p.values)).onConflictDoUpdate({ target, set: batchConflictSet() as never });
    }
  }
  if (prepared.length > 0 && !batch.deferVersionBump) await bumpProjectFactsVersion(env, tenantId, projectId);
  return new Set(prepared.map((p) => p.values.key as string));
}

/** Write-through upsert one fact under a stable `key` — the one-fact call of {@link upsertProjectFacts}. */
export async function upsertProjectFact(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  key: string,
  content: string,
  source = 'agent',
  opts?: ProjectFactInput['opts'],
): Promise<boolean> {
  const written = await upsertProjectFacts(
    env, db, tenantId, projectId, [{ key, content, source, ...(opts ? { opts } : {}) }],
    { embed: true, ...(opts?.deferVersionBump ? { deferVersionBump: true } : {}) },
  );
  return written.size > 0;
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
