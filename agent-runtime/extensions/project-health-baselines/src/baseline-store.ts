/**
 * In-memory store for baselines with pluggable persistence and audit file sink
 */

import { Baseline } from "./types.js";
import { AuditLogLine } from "./types.js";

/**
 * In-memory collection keys
 */
type CollectionKey = `baselines:${number}:${string}`; // projectId:streamName

/**
 * Baseline store implementation
 */
export class BaselineStore {
  private state: State;

  constructor() {
    this.state = {
      baselines: {},
      auditTrail: []
    };
  }

  /**
   * Insert a baseline
   */
  insert(baseline: Baseline): boolean {
    const key = this.key(baseline.metadata.projectId, baseline.metadata.streamName);
    this.state.baselines[key] = baseline;
    this.state.auditTrail.push(JSON.stringify(baseline));
    return true;
  }

  /**
   * Get a specific baseline by id
   */
  get(id: number): Baseline | undefined {
    for (const b of Object.values(this.state.baselines)) {
      if (b.id === id) {
        return b;
      }
    }
    return undefined;
  }

  /**
   * List baselines for a project, filtered
   */
  list(projectId: number, filters: {
    streamName?: string;
    status?: string;
    tags?: string[];
    name?: string;
    author?: string;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
    offset?: number;
  }): Baseline[] {
    const items = Object.values(this.state.baselines);
    const filtered = items.filter(b => {
      if (b.metadata.projectId !== projectId) return false;
      if (filters.streamName && b.metadata.streamName !== filters.streamName) return false;
      if (filters.status && b.status !== filters.status) return false;
      if (filters.tags) {
        const intersect = b.metadata.tags?.filter(t => filters.tags?.includes(t));
        if (!intersect || intersect.length === 0) return false;
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
    // sort by created desc
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    return filtered.slice(offset, offset + limit);
  }

  /**
   * List IDs browsable by { projectId, streamName }
   */
  listKeys(projectId: number, streamName: string): number[] {
    const key = this.key(projectId, streamName);
    const ids = Object.keys(this.state.baselines).filter(k => k.startsWith(key + ":"));
    return ids.map(k => k.split(":").pop()!).map(Number);
  }

  /**
   * Upsert: get if exists or auto-increment version
   */
  upsert(projectId: number, streamName: string, currentIds: number[]): Baseline | undefined {
    const existing = currentIds.length === 0 ? undefined : this.listKeys(projectId, streamName).reduce((acc, id) => {
      const b = this.get(id);
      return acc ?? b;
    }, undefined);
    // auto-increment version guessed type
    const count = Object.values(this.state.baselines).filter(b => b.metadata.projectId === projectId && b.metadata.streamName === streamName).length + (existing ? 1 : 0);
    const version = count === 0 ? "v1" : count === 1 ? "v2" : count === 2 ? "v3" : "v4";
    return existing; // caller builds via store.insert from caller's entity
  }

  /**
   * Upsert helper used by clients: if existing is undefined, we treat caller as requesting creation with the given `input` baseline; otherwise we reuse and return undefined.
   */
  upsertInput(projectId: number, streamName: string, existingIds: number[]): Baseline | undefined {
    const existing = existingIds.length === 0 ? undefined : this.listKeys(projectId, streamName).reduce((acc, id) => {
      const b = this.get(id);
      return acc ?? b;
    }, undefined);
    if (!existing) return undefined; // request not create: caller must insert a new baseline instance
    return existing;
  }

  /**
   * Update audio response (impl: modify content / metadata fields)
   * TODO: implement once metadata content modeling has been designed
   */
  update(id: number, changes: Record<string, unknown>): Baseline | undefined {
    const b = this.get(id);
    if (!b) return undefined;
    const updated = { ...b, ...changes };
    this.insert(updated); // re-insert to update timestamps
    return updated;
  }

  /**
   * Key helper
   */
  private key(projectId: number, streamName: string): string {
    return `baselines:${projectId}:${streamName}`;
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
}