/**
 * @builderforce/repo-map — the cloud repo map (PRD C5): bf-index's file reference graph,
 * personalized PageRank and token-budgeted renderer in pure TypeScript, for the surface
 * that has no disk and no `bf-context` binary (the durable cloud runner). The container
 * runs the real bf-context; both produce the same map format.
 */

export { identifiers, queryTerms, searchTerms, splitIdentifier, STOPWORDS } from './terms.js';
export { extractCodeRefs, type CodeRef, type CodeRefKind } from './codeRefs.js';
export {
  DAMPING, FileGraph, MAX_ITERS, TOLERANCE, moduleName,
  type ImportRow, type RefRow, type SerializedFileGraph,
} from './graph.js';
export { extractFileFacts, isMapSource, type FileFacts, type SymbolRow } from './extract.js';
export { DEFAULT_REPO_MAP_LIMITS, SKIP_DIRS, SKIP_FILES, isMapCandidate, type RepoMapLimits } from './filePolicy.js';
export {
  REPO_GRAPH_VERSION, RepoGraph, RepoGraphBuilder,
  type MapSymbol, type RepoGraphStats, type SerializedRepoGraph, type SerializedSymbol,
} from './repoGraph.js';
export { CHARS_PER_TOKEN, MAX_SYMBOLS_PER_FILE, personalization, rankedFiles, renderRepoMap, type RepoMapOptions } from './render.js';
export { searchRepoSymbols, type RepoSymbolHit } from './search.js';
export { repoMapPort } from './workspacePort.js';
