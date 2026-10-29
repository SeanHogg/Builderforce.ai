/**
 * The knowledge API client contract (PRD 38 §4.8). One client for every host: the host
 * injects an authenticated `fetch` scoped to the API origin; the client owns paths,
 * payload shapes, bounds (≤ 500 rows per write) and error mapping.
 */

import type {
  Extracted,
  IndexHit,
  JudgementPort,
  KnowledgeGraph,
  KnowledgeStore,
  ScopeRecord,
  StoredFact,
} from '@seanhogg/builderforce-memory/knowledge';

/** `fetch`-compatible; `path` is API-relative (e.g. `/api/projects/12/knowledge/scopes`). */
export type KnowledgeFetch = (path: string, init?: RequestInit) => Promise<Response>;

export interface KnowledgeClientOptions {
  fetch: KnowledgeFetch;
  projectId: number;
  /**
   * The front door the routes sit behind: `/api/projects` (default) for a tenant JWT,
   * `/api/agent/projects` for an on-prem agent host's key (`Bearer` + `X-AgentHost-Id`).
   */
  basePath?: string;
}

/** Who is reading, as the server decides it: the person (null for a machine caller) and
 *  whether they may administer every fact (project admin or superadmin). A host offers
 *  Delete on a fact when `canAdmin`, when the fact has no author, or when the author is
 *  `userId` — the same rule the delete route enforces. */
export interface KnowledgeViewer {
  userId: string | null;
  canAdmin: boolean;
}

/** GET …/knowledge/facts?root= — the root's stored facts with their author and origin. */
export interface KnowledgeFacts {
  facts: StoredFact[];
  viewer: KnowledgeViewer;
}

export interface GraphQuery {
  focus?: string[];
  maxNodes?: number;
  /** A past review digest of the root (e.g. a scope's `previousDigest`): the graph as that
   *  review saw its sources, joined with today's facts — Compare's stored baseline. */
  at?: string;
}

/** A reviewed root as the API lists it: memory's record plus the digest of the review
 *  before the last one (Compare's baseline), when there has been one. */
export interface KnowledgeScopeRecord extends ScopeRecord {
  previousDigest?: string;
}

/** Code-pack analyzer snapshot, as produced by agent-tools `codeAnalysis.ts`. Opaque here. */
export type AnalysisSnapshotPayload = Record<string, unknown>;

/** GET …/knowledge/judge/estimate — what one judged section ≈ costs, where the SERVER routes it
 *  (it alone knows the connected accounts and the routing). */
export interface JudgeEstimate {
  /** ≈ USD of one judged section; 0 when free or local; null when the price is unknown. */
  perCallUsd: number | null;
  /** The model the call routes to first; null when nothing is routable. */
  model: string | null;
  /** True when that model runs on the tenant's own machine — no cost. */
  local: boolean;
}

export interface KnowledgeClient {
  /** KnowledgeStore over POST …/knowledge/write, GET …/knowledge/scopes, extracted cache routes. */
  store: KnowledgeStore;
  /** JudgementPort over POST …/knowledge/judge (a routed, usage-attributed model call). */
  judgement: JudgementPort;
  scopes(): Promise<KnowledgeScopeRecord[]>;
  /** GET …/knowledge/judge/estimate — the confirm chip's per-call price (the project is the client's). */
  judgeEstimate(): Promise<JudgeEstimate>;
  /** GET …/knowledge-graph?root=&focus=&maxNodes=&at= (server-built, cached). Null when the root
   *  (or, with `at`, that review's snapshot) is unknown. */
  graph(rootId: string, q?: GraphQuery): Promise<KnowledgeGraph | null>;
  /** GET …/knowledge/facts?root= — the root's stored facts (author + origin) and the viewer.
   *  Null when the root is unknown. */
  facts(rootId: string): Promise<KnowledgeFacts | null>;
  search(rootId: string, q: string, k?: number): Promise<IndexHit[]>;
  /** PUT …/code-analysis/:sha */
  putAnalysis(sha: string, snapshot: AnalysisSnapshotPayload): Promise<void>;
  /** PUT …/knowledge/extracted/:hash */
  putExtracted(hash: string, extracted: Extracted[]): Promise<void>;
  /** DELETE …/facts/:key — author or project admin only; also removes the fact's relations. */
  deleteFact(key: string): Promise<void>;
}

export class KnowledgeApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'KnowledgeApiError';
  }
}
