/**
 * The PUBLISH GATE in front of `git_commit` / `git_push`: what a commit may not carry, judged before the shared
 * publish script (`@builderforce/agent-tools` `git-publish-tools.ts`) runs. `fileTools.ts` calls {@link publishGateFor}.
 *
 *  - A RAISED RATCHET BASELINE. VS Code chat #275 ran `check-react-hooks-ratchet.mjs --update`, which grandfathered ~11
 *    new warnings, and committed + pushed it as "Record react-hooks ratchet improvement" (c9c043248). The diff of the
 *    named baseline files (and, for a push, of every unpushed non-merge commit) is read by `baselineRaises`
 *    (`@builderforce/run-guards`); added or raised entries are refused unless the message carries
 *    `baseline-raise: <reason>`.
 *  - A SCRATCH SCRIPT. The same run wrote `_split.cjs` helpers INTO `frontend/`. A commit that names a DIRECTORY sweeps
 *    every untracked file under it, so new untracked scratch scripts (`_*.cjs` / `_*.mjs`, run-guards `isScratchScriptPath`) are refused unless named
 *    exactly. Real underscore files (`_worker.js`, `pages/_app.ts`) are never refused — a deliberate trade-off: a
 *    throwaway `_*.js`/`_*.ts` helper is no longer caught here, accepted so real project files are never blocked.
 *    Throwaway scripts belong in `$BF_SCRATCH_DIR` (`scratchDir.ts`), never the repo.
 *
 * Git is reached through an injected runner so the judgement is testable without a repository. When git cannot answer
 * (no repository, no HEAD, no upstream) the gate has nothing to judge and lets the call through — with one warning
 * line, never silently; the publish script reports a broken repository itself.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  BASELINE_DIFF_CONTEXT,
  BASELINE_RAISE_TRAILER,
  baselineRaiseRefusal,
  baselineRaises,
  isBaselineFile,
  isScratchScriptPath,
  ownsBaselineRaise,
} from "@builderforce/run-guards";
import { isManifestPath, manifestRefusal } from "./composerCommands/manifestGate";
import { runGitRaw } from "./git/gitCli";
import { messageOf } from "./messageOf";

/** Runs `git <args>` in the call's directory and returns stdout, or undefined when git refused. */
export type GitRunner = (args: string) => Promise<string | undefined>;

/** What the gate reads beyond git: an untracked baseline's text, and where a fail-open is said. */
export interface GateDeps {
  readFile(absPath: string): Promise<string | undefined>;
  warn(message: string): void;
}

/** The most unpushed commits a push gate reads; past it the oldest are CI's to judge. */
const MAX_PUSH_COMMITS = 50;

/** A path safe to hand the shell inside double quotes: no quote, no expansion (`$`, backtick, cmd.exe's `%`). */
function quotable(p: string): boolean {
  return !/["`$%]/.test(p);
}

function slashes(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Repo-root pathspecs (`:(top)`), quoted — so the commands mean the same files whatever directory git runs in. */
function topSpecs(files: readonly string[]): string {
  return files.map((f) => `":(top)${slashes(f)}"`).join(" ");
}

function lines(out: string | undefined): string[] {
  return (out ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** An untracked baseline file, as the `+` diff a commit of it would carry. */
function newFileDiff(file: string, content: string): string {
  const body = content.split(/\r?\n/).map((l) => `+${l}`).join("\n");
  return `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1 @@\n${body}\n`;
}

/** `p` as the call named it (absolute, or relative to `cwd`), repo-relative with forward slashes. */
export function repoRelative(repoRoot: string, cwd: string, p: string): string {
  return slashes(path.relative(path.resolve(repoRoot), path.resolve(cwd, p)));
}

/** New untracked scratch scripts (repo-relative) a commit of `named` (repo-relative) would sweep in without naming them. */
export function sweptScratchScripts(untracked: readonly string[], named: readonly string[]): string[] {
  const exact = new Set(named);
  // THE scratch predicate (run-guards): `_*.cjs` / `_*.mjs` only, so `_worker.js` and `pages/_app.ts` are never refused.
  return untracked.filter((file) => isScratchScriptPath(file) && !exact.has(file));
}

/** The refusal for swept scratch scripts. */
export function scratchScriptRefusal(files: readonly string[]): string {
  return (
    `Refused: this commit would stage ${files.length} new untracked scratch script${files.length === 1 ? "" : "s"} you did not name: ${files.join(", ")}. ` +
    "Throwaway scripts go in $BF_SCRATCH_DIR, never the repository — delete these files (or move them there), then commit only the files you changed. " +
    "If one really belongs in the repository, rename it (no leading underscore) or name it exactly in `paths`."
  );
}

/** The first named app manifest the runtime's parser rejects (a deleted file passes), or null. */
async function invalidManifestRefusal(repoRoot: string, named: readonly string[], deps: GateDeps): Promise<string | null> {
  for (const file of named.filter(isManifestPath)) {
    const content = await deps.readFile(path.join(repoRoot, file));
    const refusal = content === undefined ? null : manifestRefusal(file, content);
    if (refusal) return refusal;
  }
  return null;
}

/** What the gate says about a `git_commit` of `paths` with `message` — a refusal, or null to let it run. */
export async function commitGateRefusal(git: GitRunner, cwd: string, args: { message: string; paths: readonly string[] }, deps: GateDeps): Promise<string | null> {
  const repoRoot = (await git("rev-parse --show-toplevel"))?.trim();
  if (!repoRoot) {
    deps.warn("publish gate: not a git repository here — the baseline and scratch-script checks were skipped");
    return null;
  }
  const named = args.paths.filter(quotable).map((p) => repoRelative(repoRoot, cwd, p));
  if (named.length === 0) return null;
  const invalidManifest = await invalidManifestRefusal(repoRoot, named, deps);
  if (invalidManifest) return invalidManifest;
  const untracked = lines(await git(`ls-files --full-name --others --exclude-standard -- ${topSpecs(named)}`));
  const swept = sweptScratchScripts(untracked, named);
  if (swept.length > 0) return scratchScriptRefusal(swept);
  if (ownsBaselineRaise(args.message)) return null;
  const changed = await git(`diff --name-only HEAD -- ${topSpecs(named)}`);
  if (changed === undefined) {
    deps.warn("publish gate: `git diff HEAD` failed (no commit yet?) — the baseline check was skipped");
    return null;
  }
  const baselines = lines(changed).filter(isBaselineFile);
  let diff = baselines.length > 0 ? (await git(`diff ${BASELINE_DIFF_CONTEXT} HEAD -- ${topSpecs(baselines)}`)) ?? "" : "";
  for (const file of untracked.filter(isBaselineFile)) {
    const content = await deps.readFile(path.join(repoRoot, file));
    if (content !== undefined) diff += `\n${newFileDiff(file, content)}`;
  }
  const raises = baselineRaises(diff);
  return raises.length > 0 ? baselineRaiseRefusal(raises) : null;
}

/**
 * What the gate says about a `git_push`: every unpushed non-merge commit (a merge's combined diff is not a unified one)
 * that raises a baseline without owning it in its message. The range is the branch's upstream; a branch with none is
 * judged against `origin/HEAD`.
 */
export async function pushGateRefusal(git: GitRunner, branch: string | undefined, deps: Pick<GateDeps, "warn">): Promise<string | null> {
  const ref = branch && quotable(branch) ? branch : "HEAD";
  const upstream = (await git(`rev-parse --abbrev-ref --symbolic-full-name "${ref}@{u}"`))?.trim() || (await git("rev-parse --abbrev-ref origin/HEAD"))?.trim();
  if (!upstream) {
    deps.warn(`publish gate: ${ref} has no upstream and origin/HEAD is unknown — the baseline check of unpushed commits was skipped`);
    return null;
  }
  const shas = lines(await git(`rev-list --no-merges --max-count=${MAX_PUSH_COMMITS} "${upstream}..${ref}"`));
  const unowned: string[] = [];
  for (const sha of shas) {
    const message = (await git(`log -1 --format=%B ${sha}`)) ?? "";
    if (ownsBaselineRaise(message)) continue;
    const baselines = lines(await git(`show --name-only --format= ${sha}`)).filter(isBaselineFile);
    if (baselines.length === 0) continue;
    const raises = baselineRaises((await git(`show --format= ${BASELINE_DIFF_CONTEXT} ${sha} -- ${topSpecs(baselines)}`)) ?? "");
    if (raises.length > 0) unowned.push(`${sha.slice(0, 9)} ${message.split(/\r?\n/)[0] ?? ""}\n${baselineRaiseRefusal(raises)}`);
  }
  if (unowned.length === 0) return null;
  return (
    `Refused: ${unowned.length} unpushed commit${unowned.length === 1 ? "" : "s"} raise a ratchet baseline without owning it.\n\n${unowned.join("\n\n")}\n\n` +
    `Fix the violations in a new commit that restores the baseline, or — if the raise is intended — amend the commit message with \`${BASELINE_RAISE_TRAILER} <reason>\`.`
  );
}

/** The editor's deps: the file system, and the extension host's console for a fail-open warning. */
const EDITOR_DEPS: GateDeps = {
  async readFile(absPath) {
    try {
      return await fs.readFile(absPath, "utf8");
    } catch (err) {
      // A file that vanished between `ls-files` and the read has nothing to judge; anything else is said.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`[builderforce] publish gate: could not read ${absPath}: ${messageOf(err)}`);
      }
      return undefined;
    }
  },
  warn: (message) => console.warn(`[builderforce] ${message}`),
};

/** The gate for one tool call run in `cwd` (the call's repository); null for any other tool, or a call it lets through. */
export async function publishGateFor(name: string, args: Record<string, unknown>, cwd: string, deps: GateDeps = EDITOR_DEPS): Promise<string | null> {
  if (name !== "git_commit" && name !== "git_push") return null;
  const git: GitRunner = (gitArgs) => runGitRaw(cwd, gitArgs, { timeoutMs: 20_000, maxBuffer: 32 * 1024 * 1024 });
  if (name === "git_push") return pushGateRefusal(git, typeof args.branch === "string" ? args.branch : undefined, deps);
  const paths = Array.isArray(args.paths) ? args.paths.filter((p): p is string => typeof p === "string" && p.trim() !== "") : [];
  const message = typeof args.message === "string" ? args.message : "";
  return commitGateRefusal(git, cwd, { message, paths }, deps);
}
