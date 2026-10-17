/**
 * A task's shared workspace as the agent panel reads it: whether its repo can take the
 * agent's commits, what each run changed, and a changed file's two sides for the diff.
 * Split out of `builderforceApi.ts` (re-exported there, so importers are unchanged).
 */

/** Whether a task's bound repo can actually receive the agent's commits. */
export interface TaskRepoStatus {
  bound: boolean;
  hasCredential: boolean;
  repo?: string;
  base?: string;
  reason?: string;
}

/** One file an agent created/modified/deleted in a task's shared workspace. */
export interface TaskFileChange {
  path: string;
  change: 'created' | 'modified' | 'deleted';
  agent: string;
  executionId: number | null;
  createdAt: string;
  /** Models observed in llm.complete telemetry for the execution that made this change. */
  models?: string[];
  /** Authoritative usage provenance: whether the tenant's own provider key served it. */
  modelUsage?: Array<{ model: string; byo: boolean; provider: string | null }>;
}

/**
 * A changed file's current (ticket branch) and base (fork point) contents, read
 * back from the repo so the Changes tab can render the diff in Monaco. `current`
 * is null for a deleted file, `base` is null for a newly created file; both are
 * null (with `bound: false`) when no repo/credential is wired for the task.
 */
export interface TaskFileContent {
  bound: boolean;
  path: string;
  reason?: string;
  branch?: string;
  baseBranch?: string;
  current: string | null;
  base: string | null;
  currentTruncated?: boolean;
  baseTruncated?: boolean;
}
