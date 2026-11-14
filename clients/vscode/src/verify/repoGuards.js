/**
 * The repo-guards tier of the verifier (PRD 45 §4.4 repoGuards): when the owning
 * project declares `scripts/checks.manifest.mjs`, run `scripts/run-checks.mjs`
 * with it — the repository's own guard suite (source-package graph, silent-catch
 * sweep, manifest checks). The guard command receives the manifest path so the
 * runner knows exactly which checks to apply; the REAL exit code is the record.
 *
 * `node` is spawned directly with an argument array — no shell, and never `node.cmd`.
 */
import * as path from "path";
import { DID_NOT_FINISH } from "./execRunner";
const MANIFEST = "scripts/checks.manifest.mjs";
const RUNNER = "scripts/run-checks.mjs";
/** A guard run's budget; over it, the guard is "unavailable", not "pass" (OD-3). */
export const GUARD_TIMEOUT_MS = 120_000;
/** Does this project declare the guard manifest? */
export async function hasGuards(projectRoot, fs) {
    return fs.exists(path.join(projectRoot, MANIFEST));
}
/**
 * Run `scripts/run-checks.mjs scripts/checks.manifest.mjs` in the owning project.
 * Returns null when the project declares no manifest — nothing ran, so nothing is
 * claimed (the tier is simply absent for projects without guards).
 */
export async function repoGuardRecord(projectRoot, fs, shell, opts) {
    const now = opts?.now ?? Date.now;
    if (!(await hasGuards(projectRoot, fs)))
        return null;
    const argv = ["node", path.join(projectRoot, RUNNER), path.join(projectRoot, MANIFEST)];
    const timeoutMs = opts?.timeoutMs ?? GUARD_TIMEOUT_MS;
    // No budget left (a bounded caller): not started — "unavailable", never a pass.
    const r = timeoutMs > 0 ? await shell.runFor(argv, timeoutMs) : { exitCode: DID_NOT_FINISH };
    const exitCode = typeof r.exitCode === "number" ? r.exitCode : 1;
    return {
        kind: "guard",
        name: argv.join(" "),
        outcome: exitCode === DID_NOT_FINISH ? "unavailable" : exitCode === 0 ? "pass" : "fail",
        exitCode,
        findings: [],
        at: now(),
    };
}
//# sourceMappingURL=repoGuards.js.map