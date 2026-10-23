/**
 * Vectorise memories that have no embedding yet.
 *
 * Two populations need this and neither can be fixed on the write path: every row
 * written before migration 1134, and any row whose embed failed at write time (the
 * write deliberately succeeds without a vector rather than losing the fact). Until
 * a row is embedded it is reachable only by the lexical arm, so the sweep is what
 * makes semantic recall true of the whole store rather than of recent writes.
 *
 * Bounded per pass: the embedding vendor is a paid external call, so the sweep
 * takes a fixed slice and leaves the rest for the next run. It is idempotent —
 * a row leaves the claim set the moment its vector lands.
 *
 * Two spaces (1256): the legacy 1536 column (paid, one batch per run) and the bge-m3
 * 1024 column (free Workers AI, several batches per run behind a resumable keyset
 * cursor) — the latter must cover the store before `e3_free_embeddings` is switched on.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { agentMemory, projectFacts } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { peekCached, setCached } from '../../infrastructure/cache/readThroughCache';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { Env } from '../../env';
import {
  MEMORY_VECTOR_SPACES,
  embedMemoryTexts,
  memoryEmbeddingText,
  toVectorLiteral,
  type MemoryVectorSpace,
} from './memoryEmbedding';
import { backfill1024DrainedKey, spaceWriteFields, type MemoryStore } from './memoryEmbeddingPolicy';
import { unembeddedInSpace, unembeddedMemories, unembeddedProjectFacts } from './memorySemanticRecall';

/** Rows embedded per store per pass. One vendor call per store, batched. */
export const BACKFILL_BATCH = 64;
/**
 * Batches per store per run for the FREE bge-m3 space. The legacy space is a paid call
 * and stays at one batch; bge-m3 runs on the account's Workers AI quota, and the whole
 * store must carry a 1024 vector before `e3_free_embeddings` is switched on.
 */
export const BACKFILL_1024_BATCHES = 8;

type Store = MemoryStore;

/** KV key of the 1024 sweep's keyset cursor, per store. */
export const backfill1024CursorKey = (store: Store): string => `mem:backfill:1024:cursor:${store}`;
const CURSOR_TTL_SECONDS = 30 * 24 * 3600;

interface StoreCounts {
  memories: number;
  projectFacts: number;
}

export interface BackfillResult {
  /** Rows written, summed over both spaces. */
  memories: number;
  projectFacts: number;
  /** Per space — `legacy` is the 1536 column, `bge_m3` the 1024 one. */
  bySpace?: { legacy: StoreCounts; bge_m3: StoreCounts };
  /** Set when the sweep could not run at all (no embedder configured for either space). */
  skipped?: 'no_embedding_key';
}

type Row = { id: string; key: string; content: string };
type WriteVector = (id: string, vector: string, embeddedAt: Date) => Promise<unknown>;

/** Embed one store's slice in `space` and write the vectors back. Returns rows updated. */
async function backfillStore(env: Env, rows: ReadonlyArray<Row>, space: MemoryVectorSpace, write: WriteVector): Promise<number> {
  if (rows.length === 0) return 0;
  const vectors = await embedMemoryTexts(env, rows.map((r) => memoryEmbeddingText(r.key, r.content)), space);
  if (!vectors) return 0;
  const now = new Date();
  let written = 0;
  for (const [index, row] of rows.entries()) {
    const literal = toVectorLiteral(vectors[index] ?? [], space);
    if (!literal) continue;
    try {
      await write(row.id, literal, now);
      written += 1;
    } catch (error) {
      // One bad row must not abandon the batch — the rest are still worth writing,
      // and this row simply stays in the claim set for the next pass.
      reportCaughtError(error, {
        source: 'application/memory/memoryEmbeddingBackfill.ts',
        operation: 'backfillStore',
        level: 'warning',
        context: { space: space.id },
      });
    }
  }
  return written;
}

/**
 * The write for one store + space. DECLARED cross-tenant: the claim set was gathered
 * deployment-wide (see `unembeddedMemories`), so the row's own id is the only thing
 * there is to scope by — and it is stronger than a tenant filter, naming exactly one row
 * this pass already read. It sets only `space`'s columns, from the row's own content;
 * the other space's vector is left as it is.
 */
function writerFor(db: Db, store: Store, space: MemoryVectorSpace): WriteVector {
  return store === 'agent_memory'
    ? (id, vector, at) =>
        db
          .update(agentMemory)
          .set(spaceWriteFields(space, vector, at))
          .where(acrossTenants(agentMemory, 'scheduled_sweep', eq(agentMemory.id, id)))
    : (id, vector, at) =>
        db
          .update(projectFacts)
          .set(spaceWriteFields(space, vector, at))
          .where(acrossTenants(projectFacts, 'scheduled_sweep', eq(projectFacts.id, id)));
}

/**
 * One run of the bge-m3 sweep over one store: up to {@link BACKFILL_1024_BATCHES}
 * keyset batches from the persisted cursor. A short batch means the lap reached the end
 * of the table, so the cursor wraps to the start (rows written since, or whose embed
 * failed, are picked up next lap). Resumable across runs and isolates.
 */
async function backfill1024Store(env: Env, db: Db, store: Store, batch: number): Promise<number> {
  const space = MEMORY_VECTOR_SPACES.bge_m3;
  const write = writerFor(db, store, space);
  let cursor = (await peekCached<string>(env, backfill1024CursorKey(store))) ?? '';
  let written = 0;
  // Drained = a claim from the very start of the table found nothing; any row found
  // clears it. Recall reads this to skip the dual-read fallback's paid query embed.
  let drained: boolean | null = null;
  for (let i = 0; i < BACKFILL_1024_BATCHES; i++) {
    const fromStart = cursor === '';
    const rows = await unembeddedInSpace(db, store, space.id, cursor, batch);
    if (rows.length === 0) {
      if (fromStart) drained = true;
      cursor = '';
      break;
    }
    drained = false;
    const n = await backfillStore(env, rows, space, write);
    written += n;
    // The vendor answered nothing for a whole batch: stop without advancing, so the
    // next run retries these rows instead of walking the table against a dead endpoint.
    if (n === 0) break;
    cursor = rows.length < batch ? '' : rows[rows.length - 1]!.id;
    if (!cursor) break;
  }
  await setCached(env, backfill1024CursorKey(store), cursor, { kvTtlSeconds: CURSOR_TTL_SECONDS });
  if (drained !== null) await setCached(env, backfill1024DrainedKey(store), drained, { kvTtlSeconds: CURSOR_TTL_SECONDS });
  return written;
}

/** Vectorise the next slice of unembedded memories across both stores and both spaces. */
export async function runMemoryEmbeddingBackfill(env: Env, db: Db, batch = BACKFILL_BATCH): Promise<BackfillResult> {
  const legacy = MEMORY_VECTOR_SPACES.legacy;
  const legacyOn = legacy.available(env);
  const bgeOn = MEMORY_VECTOR_SPACES.bge_m3.available(env);
  if (!legacyOn && !bgeOn) return { memories: 0, projectFacts: 0, skipped: 'no_embedding_key' };

  const legacyCounts: StoreCounts = { memories: 0, projectFacts: 0 };
  if (legacyOn) {
    const [memoryRows, factRows] = await Promise.all([unembeddedMemories(db, batch), unembeddedProjectFacts(db, batch)]);
    legacyCounts.memories = await backfillStore(env, memoryRows, legacy, writerFor(db, 'agent_memory', legacy));
    legacyCounts.projectFacts = await backfillStore(env, factRows, legacy, writerFor(db, 'project_facts', legacy));
  }

  const bgeCounts: StoreCounts = { memories: 0, projectFacts: 0 };
  if (bgeOn) {
    bgeCounts.memories = await backfill1024Store(env, db, 'agent_memory', batch);
    bgeCounts.projectFacts = await backfill1024Store(env, db, 'project_facts', batch);
  }

  return {
    memories: legacyCounts.memories + bgeCounts.memories,
    projectFacts: legacyCounts.projectFacts + bgeCounts.projectFacts,
    bySpace: { legacy: legacyCounts, bge_m3: bgeCounts },
  };
}
