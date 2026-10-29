/**
 * `@builderforce/knowledge-client` — the ONE typed HTTP client for the knowledge API
 * (PRD 38 §4.8). Hosts inject an authenticated `fetch`; see `client.ts`.
 */
export { createKnowledgeClient, DEFAULT_KNOWLEDGE_BASE_PATH, MAX_WRITE_ROWS } from './client.js';
export {
  KnowledgeApiError,
  type AnalysisSnapshotPayload,
  type GraphQuery,
  type JudgeEstimate,
  type KnowledgeClient,
  type KnowledgeClientOptions,
  type KnowledgeFacts,
  type KnowledgeFetch,
  type KnowledgeScopeRecord,
  type KnowledgeViewer,
} from './types.js';
