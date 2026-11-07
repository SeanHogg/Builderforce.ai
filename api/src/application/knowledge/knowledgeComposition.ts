/**
 * The knowledge ports for one (tenant, project), composed once per request — the only
 * place the application wires its Postgres, R2, repo-map and embedder adapters to the
 * knowledge use cases. Routes take this; they never import a table or a bucket.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { r2AnalysisSnapshots } from './knowledgeBlobs';
import { bgeM3Embedder, knowledgeEmbeddingAvailable } from './knowledgeEmbedder';
import type { KnowledgeGraphDeps } from './getKnowledgeGraph';
import { r2KnowledgeIndexPort, type KnowledgeIndexPort } from './knowledgeIndexPort';
import type { ExtractedCachePort, KnowledgeStorePort } from './knowledgePorts';
import { cloudRepoGraphPort } from './knowledgeRepoGraph';
import { knowledgeVersion } from './knowledgeVersion';
import { knowledgeWritePortsFor } from './knowledgeWritePorts';
import { r2KnowledgeSync } from './sync/knowledgeSyncBlobs';
import { drizzleLedger } from './knowledgeLedger';
import type { KnowledgeSyncPort } from './sync/knowledgeSyncPorts';

export interface KnowledgePorts {
  env: Env;
  db: Db;
  tenantId: number;
  projectId: number;
  store: KnowledgeStorePort;
  extracted: ExtractedCachePort;
  graph: KnowledgeGraphDeps;
  index: KnowledgeIndexPort;
  /** Pack sync's state and staging (PRD 41 A11). */
  sync: KnowledgeSyncPort;
}

export function knowledgePortsFor(env: Env, db: Db, tenantId: number, projectId: number): KnowledgePorts {
  const { store, extracted } = knowledgeWritePortsFor(env, db, tenantId, projectId);
  return {
    env, db, tenantId, projectId, store, extracted, sync: r2KnowledgeSync(env, tenantId, projectId, drizzleLedger(db, tenantId, projectId)),
    graph: {
      cacheEnv: env, tenantId, projectId, store, extracted,
      analysis: r2AnalysisSnapshots(env, tenantId, projectId),
      repo: cloudRepoGraphPort(env, db, tenantId, projectId),
      version: () => knowledgeVersion(env, tenantId, projectId),
    },
    index: r2KnowledgeIndexPort(env, knowledgeEmbeddingAvailable(env) ? bgeM3Embedder(env) : undefined),
  };
}
