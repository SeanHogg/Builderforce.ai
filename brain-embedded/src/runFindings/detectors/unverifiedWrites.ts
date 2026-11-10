/**
 * `unverified_writes` — files the run wrote that no successful check (diagnostics, typecheck, tests, lint, or a shell
 * command running one) followed. Chat #70776 wrote thirteen times and checked nothing.
 */
import { callEvidence, finding, unverifiedFiles, writeCalls } from '../findingParts';
import type { RunFinding, RunView } from '../types';

export function unverifiedWrites(view: RunView): RunFinding[] {
  const files = unverifiedFiles(view);
  if (files.length === 0) return [];
  const writes = writeCalls(view).filter((c) => c.paths.some((p) => files.some((f) => f.path === p))).length;
  return [finding('unverified_writes', 'error', { files: files.length, writes },
    files.map((f) => callEvidence(f.lastWrite, f.path)))];
}
