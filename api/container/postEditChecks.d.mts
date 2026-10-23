/** Types for `postEditChecks.mjs` (PRD D7) — lets the api's TypeScript tests drive it. */

export interface PostEditCheckRow {
  id: string;
  group: string;
  exts: string[];
  marker: string | null;
  needs: { paths?: string[]; bins?: string[] };
  command(ctx: { scripts: Record<string, string> | null; files: string[] }): string | null;
}

export interface PostEditCheckIo {
  exists(rel: string): Promise<boolean>;
  hasBin(name: string): Promise<boolean>;
  readScripts(relDir: string): Promise<Record<string, string> | null>;
}

export interface PostEditCheckPlan {
  key: string;
  row: PostEditCheckRow;
  cwd: string;
  files: string[];
  command: string;
}

export const POST_EDIT_CHECK_BUDGET_MS: number;
export const POST_EDIT_CHECKS: PostEditCheckRow[];

export function planPostEditChecks(touched: string[], io: PostEditCheckIo): Promise<PostEditCheckPlan[]>;

export function createPostEditChecks(deps: {
  workdir: string;
  run(command: string, cwd: string, timeoutMs: number): Promise<{ exitCode: number; output: string; timedOut?: boolean }>;
  io: PostEditCheckIo;
  fit(output: string): string;
  onEvent?(event: Record<string, unknown>): void;
  budgetMs?: number;
}): { touch(path: string): void; drain(): Promise<string | null>; drainVerdict(): Promise<PostEditVerdict | null> };

/** The verifier name a post-edit verdict carries (PRD D1). */
export const POST_EDIT_VERIFIER: 'post_edit_checks';

/** What one drained batch of checks concluded — the cascade's code-unit verifier (D1). */
export interface PostEditVerdict {
  passed: boolean;
  verifier: 'post_edit_checks';
  /** The failing commands, in words the next model can act on. */
  reason?: string;
  /** The model-facing message (failures only), or null when everything passed. */
  steer: string | null;
}

export function postEditCheckMessage(
  failures: Array<{ plan: PostEditCheckPlan; output: string; exitCode: number }>,
  fit: (output: string) => string,
): string | null;

export function cloneCheckIo(
  workdir: string,
  deps: {
    access(path: string): Promise<void>;
    readFile(path: string, encoding: 'utf8'): Promise<string>;
    hasBin(name: string): Promise<boolean>;
  },
): PostEditCheckIo;
