/**
 * The knowledge graph's application ports (PRD 38 §4.8). Every knowledge use case takes
 * these; no route imports a table or R2. Adapters:
 *
 *   KnowledgeStorePort     → `knowledgeStore.ts` (project_facts reads, relations, scopes)
 *   ExtractedCachePort     → `knowledgeBlobs.ts` (R2, by content hash + one object per source)
 *   AnalysisSnapshotPort   → `knowledgeBlobs.ts` (R2, the code pack's snapshot per sha)
 *   RepoGraphPort          → `knowledgeRepoGraph.ts` (the project's linked repo map)
 *   KnowledgeIndexPort     → `knowledgeIndexPort.ts` (R2 index blob per scope digest)
 *
 * Each adapter instance is bound to one (tenant, project) — tenancy is decided once, by
 * the route's door + `projectInTenantCached`, before a port exists.
 */
import type {
  Extracted, NodeRef, ScopeRecord, StoredFact, StoredRelation,
} from '@seanhogg/builderforce-memory/knowledge';
import type { SerializedRepoGraphShape } from '@builderforce/agent-tools';

/**
 * A reviewed root as the platform stores it: memory's `ScopeRecord` plus the digest of the
 * review before the last one — Compare's stored baseline (`knowledge_scopes.previous_digest`).
 */
export interface KnowledgeScope extends ScopeRecord {
  previousDigest?: string;
}

export interface KnowledgeStorePort {
  scopes(): Promise<KnowledgeScope[]>;
  scope(rootId: string): Promise<KnowledgeScope | null>;
  /** Live project facts anchored to any of `paths` (a root's sources). */
  facts(paths: ReadonlySet<string>): Promise<StoredFact[]>;
  /** Relations touching the root's sources (`src:${rootId}::…`) or one of `factRefs`. */
  relations(rootId: string, factRefs: ReadonlySet<string>): Promise<StoredRelation[]>;
  /** Upsert on (tenant, project, from, to, kind). Returns rows written. */
  upsertRelations(rows: readonly StoredRelation[], createdBy: string | null): Promise<number>;
  /** On a NEW `lastDigest`, the stored one moves to `previousDigest`. */
  upsertScope(scope: ScopeRecord): Promise<void>;
  /** Model relations judged from `sourceRef` (or its sections) at another hash get `stale_at`. */
  markRelationsStale(sourceRef: NodeRef, currentHash: string): Promise<number>;
  /** Removes every relation with any of `refs` at either end. */
  deleteRelationsOf(refs: NodeRef | readonly NodeRef[]): Promise<number>;
  /** The fact's author, or `undefined` when no such fact exists (null = no recorded author). */
  factAuthor(key: string): Promise<string | null | undefined>;
}

export interface ExtractedCachePort {
  get(hash: string): Promise<Extracted[] | undefined>;
  put(hash: string, extracted: readonly Extracted[]): Promise<void>;
  /** Records the current hash of a source (`''` = removed) as that source's own object. */
  setSource(sourceRef: NodeRef, hash: string): Promise<void>;
  /** Every extracted entry the root's source objects name, current hashes only. */
  rootExtracted(rootId: string): Promise<Extracted[]>;
  /**
   * Records the root's sources (`[{path, hash}]`, sorted) as the immutable review snapshot of
   * `digest`. Written once per digest: an existing snapshot is never rewritten.
   */
  snapshotReview(rootId: string, digest: string): Promise<void>;
  /** The extracted entries the review snapshot of `digest` names; null when there is none. */
  reviewExtracted(rootId: string, digest: string): Promise<Extracted[] | null>;
}

export interface AnalysisSnapshotPort {
  put(sha: string, rootId: string, snapshot: unknown): Promise<void>;
  /** The latest snapshot uploaded for `rootId`. */
  latest(rootId: string): Promise<{ sha: string; snapshot: unknown } | null>;
}

export interface LinkedRepoRoot {
  rootId: string;
  /** The commit the map is built from (the base branch's head). */
  sha(): Promise<string | null>;
  graph(): Promise<SerializedRepoGraphShape | null>;
}

export interface RepoGraphPort {
  /** The project's linked (default) repository as a knowledge root, or null. */
  linked(): Promise<LinkedRepoRoot | null>;
}
