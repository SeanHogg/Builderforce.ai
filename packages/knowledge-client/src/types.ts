/**
 * The knowledge API client contract (PRD 38 §4.8). One client for every host: the host
 * injects an authenticated `fetch` scoped to the API origin; the client owns paths,
 * payload shapes, bounds (≤ 500 rows per write) and error mapping.
 */

import type {
  IndexHit,
  JudgementPort,
  JudgementRequest,
  JudgementResult,
  KnowledgeGraph,
  KnowledgeStore,
  MeasuredWith,
  ScopeRecord,
  StoredFact,
  StoredRelation,
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
  /**
   * Client-first judgement (PRD 42 · D2). The host lends a function that tries the device
   * first and calls `send(clientResult)` with its result (or `send()` when it declines, or
   * once more without it when the server refuses it). This package holds no on-device code;
   * the web and Rovr hosts build it with `withClientResult` + `onDeviceJudgement`.
   */
  judgeClientFirst?: (
    req: JudgementRequest,
    send: (clientResult?: unknown) => Promise<JudgementResult>,
  ) => Promise<JudgementResult>;
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
/** Who reviewed an uploaded pack and how (PRD 40, OD-3); each part is optional. */
export interface PackScopeProvenance {
  reviewedBy?: string;
  judgeModel?: string;
  policy?: string;
  reviewedAt?: string;
  /** The person who uploaded the pack — set by the server, read-only for a client. */
  uploadedBy?: string;
}

export interface KnowledgeScopeRecord extends ScopeRecord {
  /** A pack scope's provenance, when the pack carried any (absent on a reviewed root). */
  provenance?: PackScopeProvenance;
  previousDigest?: string;
  /**
   * What the review at `previousDigest` was measured with (PRD 41 §C9; the review at `lastDigest` is memory's
   * `ScopeRecord.measured`). Absent when the platform holds no record — a review stored before it recorded them — which a
   * comparison reads as unknown, never as equal.
   */
  previousMeasured?: MeasuredWith;
  /** `pack` = an uploaded portable knowledge pack, `review` = a reviewed folder. Computed by
   *  the server from the root id (`isPackRootId`); absent from an older server (= `review`). */
  kind?: 'pack' | 'review';
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

/** What a host reads through the client: relations (the seed) and the extracted cache (`preloadExtracted` is a best-effort hint). */
export type KnowledgeClientStore = Pick<KnowledgeStore, 'relations' | 'getExtracted'> & {
  readonly preloadExtracted: (hashes: readonly string[]) => Promise<void>;
};

export interface KnowledgeClient {
  /** The read-through store: the server's relations and the extracted cache. Writes are packs or `writeRows`. */
  store: KnowledgeClientStore;
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
  /**
   * POST …/knowledge/sync — one BFKP pack (PRD 41 A11), or one part of one (syncId, part, parts).
   * Throws {@link KnowledgeSyncConflictError} (409), {@link KnowledgeSyncTooLargeError} (413) or {@link KnowledgeSyncBadPackError} (422).
   */
  sync(rootId: string, part: SyncPart): Promise<SyncAck>;
  /** GET …/knowledge/sync/manifest?root= — the server's generation, root digest and 4,096 bucket digests. */
  syncManifest(rootId: string): Promise<SyncManifest>;
  /** GET …/knowledge/sync/manifest?root=&view=generation — the server's generation and root digest alone (a quiet root's cheap probe). */
  syncGeneration(rootId: string): Promise<{ generation: number; digest: string }>;
  /** POST …/knowledge/sync/manifest — the server's leaves in the given buckets. */
  syncLeaves(rootId: string, bucketIds: readonly number[]): Promise<{ generation: number; leaves: Array<{ key: string; digest: string }> }>;
  /**
   * POST …/knowledge/sync/have — which `(hash, sourceRef)` pairs the project already holds (same order as asked). A hash
   * held only under another root answers false for this root's ref, so just this root's entry is uploaded.
   */
  syncHave(rootId: string, pairs: readonly SyncHavePair[]): Promise<boolean[]>;
  /**
   * POST …/knowledge/write of rows only (≤ 500), stamped with the root: the path for rows a pack does not carry — a person's
   * notes, an agent's facts, a model row with no leaf — each written under its own credential's rules.
   */
  writeRows(rootId: string, rows: { facts: readonly StoredFact[]; relations: readonly StoredRelation[] }): Promise<void>;
  /** DELETE …/facts/:key — author or project admin only; also removes the fact's relations. */
  deleteFact(key: string): Promise<void>;
  /** DELETE …/knowledge/scopes/:rootId — removes an UPLOADED PACK root (the server refuses a reviewed one with 400). */
  deleteRoot(rootId: string): Promise<void>;
}

export class KnowledgeApiError extends Error {
  /** `retryAfterMs`: the server's `Retry-After` on a 429, uncapped (the replica pump waits it out). */
  constructor(readonly status: number, readonly code: string, message: string, readonly retryAfterMs?: number | undefined) {
    super(message);
    this.name = 'KnowledgeApiError';
  }
}

/** A body entry the have-check asks about: the content hash and the source whose entry the stored body must hold. */
export interface SyncHavePair { hash: string; sourceRef: string }

/**
 * One request of a sync: the pack's bytes, or one ordered part of them. What the review was measured with rides IN the
 * pack (its scope's `measured`, BFKP MEAS section, PRD 41 §C9) — never beside it.
 */
export interface SyncPart { bytes: Uint8Array; syncId?: string; part?: number; parts?: number }

/** The server's answer to a pack (or to a part that is not the last). */
export type SyncAck =
  /** `reconcile`: the server invalidated leaves of THIS root while applying the pack (a heal); reconcile before the next delta. */
  | { applied: true; generation: number; digest: string; reconcile?: true }
  | { applied: false; received: number; parts: number };

export interface SyncManifest {
  generation: number;
  /** The server's root digest. */
  digest: string;
  /** 4,096 bucket digests, hex. */
  buckets: string[];
}

/** 409: the server moved (generation_mismatch), could not reach the digest (digest_mismatch) lacks a prior (prior_missing), lacks bodies (extracted_missing, `hashes` names them), lost a part (parts_missing) or saw another pack change the same bodies at the same time (body_conflict: rebuild and resend now). Reconcile or resend. */
export class KnowledgeSyncConflictError extends KnowledgeApiError {
  constructor(code: string, message: string, readonly generation?: number, readonly digest?: string, readonly hashes?: string[]) {
    super(409, code, message);
    this.name = 'KnowledgeSyncConflictError';
  }
}

/** 413: the request is over 8 MB or the pack inflates past 64 MB (pack_too_large). */
export class KnowledgeSyncTooLargeError extends KnowledgeApiError {
  constructor(code: string, message: string) { super(413, code, message); this.name = 'KnowledgeSyncTooLargeError'; }
}

/** 422: the frame is malformed or its CRC failed (bad_pack), or a tombstone named a key the root never synced (not_owned). A defect, not a retry. */
export class KnowledgeSyncBadPackError extends KnowledgeApiError {
  constructor(message: string, code = 'bad_pack') { super(422, code, message); this.name = 'KnowledgeSyncBadPackError'; }
}
