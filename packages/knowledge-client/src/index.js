/**
 * `@builderforce/knowledge-client` — the ONE typed HTTP client for the knowledge API
 * (PRD 38 §4.8). Hosts inject an authenticated `fetch`; see `client.ts`.
 */
export { createKnowledgeClient, DEFAULT_KNOWLEDGE_BASE_PATH } from './client.js';
export { KnowledgeApiError, KnowledgeSyncBadPackError, KnowledgeSyncConflictError, KnowledgeSyncTooLargeError, } from './types.js';
//# sourceMappingURL=index.js.map