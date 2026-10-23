/**
 * Which vector space a memory write and a recall query use (PRD E3, cost lever
 * `e3_free_embeddings`, migration 1256).
 *
 * `memoryEmbedding` owns the spaces (model ↔ width ↔ credential); this module owns the
 * ONE decision of which space(s) a given tenant writes and reads, so the two writers
 * (`memoryService.remember`, `projectFactsWrite`) and the two recall paths
 * (`memoryService.recall`, `projectFactsRecall`) cannot drift:
 *
 *   lever OFF → write `embedding` (1536, paid) and clear `embedding_1024`; query the
 *               1536 column only. Exactly the pre-1256 behaviour.
 *   lever ON  → write `embedding_1024` (bge-m3, free) and clear the 1536 vector (it
 *               would describe old content); query the 1024 column for rows that have
 *               it AND the 1536 column for rows that do not yet (dual-read), each with
 *               a query vector from the model that produced that column.
 *
 * A bge-m3 failure on write falls back to the 1536 space (logged by `embedMemoryTexts`);
 * the backfill sweep fills whatever column a row is missing either way.
 */
import { isCostLeverOn } from '@builderforce/cost-levers';
import type { Env } from '../../env';
import { peekCached } from '../../infrastructure/cache/readThroughCache';
import {
  MEMORY_VECTOR_SPACES,
  embedMemoryText,
  toVectorLiteral,
  type MemoryVectorSpace,
  type MemoryVectorSpaceId,
} from './memoryEmbedding';

/** The six embedding columns a write sets — every one, so a rewrite never keeps a stale vector. */
export interface MemoryEmbeddingFields {
  embedding: string | null;
  embeddingModel: string | null;
  embeddedAt: Date | null;
  embedding1024: string | null;
  embedding1024Model: string | null;
  embedded1024At: Date | null;
}

/** No vector in any space — what a write stores when nothing could embed it. */
export const NO_MEMORY_EMBEDDING: Readonly<MemoryEmbeddingFields> = {
  embedding: null,
  embeddingModel: null,
  embeddedAt: null,
  embedding1024: null,
  embedding1024Model: null,
  embedded1024At: null,
};

/** The column triple each space writes. Data, not a branch per call site. */
const WRITE_FIELDS: Record<MemoryVectorSpaceId, (literal: string, model: string, at: Date) => Partial<MemoryEmbeddingFields>> = {
  legacy: (embedding, embeddingModel, embeddedAt) => ({ embedding, embeddingModel, embeddedAt }),
  bge_m3: (embedding1024, embedding1024Model, embedded1024At) => ({ embedding1024, embedding1024Model, embedded1024At }),
};

/** Just `space`'s three columns (vector, model stamp, time) — what the backfill sets. */
export function spaceWriteFields(space: MemoryVectorSpace, literal: string, at: Date): Partial<MemoryEmbeddingFields> {
  return WRITE_FIELDS[space.id](literal, space.model, at);
}

/** True when the tenant's memory reads and writes are on the free bge-m3 space. */
export function freeMemoryEmbeddingsOn(env: Env, tenantId: number): boolean {
  return isCostLeverOn(env, 'e3_free_embeddings', tenantId);
}

/** The spaces a write tries, in order. */
function writeSpaces(env: Env, tenantId: number): MemoryVectorSpace[] {
  return freeMemoryEmbeddingsOn(env, tenantId)
    ? [MEMORY_VECTOR_SPACES.bge_m3, MEMORY_VECTOR_SPACES.legacy]
    : [MEMORY_VECTOR_SPACES.legacy];
}

/**
 * Embed `text` for a write and return the full column set. Best-effort by contract: no
 * vector (no key, vendor down) returns all-null columns and the write proceeds — the
 * lexical arm still recalls the row and the backfill vectorises it later.
 */
export async function memoryEmbeddingFieldsFor(env: Env, tenantId: number, text: string, now: Date = new Date()): Promise<MemoryEmbeddingFields> {
  for (const space of writeSpaces(env, tenantId)) {
    const literal = toVectorLiteral((await embedMemoryText(env, text, space)) ?? [], space);
    if (literal) return { ...NO_MEMORY_EMBEDDING, ...spaceWriteFields(space, literal, now) };
  }
  return { ...NO_MEMORY_EMBEDDING };
}

/** One query vector and the column it may be compared against. */
export interface MemoryQueryVector {
  space: MemoryVectorSpace;
  literal: string;
  /** Restrict the ANN read to rows with NO vector in this space (dual-read fallback). */
  onlyRowsLacking?: MemoryVectorSpaceId;
}

export type MemoryStore = 'agent_memory' | 'project_facts';

/**
 * Set by the 1024 backfill when a full lap over `store` found no row without a bge-m3
 * vector, cleared when one finds any. While every store a recall reads is drained, the
 * dual-read fallback arm has nothing to find, so its (paid) query embed is skipped —
 * otherwise the lever would still pay for one 1536 embed per recall forever.
 */
export const backfill1024DrainedKey = (store: MemoryStore): string => `mem:backfill:1024:drained:${store}`;

/** True when the 1024 backfill's last lap over EVERY store in `stores` found nothing to
 *  embed. KV only — the cron reads it to pick the backfill's cadence. */
export async function allDrained(env: Env, stores: readonly MemoryStore[]): Promise<boolean> {
  const flags = await Promise.all(stores.map((store) => peekCached<boolean>(env, backfill1024DrainedKey(store))));
  return flags.every((flag) => flag === true);
}

/**
 * The query vectors a recall searches with. Lever off → the one 1536 vector (or none).
 * Lever on → the bge-m3 vector plus, while rows without one remain in `stores`, the
 * 1536 vector restricted to those rows; a failed bge-m3 embed degrades to the 1536
 * space alone.
 */
export async function memoryQueryVectors(
  env: Env,
  tenantId: number,
  query: string,
  stores: readonly MemoryStore[] = ['agent_memory', 'project_facts'],
): Promise<MemoryQueryVector[]> {
  const q = query.trim();
  if (!q) return [];
  const legacy = MEMORY_VECTOR_SPACES.legacy;
  if (!freeMemoryEmbeddingsOn(env, tenantId)) {
    const literal = toVectorLiteral((await embedMemoryText(env, q)) ?? []);
    return literal ? [{ space: legacy, literal }] : [];
  }
  const bge = MEMORY_VECTOR_SPACES.bge_m3;
  const bgeVector = await embedMemoryText(env, q, bge);
  const needLegacy = !bgeVector || !(await allDrained(env, stores));
  const legacyVector = needLegacy ? await embedMemoryText(env, q, legacy) : null;
  const bgeLiteral = toVectorLiteral(bgeVector ?? [], bge);
  const legacyLiteral = toVectorLiteral(legacyVector ?? [], legacy);
  const out: MemoryQueryVector[] = [];
  if (bgeLiteral) out.push({ space: bge, literal: bgeLiteral });
  if (legacyLiteral) out.push({ space: legacy, literal: legacyLiteral, ...(bgeLiteral ? { onlyRowsLacking: 'bge_m3' as const } : {}) });
  return out;
}
