/**
 * THE scratch-script predicate: is a written path a run's throwaway helper rather than a
 * change to the project? One rule, read by the code-change ticket backstop
 * (brain-embedded `codeChanges.ts`) and the editor's commit gate (clients/vscode
 * `publishGate.ts`).
 *
 * VS Code chat #275 wrote `_split.cjs` helpers INTO `frontend/` to extract code: the
 * backstop counted the first one as a change and opened "Code change (1 file)" before any
 * real file changed, and a directory-wide commit would have swept them into the repo.
 *
 * Deliberately narrow — an underscore-named `.cjs`/`.mjs` file, or anything inside the
 * per-run `builderforce-scratch` folder (clients/vscode `scratchDir.ts`). `.js`/`.ts`
 * are NOT matched: `pages/_app.ts`, `_document.ts` and a Pages `_worker.js` are real
 * project files. Pure.
 */

const SCRATCH_SCRIPT = /^_[^/\\]*\.(?:cjs|mjs)$/i;

/** The folder name the editor's per-run scratch directory lives under (`<tmp>/builderforce-scratch/run-<id>`). */
export const SCRATCH_DIR_SEGMENT = "builderforce-scratch";

export function isScratchScriptPath(file: string): boolean {
  const parts = file.split(/[/\\]/);
  if (parts.includes(SCRATCH_DIR_SEGMENT)) return true;
  return SCRATCH_SCRIPT.test(parts.pop() ?? "");
}
