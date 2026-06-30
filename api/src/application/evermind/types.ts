/** Evermind Knowledge & Learning Pipeline — shared types.

  Functions exported from the pipeline modules (deltaDetected, knowledgeStoreApi)
  must be pure and dependency-free, making this runtime agnostic and unit-testable.
*/

export type DeltaType =
  | 'entity_added'
  | 'entity_modified'
  | 'entity_removed'
  | 'paragraph_added'
  | 'paragraph_modified'
  | 'paragraph_removed'
  | 'data_value_update'
  | 'custom';

/** Baseline record for a knowledge item. We hash content to compare. */
export type BaselineRecord = Readonly<{
  /** Unique resource identifier (title, URL, document id, etc.). */
  key: string;
  /** The authoritative excerpt / representation. */
  content: string;
  /** Source identifier like the source title/desc, for disambiguation. */
  source?: string;
  /** Hints for tagging (optional). */
  tags?: readonly string[];
  /** Ingestion timestamp (UTC). */
  ingestedAt?: Date;
  /** Arbitrary structured data attached to the baseline. */
  metadata?: Readonly<Record<string, unknown>>;
}>;

/** Detected delta between baseline and current state. */
export type DetectedDelta = Readonly<{
  /** Unique identifier for the delta (for reference). */
  id: string;
  /** Affected entity's key. */
  key: string;
  /** Which `IncrementalRecord` collided/changed (if known). */
  sourceKey?: string | null;
  /** Detected type. */
  type: DeltaType;
  /** Baseline content (before). */
  baselineContent: string;
  /** Current content (after). */
  currentContent: string;
  /** Short semantic description of the change (optional). */
  description?: string;
  /** Calculated significance score (higher = more impactful). */
  significance: number; // 0..1
  /** Detected at this ISO timestamp. */
  detectedAt: string;
}>;

/** State radii/truth. Use repository-like public API so code is testable. */
export interface LearningStore {
  /** Add a new accepted delta (F4.1). Return its finalized row. */
  commitKnownDelta(delta: KnownDelta): Promise<KnownDelta>;
  /** Commit an accepted delta with modifications from the reviewer. */
  commitKnownDeltaModified(delta: KnownDeltaWithMod): Promise<KnownDelta>;
  /** Bulk-load presets for efficient training pipelines (F5.3). */
  bulkLoad(presets: ReadonlyArray<KnownDelta>): Promise<void>;
  /** Query according to filters (F4.3). Default uses the in-memory backing. */
  query(filters?: LearningStoreFilters): Promise<ReadonlyArray<KnownDelta>>;
  /** Upsert a delta (make it a known) for teaching/retaining. */
  upsert(delta: IncrementalRecordVersion): Promise<void>;
  /** List all source types tracked. */
  listSourceTypes(): Promise<ReadonlyArray<string>>;
  /** Pull recent deltas (date order). */
  recentUpserts(since?: Date | null, limit?: number): Promise<ReadonlyArray<IncrementalRecordVersion>>;
  /** Pull edited/noted deltas for human inspection. */
  editedItems(project?: string | null): Promise<ReadonlyArray<IncrementalRecordVersion>>;
}

/** Column equivalent of the public learning store (finalized for teaching). */
export type KnownDelta = Readonly<{
  id: string;
  // Core knowledge shape
  key: string;
  title: string;
  content: string;
  docType: string;
  version: number;
  // Attribution
  source: string;
  sourceKey?: string | null;
  type: DeltaType;
  // Origin shape (possibly merged from w staticBaseline shape)
  staticBaseline?: Readonly<Partial<BaselineRecord>> | null;
  // Review decisions
  reviewerId?: string | null;
  reviewerIdentities?: Readonly<{ id: string; name: string } []> | null;
  decision: 'pending' | 'accepted' | 'rejected' | 'modified';
  decisionAt: Date | null;
  // Optional side-by-side diff (human clarifies)
  sideBySideDiff?: string | null;
  // Review workflow emissions (F3.5)
  comments: ReadonlyArray<{
    id: string;
    text: string;
    authorId: string;
    authorName: string;
    createdAt: Date;
  }>;
  notes: string | null;
  // External retention flags (custom metadata)
  metadata?: Readonly<Record<string, unknown>> | null;
}>;

/** Record as drafted for review. Emitted by detection. */
export type IncrementalRecord = Readonly<{
  key: string;
  source: string;
  sourceKey?: string | null;
  type: DeltaType;
  evidence: ReadonlyArray<{
    ts: Date;
    diff?: string;
    snippet?: string;
    explanation?: string;
  }>;
}>;

/** Versioned record (immutable; each edit creates a new version). */
export type IncrementalRecordVersion = Readonly<{
  id: string;
  record: IncrementalRecord;
  timestamp: Date;
  reviewerId?: string | null;
  reviewerIdentities?: Readonly<{ id: string; name: string } []> | null;
  metadata?: Readonly<Record<string, unknown>> | null;
  // When tracked by store, these are merged into the public keys as stored
}>;

/** Base request shape for a recommended delta */
export type DeltaRequest = Readonly<{
  /**什么样样的物品类型 */
  key: string;
  source: string;
  sourceKey?: string | null;
  type: DeltaType;
  candidatePrompts?: ReadonlyArray<string>;
  tags?: ReadonlyArray<string>;
}>;

/** Learn keys. We hash content to compare. */
export type LearningRecord= Readonly<{
  /** Unique resource identifier (title, URL, document id, etc.). */
  key: string;
  /** The authoritative excerpt / representation. */
  content: string;
  /** Source identifier like the source title/desc, for disambiguation. */
  source?: string;
  /** Ingestion timestamp (UTC). */
  ingestedAt?: Date;
  /** Arbitrary structured data attached to the baseline. */
  metadata?: Readonly<Record<string, unknown>>;
}>;

export interface ChainOfThought {
  levels: ReadonlyArray<{
    step: string;
    thought: string;
    reasoning: string;
  }>;
}

export interface DeltaCommitIntent {
  /** Delta id */
  deltaId: string;
  /** Resolved outcome */
  decision: 'accepted' | 'rejected' | 'modified';
  /** For modifications, the applied update */
  body?: string | null;
  /** Optional notes/further clarifications */
  notes: string;
  /** Optional side-by-side diff */
  sideBySideDiff?: string | null;
  /** Optional chain-of-thought for generated intent]
 */
  chainOfThought?: ChainOfThought | null;
}

export type LearningStoreFilters = Readonly<{
  source?: string | null;
  sourceKey?: string | null;
  type?: DeltaType | null;
  decision?: 'pending' | 'accepted' | 'rejected' | 'modified' | null;
  project?: string | null;
  tagsHave?: ReadonlyArray<string> | null;
  tagsNot?: ReadonlyArray<string> | null;
  lastHours?: number | null;
  max?: number | null;
}>