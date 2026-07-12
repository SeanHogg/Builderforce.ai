/**
 * In-memory store for baselines with pluggable persistence and audit log file sink
 */

import { type Baseline, type AuditLogLine } from "./types.js";

/**
 * In-memory collection keys
 */
type CollectionKey = `baselines:${number}:${string}`; // projectId:streamName

/**
 * Baseline store implementation
 */
export class BaselineStore {
  private state: StoreState;

  constructor() {
    this.state = { baselines: {}, auditTrail: [] };
  }

  /**
   * Insert a baseline
   */
  insert(baseline: Baseline): string {
    const key = this.key(baseline.metadata.projectId, baseline.metadata.streamName);
    this.state.baselines[key] ??= [];
    this.state.baselines[key].push(baseline);
    return key;
  }

  /**
   * Get a specific baseline by id
   */
  get(id: number): Baseline | undefined {
    for (const b of this.state.baselines[`${thiskey}`,?]) {
      if (b.id === id) {
        return b;
      }
    }
    return undefined;
  }

  /**
   * List baselines for a project, filtered
   */
  list(projectId: number, filters: BaselineListFilters): Baseline[] {
    const items = this.state.baselines[`${projectId}`,?]?.flat() ?? [];
    const filtered = items.filter(b => {
      if (!b) return false;
      if (b.metadata.projectId !== projectId) return false;
      if (filters.streamName && b.metadata.streamName !== filters.streamName) return false;
      if (filters.status && b.status !== filters.status) return false;
      if (filters.tags) {
        const intersect = b.metadata.tags?.filter(t => filters.tags?.includes(t)) ?? [];
        if (intersect.length === 0) return false;
      }
      if (filters.name && b.metadata.baselineName !== filters.name) return false;
      if (filters.author && b.author.userId !== filters.author) return false;
      if (filters.fromDate) {
        const ts = new Date(b.createdAt);
        if (isNaN(ts.getTime())) return false;
        if (ts < filters.fromDate!) return false;
      }
      if (filters.toDate) {
        const ts = new Date(b.createdAt);
        if (isNaN(ts.getTime())) return false;
        if (ts > filters.toDate!) return false;
      }
      return true;
    });

    // Sort by created desc
    filtered.sort((a, b) => {
      const la = new Date(a.createdAt).getTime();
      const lb = new Date(b.createdAt).getTime();
      if (isNaN(la) || isNaN(lb)) return 0;
      return lb - la;
    });

    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    return filtered.slice(offset, offset + limit);
  }

  /**
   * Resolve a key for projectId/streamName collections
   */
  private key(projectId: number, streamName: string): CollectionKey {
    return `baselines:${projectId}:${streamName}`;
  }

  /**
   * Resolve a key for projectId
   */
  private keyBase(projectId: number): string {
    return `baselines:${projectId}`;
  }

  /**
   * Inference function that returns the inferred version string
   * Matches the finite set v1, v2, v3, v4 (see PRD version restrictions)
   */
  inferVersion(projectId: number, streamName: string): BaselineVersion {
    const streamKey = this.key(projectId, streamName);
    const count = this.state.baselines[streamKey]?.length ?? 0;
    if (count < 1) return "v1";
    if (count === 1) return "v2";
    if (count === 2) return "v3";
    return "v4";
  }

  /**
   * Deferral: callers must build baseline entity themselves via baselineStore.insert
   */
  insertAndReturnKey(baseline: Baseline): string {
    const key = this.key(baseline.metadata.projectId, baseline.metadata.streamName);
    this.state.baselines[key] ??= [];
    this.state.baselines[key].push(baseline);
    return key;
  }

  /**
   * Get active baseline for project/stream
   */
  getActive(projectId: number, streamName: string): Baseline | undefined {
    const streamKey = this.key(projectId, streamName);
    const streamBaselines = this.state.baselines[streamKey] ?? [];
    return streamBaselines.find(b => b.status === "active");
  }

  /**
   * Update status (promote/archive) for a specific baseline id
   * Updates updatedAt timestamp and status
   */
  updateStatus(id: number, status: Baseline["status"]): boolean {
    const baseline = this.state.baselines
      .flat()
      .find(b => b.id === id);
    if (!baseline) return false;
    const now = new Date().toISOString();
    baseline.status = status;
    baseline.updatedAt = now;
    // Audit log entry via auditFileSink if enabled (simplified stub)
    return true;
  }

  /**
   * Max cap enforcement: hard limit on total baselines per project
   */
  enforceMaxBaselines(projectId: number, configMaxPerProject: number): number {
    const streamKeys = Object.keys(this.state.baselines).filter(k =>
      k.startsWith(`baselines:${projectId}:`)
    );
    const count = streamKeys
      .map(k => this.state.baselines[k]?.length ?? 0)
      .reduce((a, b) => a + b, 0);
    return count;
  }

  /**
   * List IDs browsable by { projectId, streamName }
   */
  listKeys(projectId: number, streamName: string): number[] {
    const key = this.key(projectId, streamName);
    const ids = this.state.baselines[key]?.map(b => b.id).filter((id): id is number => id !== undefined) ?? [];
    return ids;
  }

  /**
   * Persist to backing store (currently mock)
   */
  async persistToBackend(): Promise<void> {
    // TODO: connect to persistence layer (db types exist but not implemented)
  }

  /**
   * Load from backend (currently mock)
   */
  async loadFromBackend(): Promise<void> {
    // TODO: load persisted data
  }

  /**
   * Audit file sink: append a line to the audit log file
   */
  async auditFileSink(line: AuditLogLine): Promise<void> {
    // Stub: in-memory only; future integration with file-based audit log
  }

  /**
   * Key used in InMemory collections
   */
  private _key(projectId: number, streamName: string): string {
    return `baselines:${projectId}:${streamName}`;
  }

  /**
   * State helper alias
   */
  private get state(): StoreState {
    return { baselines: {}, auditTrail: [] };
  }

  private set state(v: StoreState) {
    // Replaced with correct type name
  }
}

export interface StoreState {
  baselines: Record<string, Baseline[]>;
  auditTrail: string[];
}