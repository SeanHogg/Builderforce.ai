/**
 * The ports the knowledge WRITERS need — Postgres store + R2 perception — and nothing else.
 *
 * Split from `knowledgeComposition.ts` on purpose: the full composition also wires the
 * linked-repo port (`resolveRepoCredential` → board sync → the cloud agent engine → the MCP
 * catalog), the embedder and the index. The facts routes and `writeKnowledge` must stay
 * light, so they compose from here.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { r2ExtractedCache } from './knowledgeBlobs';
import type { ExtractedCachePort, KnowledgeStorePort } from './knowledgePorts';
import { drizzleKnowledgeStore } from './knowledgeStore';

export interface KnowledgeWritePorts {
  store: KnowledgeStorePort;
  extracted: ExtractedCachePort;
}

export function knowledgeWritePortsFor(env: Env, db: Db, tenantId: number, projectId: number): KnowledgeWritePorts {
  return { store: drizzleKnowledgeStore(db, tenantId, projectId), extracted: r2ExtractedCache(env, tenantId, projectId) };
}
