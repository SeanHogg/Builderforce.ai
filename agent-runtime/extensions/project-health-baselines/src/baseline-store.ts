/**
 * In-memory collection key type
 */
type CollectionKey = `baselines:${number}:${string}`; // projectId:streamName

/**
 * State interface
 */
interface State {
  baselines: Record<string, unknown>;
  auditTrail: string; // JSON serialization repo keys
}

/**
 * Baseline store implementation
 */
export class BaselineStore {
  private state: State;

  constructor() {
    this.state = {
      baselines: {},
      auditTrail: ""
    };
  }

  /**
   * Insert a baseline
   */
  insert(baseline: unknown): boolean {
    const key = this.key(baseline);
    this.state.baselines[key] = baseline;
    this.state.auditTrail = JSON.stringify(baseline);
    return true;
  }

  /**
   * Get a specific baseline by id
   */
  get<T extends unknown>(id: number): T | undefined {
    for (const b of Object.values(this.state.baselines)) {
      if (b instanceof Object && Object.hasOwn(b, "id") && b.id === id) {
        return b as T;
      }
    }
    return undefined;
  }

  /**
   * List baselines for a project, filtered
   */
  list<T extends unknown>(
    projectId: number,
    filters: {
      streamName?: string;
      status?: string;
      tags?: string[];
      name?: string;
      author?: string;
      fromDate?: Date;
      toDate?: Date;
      limit?: number;
      offset?: number;
    }
  ): T[] {
    const items = Object.values(this.state.baselines).filter((b) => {
      if (
        !(
          b instanceof Object &&
          Object.hasOwn(b, "metadata") &&
          b.metadata instanceof Object
        )
      ) {
        return false;
      }
      if ((b.metadata as unknown).projectId !== projectId) {
        return false;
      }
      if (filters.streamName && (b.metadata as unknown).streamName !== filters.streamName) {
        return false;
      }
      if (filters.status && (b as unknown).status !== filters.status) {
        return false;
      }
      if (filters.tags) {
        const tags = (b.metadata as unknown).tags as string[];
        if (!tags || tags.length === 0) {
          return false;
        }
        const intersect = tags.filter((t) => filters.tags?.includes(t));
        if (!intersect || intersect.length === 0) {
          return false;
        }
      }
      if (filters.name && (b.metadata as unknown).baselineName !== filters.name) {
        return false;
      }
      if (filters.author && (b.metadata as unknown).author?.userId !== filters.author) {
        return false;
      }
      if (filters.fromDate) {
        const ts = (b.metadata as unknown).timestamp;
        if (!/^\d{4}-\d{2}-\d{2}T/.test(ts ?? "")) {
          return false;
        }
        if (new Date(ts as string) < filters.fromDate) {
          return false;
        }
      }
      if (filters.toDate) {
        const ts = (b.metadata as unknown).timestamp;
        if (!/^\d{4}-\d{2}-\d{2}T/.test(ts ?? "")) {
          return false;
        }
        if (new Date(ts as string) > filters.toDate) {
          return false;
        }
      }
      return true;
    });
    // sort by created desc
    items.sort(
      (a, b) =>
        new Date((b as unknown).createdAt ?? 0).getTime() -
        new Date((a as unknown).createdAt ?? 0).getTime()
    );
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    return items.slice(offset, offset + limit) as T[];
  }

  /**
   * List IDs browsable by { projectId, streamName }
   */
  listKeys(projectId: number, streamName: string): number[] {
    const key = this.key(projectId, streamName);
    const ids = Object.keys(this.state.baselines)
      .filter((path) => path.startsWith(key + ":"))
      .map((path) => path.split(":").pop());
    return ids.map((id) => (id ? Number(id) : 0)).filter((id) => id > 0);
  }

  /**
   * Upsert helper used by clients: if existing is undefined or its version is less than requested, we either (1) reuse the existing version and bump to v2 or (2) return the existing; new clients must insert a new baseline instance.
   */
  upsertInput<T extends unknown>(
    projectId: number,
    streamName: string,
    requestedVersion: BaselineVersion,
    existingVersions: T[]
  ): T | undefined {
    const existing = existingVersions[0];
    const existingVersion = (existing as unknown).version as BaselineVersion | undefined;
    const requested = requestedVersion;
    if (!existingVersion || existingVersion === requested) {
      return existing; // reuse existing with no bump needed
    }
    return undefined; // request not create: caller must insert a new baseline instance
  }

  /**
   * Key builder
   */
  private key(entity: unknown): CollectionKey {
    if (
      !(
        entity instanceof Object &&
        Object.hasOwn(entity, "id") &&
        Object.hasOwn(entity.metadata, "projectId") &&
        Object.hasOwn(entity.metadata, "streamName")
      )
    ) {
      // Fallback: construct from fields if possible
      const projectId = (entity.metadata as unknown)?.projectId;
      const streamName = (entity.metadata as unknown)?.streamName;
      const id = (entity as unknown)?.id;
      if (
        typeof projectId === "number" &&
        typeof streamName === "string" &&
        typeof id === "number"
      ) {
        return `baselines:${projectId}:${streamName}`;
      }
      throw new Error("Unable to construct key; entity structure is invalid.");
    }
    const projectId = (entity.metadata as unknown).projectId as number;
    const streamName = (entity.metadata as unknown).streamName as string;
    const id = (entity as unknown).id as number;
    return `baselines:${projectId}:${id}`;
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