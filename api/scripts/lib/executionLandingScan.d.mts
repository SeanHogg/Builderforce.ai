/** Types for the execution-landing scan (consumed by `executionLandingGuard.test.ts`; the guard itself is plain `.mjs`). */
export interface ExecutionStatusWrite {
  kind: string;
  /** The offending statement, truncated: what a per-site allow-list entry matches against. */
  snippet: string;
}

/** Every write to `executions.status` in one source file's text (value-agnostic; comments ignored). */
export function scanExecutionStatusWrites(source: string): ExecutionStatusWrite[];
