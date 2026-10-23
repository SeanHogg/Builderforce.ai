/** Types for `repoIndex.mjs` (PRD C5) — lets the api's TypeScript tests drive it. */
import type { RepoMapResult, SemanticSearchResult } from '@builderforce/agent-tools';

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type ExecFile = (
  file: string,
  args: string[],
  opts: { env: Record<string, string | undefined>; timeoutMs: number; signal?: AbortSignal },
) => Promise<ExecResult>;

export const BF_CONTEXT_BIN: string;
export const REPO_INDEX_TOOL_NAMES: string[];
export const execFileCapture: ExecFile;
export function bfContextAvailable(bin?: string): Promise<boolean>;

export interface RepoIndex {
  readonly state: 'building' | 'ready' | 'failed';
  whenSettled(): Promise<void>;
  repoMap(opts?: { focus?: string[]; maxTokens?: number; query?: string }): Promise<RepoMapResult>;
  search(query: string, opts?: { scope?: string; limit?: number }): Promise<SemanticSearchResult>;
  dispose(): Promise<void>;
}

export function startRepoIndex(opts: {
  workdir: string;
  bin?: string;
  exec?: ExecFile;
  onEvent?: (event: Record<string, unknown>) => void;
}): Promise<RepoIndex>;
