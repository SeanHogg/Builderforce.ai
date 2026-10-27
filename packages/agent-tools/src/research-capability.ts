/**
 * The `local.research` capability — a LOCAL model on the developer's machine that reads
 * files and answers the paid model's question about them (`local_research`).
 *
 * The surface owns everything machine-specific: which local runtime serves (the hybrid
 * local tier — Synapse native first, Ollama last), how a file is fingerprinted, and where
 * the answer cache persists. The tool (`local-research-tool.ts`) owns the policy: which
 * files to read, the excerpt budget, the time limit, and the cache key. Runtime-agnostic.
 */

/** One message the local model is sent. */
export interface LocalResearchMessage {
  role: "system" | "user";
  content: string;
}

/** What a cached answer is valid for: a file's identity at the moment it was read. */
export interface ResearchFileFingerprint {
  path: string;
  mtimeMs: number;
  size: number;
}

/** The surface's answer cache (persisted, bounded). Keys are opaque to the store. */
export interface ResearchAnswerStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, answer: string): Promise<void>;
}

export interface LocalResearchCapability {
  /** One non-streaming completion on a LOCAL model only — never the gateway. Throws when
   *  nothing on this machine can serve, or on `signal`. */
  complete(messages: readonly LocalResearchMessage[], signal: AbortSignal): Promise<string>;
  /** mtime + size per readable file; a path that is missing or not a file is omitted. */
  fingerprint(paths: readonly string[]): Promise<ResearchFileFingerprint[]>;
  /** The answer cache. Absent ⇒ every call asks the model. */
  readonly cache?: ResearchAnswerStore;
  /** Wall-clock budget for the model call (default in the tool). */
  readonly timeLimitMs?: number;
}
