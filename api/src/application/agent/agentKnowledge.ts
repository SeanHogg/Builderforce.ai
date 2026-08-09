/**
 * Agent knowledge ingestion + recall — the data provider behind the AgentSpec
 * `memory.recalledContext` field (compile primitive Phase C3, see
 * `PRD-agent-compile-primitive.md`).
 *
 * Ingest: proprietary documents → chunked (shared `chunkText`) → stored in
 * `agent_knowledge_chunks`. Recall: at inference, the agent's chunks are loaded
 * (read-through cached, invalidated on ingest) and BM25-ranked (shared
 * `bm25Search`) against the user's query; the top-K are assembled into a grounded
 * context block that `buildAgentSystemPrompt`/`buildAgentInference` lower into the
 * system prompt. Both retrieval primitives come from `@seanhogg/builderforce-memory`
 * (the `./retrieval` subpath is zero-dep + Worker-safe), so this never duplicates
 * the chunker/BM25.
 */
import { and, asc, eq, gt, isNull, or } from 'drizzle-orm';
import { bm25Search, chunkText, type Bm25Doc } from '@seanhogg/builderforce-memory/retrieval';
import type { Env } from '../../env';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import type { Db } from '../../infrastructure/database/connection';
import { agentKnowledgeChunks, ideAgents } from '../../infrastructure/database/schema';

export interface KnowledgeChunk {
  id: string;
  text: string;
}

/** Default number of chunks recalled and injected at inference. */
export const RECALL_TOP_K = 5;

const cacheKey = (agentId: string) => `agent_knowledge:chunks:${agentId}`;

/**
 * Pure: pick the top-K most relevant chunks for `query` (Okapi BM25) and assemble
 * the recalled-context block. Returns '' when the query is empty, there are no
 * chunks, or nothing overlaps. Unit-testable without a DB.
 */
export function selectRecallContext(query: string, chunks: KnowledgeChunk[], topK: number = RECALL_TOP_K): string {
  if (!query.trim() || chunks.length === 0) return '';
  const docs: Bm25Doc[] = chunks.map((c) => ({ id: c.id, text: c.text }));
  const hits = bm25Search(query, docs).slice(0, topK);
  if (hits.length === 0) return '';
  const byId = new Map(chunks.map((c) => [c.id, c.text]));
  return hits
    .map((h) => byId.get(h.id))
    .filter((t): t is string => Boolean(t))
    .join('\n\n');
}

/** Pure: split documents into storage-ready chunk texts (drops empties). */
export function chunkDocuments(docs: ReadonlyArray<{ text: string }>): string[] {
  return docs.flatMap((d) => chunkText(d.text).map((c) => c.text)).filter((t) => t.trim().length > 0);
}

/** Load an agent's stored chunks, read-through cached (stable until re-ingest). */
export async function loadAgentChunks(env: Env, db: Db, agentId: string): Promise<KnowledgeChunk[]> {
  return getOrSetCached(
    env,
    cacheKey(agentId),
    async () => {
      const rows = await db
        .select({ id: agentKnowledgeChunks.id, chunkText: agentKnowledgeChunks.chunkText })
        .from(agentKnowledgeChunks)
        .where(and(eq(agentKnowledgeChunks.agentId, agentId), or(isNull(agentKnowledgeChunks.expiresAt), gt(agentKnowledgeChunks.expiresAt, new Date()))))
        .orderBy(asc(agentKnowledgeChunks.ordinal));
      return rows.map((r) => ({ id: r.id, text: r.chunkText }));
    },
    { kvTtlSeconds: 300, l1TtlMs: 60_000 },
  );
}

/**
 * Recall the grounded context for `query` from an agent's ingested knowledge.
 * Returns '' when the agent has no knowledge or nothing is relevant — so callers
 * can pass it straight to `recalledContext` (the lowering renders nothing for '').
 */
export async function recallAgentKnowledge(
  env: Env,
  db: Db,
  agentId: string,
  query: string,
  topK: number = RECALL_TOP_K,
): Promise<string> {
  const chunks = await loadAgentChunks(env, db, agentId);
  return selectRecallContext(query, chunks, topK);
}

/**
 * Ingest documents for an agent: chunk → REPLACE the agent's chunk set → invalidate
 * the recall cache. Replace (not append) makes re-ingest idempotent. Returns the
 * number of chunks stored. Single bulk insert (one multi-row VALUES, the Drizzle
 * equivalent of the previous UNNEST) — no per-chunk round-trip.
 */
export async function ingestAgentKnowledge(
  env: Env,
  db: Db,
  agentId: string,
  docs: ReadonlyArray<{ text: string }>,
  source?: string,
): Promise<number> {
  const texts = chunkDocuments(docs);
  const [agent] = await db.select({ tenantId: ideAgents.tenantId }).from(ideAgents).where(eq(ideAgents.id, agentId)).limit(1);
  if (!agent) throw new Error('agent not found');
  await db.delete(agentKnowledgeChunks).where(eq(agentKnowledgeChunks.agentId, agentId));
  if (texts.length > 0) {
    await db.insert(agentKnowledgeChunks).values(
      texts.map((text, i) => ({
        id: crypto.randomUUID(),
        tenantId: agent.tenantId,
        agentId,
        ordinal: i,
        chunkText: text,
        source: source ?? null,
      })),
    );
  }
  await invalidateCached(env, cacheKey(agentId));
  return texts.length;
}
