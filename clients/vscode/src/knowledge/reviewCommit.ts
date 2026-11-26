/**
 * The commit a review ran at, recorded when the review COMPLETES (never read live when a pack is sent: HEAD moves between a
 * review and a send, and a dirty tree is not any commit).
 *
 * `reviewCommitOf` answers HEAD only when the reviewed folder is CLEAN at that moment (`git status --porcelain` over the root is
 * empty — the extension's own `.builderforce` folder is not part of the project and is left out of the check); a dirty tree, a
 * folder that is not a git repository, or a repository with no commit answers undefined = unknown. The answer is kept beside the
 * root's snapshot (`writeReviewCommit`), and the replica pump sends what was kept, so the platform stores the commit of THAT
 * review next to its digest and Compare's "before" can read its source with `readSourceAt`.
 *
 * Expected "no answer" git replies (not a repository, no commit yet) are silent. Anything else — a timeout, output too large,
 * git missing, an unreadable status — is reported through `reportExtensionError` and also answers unknown. Never throws.
 */

import { runGit } from "@builderforce/agent-tools/node-git-history";
import { writeReviewCommit, type KnowledgeFiles } from "@builderforce/agent-tools/knowledge";
import { reportExtensionError } from "../diagnostics/errorReporter";
import { COMMIT_SHA } from "./commitSha";

/** Room for git to answer `status` over a large working tree; a hung repository does not hold a review's completion. */
const GIT_TIMEOUT_MS = 20_000;

/** git's replies for "there is nothing to read here": not a repository, or no commit yet. Not faults. */
const EXPECTED_NO_ANSWER = /not a git repository|unknown revision|ambiguous argument 'HEAD'|bad revision 'HEAD'|Needed a single revision|does not have any commits/i;

/** git's stdout, or undefined (reported unless it is an {@link EXPECTED_NO_ANSWER}). */
async function gitStdout(rootPath: string, args: string[]): Promise<string | undefined> {
  const run = await runGit(rootPath, args, { timeoutMs: GIT_TIMEOUT_MS });
  if (run.stdout !== undefined) return run.stdout;
  if (run.failure === "error" && EXPECTED_NO_ANSWER.test(run.stderr ?? "")) return undefined;
  const why = run.failure === "timeout" ? "timed out" : run.failure === "buffer" ? "output too large" : (run.stderr ?? "").trim().split(/\r?\n/)[0] || "git failed";
  await reportExtensionError(new Error(`git ${args[0]} could not answer for the review commit: ${why}`), {
    operation: "knowledge.reviewCommit", context: { git: args[0], failure: run.failure ?? "error" },
  });
  return undefined;
}

/**
 * HEAD of the root's repository (7-64 hex, lower-cased) when the working tree over the root is clean, else undefined.
 * `git status --porcelain` lists modified, staged and untracked files; ignored files are not listed.
 */
export async function reviewCommitOf(rootPath: string): Promise<string | undefined> {
  const status = await gitStdout(rootPath, ["status", "--porcelain", "--", ".", ":(exclude).builderforce"]);
  if (status === undefined || status.trim() !== "") return undefined;
  const head = (await gitStdout(rootPath, ["rev-parse", "--verify", "HEAD"]))?.trim();
  return head && COMMIT_SHA.test(head) ? head.toLowerCase() : undefined;
}

/**
 * Records (or clears, when unknown) the commit the root's review that just completed ran at. Each completed review replaces the
 * last one's: a later dirty review leaves nothing standing for an earlier commit. A failure to write is reported, never thrown.
 */
export async function recordReviewCommit(files: KnowledgeFiles, rootPath: string, rootId: string): Promise<void> {
  try {
    await writeReviewCommit(files, rootId, await reviewCommitOf(rootPath));
  } catch (error) {
    await reportExtensionError(error, { operation: "knowledge.recordReviewCommit", context: { rootId } });
  }
}
