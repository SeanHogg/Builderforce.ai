/**
 * `@builderforce/knowledge-client` — the ONE typed HTTP client for the knowledge API
 * (PRD 38 §4.8). Hosts inject an authenticated `fetch`; see `client.ts`.
 */
export { createKnowledgeClient, DEFAULT_KNOWLEDGE_BASE_PATH } from './client.js';
export {
  KnowledgeApiError,
  KnowledgeSyncBadPackError,
  KnowledgeSyncConflictError,
  KnowledgeSyncTooLargeError,
  type SyncAck,
  type SyncHavePair,
  type SyncManifest,
  type SyncPart,
  type AnalysisSnapshotPayload,
  type GraphQuery,
  type JudgeEstimate,
  type KnowledgeClient,
  type KnowledgeClientOptions,
  type KnowledgeClientStore,
  type KnowledgeFacts,
  type KnowledgeFetch,
  type KnowledgeScopeRecord,
  type KnowledgeViewer,
  type PackScopeProvenance,
} from './types.js';
