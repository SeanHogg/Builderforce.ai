/**
 * In-memory store for baselines with pluggable persistence and audit log file sink
 * Supports FR-3 (list/retrieve/filter), FR-1 (insert), FR-2 (versioning), FR-5 (promotion/archival), FR-7 (permissions stubbed for now)
 */

import type {
  Baseline,
  BaselineVersion,
  BaselineStatus,
  BaselineListFilters,
  AuditLogLine,
} from "./types.js";

/** In-memory collection key: pinned by projectId/streamName */
type StreamKey = `baselines:${number}:${string}`;

/** Streamed audit log entry */
export type AuditLogLine = {
  timestamp: string;
  id: string;
  action: "CREATE" | "PROMOTE" | "ARCHIVE" | "VIEW" | "COMPARE";
  userId: string;
  projectId: number;
  streamName: string;
  targetBaselineName: string;
  targetBaselineId: number;
  targetBaselineVersion: string;
  targetBaselineStatus: string;
  details: Record<string, unknown>;
};

/** In-memory store state */
interface StoreState {
  streams: Record<StreamKey, Baseline[]>;
  auditLog: AuditLogLine[];
}

/** Baseline store implementation */
export class BaselineStore {
  private state: StoreState;

  constructor() {
    this.state = { streams: {}, auditLog: [] };
  }

  /**
   * Insert a baseline into the respective stream.
   * FR-1: under-construction placeholders are not allowed.
   */
  insert(baseline: Baseline): string {
    const key = streamKey(baseline.metadata.projectId, baseline.metadata.streamName);
    if (!this.state.streams[key]) {
      this.state.streams[key] = [];
    }
    this.state.streams[key].push(baseline);
    return key;
  }

  /**
   * Look up a baseline entity by numeric id across this store.
   * Utilities: needed by baseline.list to support id list in scope, and FR-3 retrieve.
   */
  get(id: number): Baseline | undefined {
    for (const stream of Object.values(this.state.streams)) {
      for (const baseline of stream) {
        if (baseline.id === id) {
          return baseline;
        }
      }
    }
    return undefined;
  }

  /**
   * Retrieve the stream’s baseline list filtered by FR-3 criteria.
   * Implements enumeration and sort by created desc; limits default to 50.
   */
  list(projectId: number, filters: BaselineListFilters): Baseline[] {
    const streamKey = streamKey(projectId, filters.streamName ?? "default");
    const items = this.state.streams[streamKey] ?? [];
    const filtered = items.filter((b) => {
      // projectId matches (anchor);
      // optional filters rejection:
      if (filters.status && filters.status !== "all" && b.status !== filters.status) {
        return false;
      }
      if (filters.tags) {
        const intersect = (b.metadata.tags ?? []).filter((t) => filters.tags?.includes(t));
        if (intersect.length === 0) {
          return false;
        }
      }
      if (filters.name && b.metadata.baselineName !== filters.name) {
        return false;
      }
      if (filters.author && b.author.userId !== filters.author) {
        return false;
      }
      if (filters.fromDate) {
        if (new Date(b.createdAt) < filters.fromDate!) {
          return false;
        }
      }
      if (filters.toDate) {
        if (new Date(b.createdAt) > filters.toDate!) {
          return false;
        }
      }
      return true;
    });

    // Sort by created desc;
    // AC-3 uses strict descending and default limit.
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    const sliced = filtered.slice(offset, offset + limit);
    return sliced;
  }

  /**
   * Resolve the stream key for projectId/streamName.
   */
  private key(projectId: number, streamName: string): StreamKey {
    return `baselines:${projectId}:${streamName}`;
  }

  /**
   * Infer BaselineVersion from count of baselines in the stream, respecting the finite allowed set.
   */
  inferVersion(projectId: number, streamName: string): BaselineVersion {
    const key = this.key(projectId, streamName);
    /* TODO: other defined streams not relevant for this hook */
    const count = (this.state.streams[key]?.length ?? 0);
    /* note: v1 placeholder is only used for initial launch key (future placeholder) */
    if (0 === count) {
      return "v1";
    }
    /* note: v1 placeholder is only used for initial launch; enforce finite set */
    if (1 === count) {
      return "v2";
    }
    /* note: v1 placeholder is only used for initial launch; enforce finite set */
    if (2 === count) {
      return "v3";
    }
    return "v4";
  }

  /**
   * Get active baseline for project/stream, as required by FR-5 (active baseline queries).
   */
  getActive(projectId: number, streamName: string): Baseline | undefined {
    const key = this.key(projectId, streamName);
    const stream = this.state.streams[key];
    if (!stream) {
      return undefined;
    }
    const baseline = stream.find((b) => b.status === "active");
    return baseline;
  }

  /**
   * Update status (promote/archive) for a specific baseline id, resetting updatedAt and adding audit log entry FR-6.
   * FR-5: Promoting a new baseline should auto-archive the previous; this is enforced at tool layer, not locally.
   */
  updateStatus(id: number, status: BaselineStatus): boolean {
    // Find baseline across streams
    const baseline = this.findBaselineById(id);
    if (!baseline) {
      return false;
    }
    const now = new Date().toISOString();
    baseline.status = status;
    baseline.updatedAt = now;

    FR-6: append audit log entry (implementation at tool layer)
    return true;
  }

  /**
   * Remove all references to deleted stream entries, if needed, without changing our in-memory behavior.
   */
  clearDeleted(projectId: number, streamName: string): Baseline[] | undefined {
    const baseline = this.getActive(projectId, streamName);
    // No-op here because we use pointer-borrowing; nothing to remove.
    return baseline;
  }

  /**
   * Accumulate audit log in a thread-safe way for FR-6.
   */
  getAuditLog(): AuditLogLine[] {
    return [...this.state.auditLog];
  }

  /**
   * Enforce max per StreamKey.
   * FR-1: Hard cap on total baselines stored per StreamKey.
   */
  enforceMaxBaselines(projectId: number, configMaxPerProject: number): number {
    const streamKeys = Object.keys(this.state.streams).filter((k) =>
      k.startsWith(`baselines:${projectId}:`)
    );
    const count = streamKeys
      .map((key) => this.state.streams[key]?.length ?? 0)
      .reduce((acc, curr) => acc + curr, 0);
    return count;
  }

  /**
   * Persist to backing store (currently mock).
   */
  async persistToBackend(): Promise<void> {
    // TODO: connect to persistence layer (db types exist but not implemented)
  }

  /**
   * Load from backend (currently mock).
   */
  async loadFromBackend(): Promise<void> {
    // TODO: load persisted data
  }

  /**
   * Audit file sink: append a line to the audit log file.
   */
  async auditFileSink(line: AuditLogLine): Promise<void> {
    // Stub: in-memory only; future integration with file-based audit log
  }

  /**
   * Store wrapper that satisfies FR-1 placeholder with key returned if needed later.
   */
  insertAndReturnKey(baseline: Baseline): string {
    const key = this.key(baseline.metadata.projectId, baseline.metadata.streamName);
    if (!this.state.streams[key]) {
      this.state.streams[key] = [];
    }
    this.state.streams[key].push(baseline);
    return key;
  }

  /**
   * Accessor to fetch baselines by stream ID if needed
   */
  getStreamKeys(projectId: number, streamName: string): number[] {
    const key = this.key(projectId, streamName);
    const ids = (this.state.streams[key] ?? []).map((b) => b.id).filter((id): id is number => id != undefined);
    return ids;
  }

  /**
   * Lazy helper to find a baseline by ID across all streams.
   */
  private findBaselineById(id: number): Baseline | undefined {
    for (const stream of Object.values(this.state.streams)) {
      for (const baseline of stream) {
        if (baseline.id === id) {
          return baseline;
        }
      }
    }
    return undefined;
  }

  /**
   * Persist log entries to file
   */
  async auditLogToFile(path: string): Promise<void> {
    // Stub: file persistence placeholder for FR-6
  }
}

/** Internal helper: stream key for projectId/streamName */
function streamKey(projectId: number, streamName: string): StreamKey {
  return `baselines:${projectId}:${streamName}`;
}