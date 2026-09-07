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
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { agentMemory, projectFacts } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { Env } from '../../env';
import {
  MEMORY_EMBEDDING_MODEL,
  embedMemoryTexts,
  memoryEmbeddingAvailable,
  memoryEmbeddingText,
  toVectorLiteral,
} from './memoryEmbedding';
import { unembeddedMemories, unembeddedProjectFacts } from './memorySemanticRecall';

/** Rows embedded per store per pass. One vendor call per store, batched. */
export const BACKFILL_BATCH = 64;

export interface BackfillResult {
  memories: number;
  projectFacts: number;
  /** Set when the sweep could not run at all (no embedding key configured). */
  skipped?: 'no_embedding_key';
}

/** Embed one store's slice and write the vectors back. Returns rows updated. */
async function backfillStore(
  env: Env,
  db: Db,
  rows: ReadonlyArray<{ id: string; key: string; content: string }>,
  write: (id: string, vector: string, embeddedAt: Date) => Promise<unknown>,
): Promise<number> {
  if (rows.length === 0) return 0;
  const vectors = await embedMemoryTexts(env, rows.map((r) => memoryEmbeddingText(r.key, r.content)));
  if (!vectors) return 0;
  const now = new Date();
  let written = 0;
  for (const [index, row] of rows.entries()) {
    const literal = toVectorLiteral(vectors[index] ?? []);
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
      });
    }
  }
  return written;
}

/** Vectorise the next slice of unembedded memories across both stores. */
export async function runMemoryEmbeddingBackfill(env: Env, db: Db, batch = BACKFILL_BATCH): Promise<BackfillResult> {
  if (!memoryEmbeddingAvailable(env)) return { memories: 0, projectFacts: 0, skipped: 'no_embedding_key' };

  const [memoryRows, factRows] = await Promise.all([
    unembeddedMemories(db, batch),
    unembeddedProjectFacts(db, batch),
  ]);

  // DECLARED cross-tenant, both writes: the claim set was gathered deployment-wide
  // (see `unembeddedMemories`), so the row's own id is the only thing there is to
  // scope by — and it is stronger than a tenant filter, naming exactly one row that
  // this pass already read. The write adds a vector derived from that row's own
  // content and changes nothing else.
  const memories = await backfillStore(env, db, memoryRows, (id, vector, embeddedAt) =>
    db
      .update(agentMemory)
      .set({ embedding: vector, embeddingModel: MEMORY_EMBEDDING_MODEL, embeddedAt })
      .where(acrossTenants(agentMemory, 'scheduled_sweep', eq(agentMemory.id, id))),
  );
  const facts = await backfillStore(env, db, factRows, (id, vector, embeddedAt) =>
    db
      .update(projectFacts)
      .set({ embedding: vector, embeddingModel: MEMORY_EMBEDDING_MODEL, embeddedAt })
      .where(acrossTenants(projectFacts, 'scheduled_sweep', eq(projectFacts.id, id))),
  );

  return { memories, projectFacts: facts };
}
