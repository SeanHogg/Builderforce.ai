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
export interface ScopeProvenance {
  reviewedBy?: string;
  judgeModel?: string;
  policy?: string;
  reviewedAt?: string;
  /** The person who uploaded the pack — recorded by the SERVER on every pack scope write, never taken from a client. */
  uploadedBy?: string;
}

/** What a scope write carries: memory's record plus an uploaded pack's provenance (kept for pack roots only). */
export type KnowledgeScopeWrite = ScopeRecord & { provenance?: ScopeProvenance };

export interface KnowledgeScope extends ScopeRecord {
  /** An uploaded pack's provenance (PRD 40, OD-3); absent on a reviewed root. */
  provenance?: ScopeProvenance;
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
  upsertScope(scope: KnowledgeScopeWrite): Promise<void>;
  /** Model relations judged from `sourceRef` (or its sections) at another hash get `stale_at`. */
  markRelationsStale(sourceRef: NodeRef, currentHash: string): Promise<number>;
  /** `markRelationsStale` for many sources in multi-row statements. Returns edges marked. */
  markRelationsStaleMany(marks: ReadonlyArray<{ sourceRef: NodeRef; currentHash: string }>): Promise<number>;
  /** The author of each of `keys` that exists (null = no recorded author; a missing key is absent from the map). One query per bounded batch. */
  factAuthors(keys: readonly string[]): Promise<Map<string, string | null>>;
  /** Removes every relation with any of `refs` at either end. */
  deleteRelationsOf(refs: NodeRef | readonly NodeRef[]): Promise<number>;
  /** Removes exactly these relations by their upsert identity (`from`, `to`, `kind`), in bounded batches. Returns rows removed. */
  deleteRelationRows(rows: ReadonlyArray<{ from: string; to: string; kind: string }>): Promise<number>;
  /** Removes the root's `knowledge_scopes` row. True when a row existed. */
  deleteScope(rootId: string): Promise<boolean>;
  /** The stored `source` of each of `keys` that exists (a missing key is absent from the map). */
  factSources(keys: readonly string[]): Promise<Map<string, string>>;
  /**
   * Deletes every fact whose `source` IS `source` (provenance — an uploaded pack's facts carry
   * its root id), in bounded batches, and returns the deleted keys plus the relations removed.
   * Each batch removes its facts' `fact:` relations FIRST and then the facts, so a failure part
   * way leaves no relation pointing at a deleted fact and a retry resumes cleanly. It never
   * reads by path. Does NOT bump the knowledge version: the caller bumps once.
   */
  deleteFactsBySource(source: string): Promise<{ keys: string[]; relations: number }>;
  /** The triples (`from\0to\0kind`) among `rows` that are stored today with origin `human`. */
  humanRelationKeys(rows: ReadonlyArray<{ from: string; to: string; kind: string }>): Promise<Set<string>>;
  /** Deletes, in bounded batches, every relation with an end under `src:${rootId}::`. Returns rows removed. */
  deleteRelationsUnder(rootId: string): Promise<number>;
  /** The fact's author, or `undefined` when no such fact exists (null = no recorded author). */
  factAuthor(key: string): Promise<string | null | undefined>;
}

export interface ExtractedCachePort {
  get(hash: string): Promise<Extracted[] | undefined>;
  /** `get` for many hashes at once: ONE index query and coalesced ranged reads (the bulk preload), then the legacy objects for the rest. */
  getMany?(hashes: readonly string[]): Promise<Map<string, Extracted[]>>;
  put(hash: string, extracted: readonly Extracted[]): Promise<void>;
  /** Records the current hash of a source (`''` = removed) as that source's own object. */
  setSource(sourceRef: NodeRef, hash: string): Promise<void>;
  /** Every extracted entry the root's source objects name, current hashes only. */
  rootExtracted(rootId: string): Promise<Extracted[]>;
  /**
   * Deletes the root's source objects (and its bundle) by listing their key prefix, paged —
   * no extracted lookup, so a source whose extracted blob is gone is removed too. Returns how many.
   */
  deleteRootSources(rootId: string): Promise<number>;
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
  /** Forgets the root's latest snapshot, so a root re-created under the same id starts clean. */
  clear(rootId: string): Promise<void>;
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
