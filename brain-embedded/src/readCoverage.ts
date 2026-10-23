/**
 * The Brain's binding of the shared read guard (`@builderforce/run-guards`).
 *
 * The rules — exact repeat, circling read, covered window, and the one `invalidate`
 * that decides what a non-read call forgets — live once in the package, shared with the
 * cloud loop's progress detector. What is the Brain's own is its tool VOCABULARY: which
 * tools touch the local workspace, which publish, which shell commands provably only
 * read, and what a call is about. Those are bound here, so every caller keeps
 * `new ReadCoverage()`. The package's own helpers (advisories, thresholds, types) are
 * imported from `@builderforce/run-guards` directly — this file re-exports none of them.
 */

import { ReadCoverage as SharedReadCoverage, type ReadCoverageTraits } from '@builderforce/run-guards';
import { activityTarget, visitTarget, VISIT_QUESTION_SEPARATOR } from './runActivity';
import { isUnscopedMutationTool, isCodeChangeTool, isLocalWorkspaceTool, isRepoPublishTool, isRepoStateReadTool } from './localWorkspaceTools';
import { isReadOnlyShellCall } from './readOnlyShell';

/**
 * Could this call have changed ANY file, unnamed? A shell command or a tree-rewriting
 * git tool — minus a shell command that provably only reads. The ONE reading of that
 * question, shared by every per-target ledger (the read guard and the write ledger).
 */
export function isUnscopedMutation(tool: string, args: unknown): boolean {
  return isUnscopedMutationTool(tool) && !isReadOnlyShellCall(tool, args);
}

/** The Brain's tool vocabulary, as the shared read guard asks for it. */
export const BRAIN_READ_TRAITS: ReadCoverageTraits = {
  visitTarget,
  activityTarget,
  questionSeparator: VISIT_QUESTION_SEPARATOR,
  isUnscopedMutation,
  isCodeChangeTool,
  isLocalWorkspaceTool,
  isRepoPublishTool,
  isRepoStateReadTool,
};

/** Per-run read guard bound to the Brain's tools. One instance per run. */
export class ReadCoverage extends SharedReadCoverage {
  constructor() {
    super(BRAIN_READ_TRAITS);
  }
}
