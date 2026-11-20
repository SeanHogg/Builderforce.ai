/**
 * buildAutofixPolicy — when a failed build dispatches an automatic fix run.
 *
 * Moved out of the retired `repos/mergeBranchToBase.ts` (PRD 48 §4.3): a run never merges,
 * so the raw branch merge that file was named for is gone; the PR merge sweep
 * (`repos/prMergeSweep.ts`) is the single merge writer. These two values are what remained.
 */

/**
 * After a PR is merged, validate the deploy-branch build and auto-dispatch a fix
 * run on failure. DEFAULT ON — set `CLOUD_AUTOFIX_ON_BUILD_FAILURE=0` (or 'false')
 * to disable the auto-dispatch (the build outcome is still recorded). Single source
 * of truth for the post-merge auto-fix gate.
 */
export function cloudAutofixOnBuildFailure(env: unknown): boolean {
  const v = String((env as Record<string, unknown> | null)?.CLOUD_AUTOFIX_ON_BUILD_FAILURE ?? '').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

/** Max automatic build-fix runs per task before flagging a human. */
export const MAX_AUTOFIX_ATTEMPTS = 2;
