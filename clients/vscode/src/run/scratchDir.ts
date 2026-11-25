/**
 * The per-run SCRATCH DIRECTORY: where a run's throwaway scripts go, so they never land in the repository. VS Code chat
 * #275 wrote `_split.cjs` helpers INTO `frontend/` to extract code, where a directory-wide commit would sweep them up.
 *
 * Every `run_command` (and background job) sees it as `$BF_SCRATCH_DIR`; the `run_command` and `write_file`
 * descriptions say so (`fileTools.ts`), and the publish gate (`publishGate.ts`) refuses a commit that would stage an
 * unnamed `_*.{js,cjs,mjs,ts}` file. It lives under the OS temp directory, one folder per run.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { messageOf } from "./messageOf";

/** The environment variable a command reads its scratch directory from. */
export const SCRATCH_DIR_ENV = "BF_SCRATCH_DIR";

/** The note the `run_command` / `write_file` descriptions carry. */
export const SCRATCH_DIR_NOTE = `Throwaway scripts (a one-off split, codemod or probe) go in $${SCRATCH_DIR_ENV} (a per-run folder outside the workspace), never the repo.`;

/** The scratch directory of run `owner` (one shared folder for commands outside a run), created on first use. */
export function scratchDirFor(owner: number | string | undefined): string {
  const dir = path.join(os.tmpdir(), "builderforce-scratch", owner === undefined ? "shared" : `run-${String(owner)}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    // The variable still names the folder; a command that writes there reports the failure itself.
    console.warn(`[builderforce] could not create the scratch directory ${dir}: ${messageOf(err)}`);
  }
  return dir;
}

/** The environment a command runs with: the caller's extra variables over the scratch directory. */
export function withScratchEnv(owner: number | string | undefined, env: Record<string, string> | undefined): Record<string, string> {
  return { [SCRATCH_DIR_ENV]: scratchDirFor(owner), ...(env ?? {}) };
}
