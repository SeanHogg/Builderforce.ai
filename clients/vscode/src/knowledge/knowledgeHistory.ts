/**
 * The Knowledge view's time slider and changed set (PRD 38, Option B+ Contract 4,
 * `history`): the last commits of a root with the files each one touched, as node refs.
 *
 * The git read is agent-tools' ONE git wrapper (`recentCommits`, `node-git-history.ts`);
 * paths are root-relative and map to refs with the scheme the code pack uses
 * (`srcRef(rootId, path)`, see agent-tools `codeNodes.ts`). Not a git work tree, or git
 * failing: no commits, never a throw.
 */

import { recentCommits, type GitHistoryOptions, type RecentCommit } from "@builderforce/agent-tools/node-git-history";
import { srcRef } from "@seanhogg/builderforce-memory/knowledge";
import type { KnowledgeHistoryResult } from "./knowledgeProtocol";

/** Commits the slider shows. */
export const HISTORY_COMMITS = 20;
/** Refs one commit lists at most (a mass rename must not flood the bridge). */
const MAX_REFS_PER_COMMIT = 200;

/** Commits as the view's history, with each path as a node ref. Pure. */
export function historyOf(commits: readonly RecentCommit[], rootId: string): KnowledgeHistoryResult["commits"] {
  return commits.map((c) => ({
    sha: c.sha, at: c.at, title: c.title,
    ...(c.author ? { author: c.author } : {}),
    refs: c.paths.slice(0, MAX_REFS_PER_COMMIT).map((p) => srcRef(rootId, p)),
  }));
}

/** The last {@link HISTORY_COMMITS} commits of the folder at `rootPath`, refs under `rootId`. */
export async function rootHistory(rootPath: string, rootId: string, options: GitHistoryOptions = {}): Promise<KnowledgeHistoryResult> {
  return { commits: historyOf(await recentCommits(rootPath, HISTORY_COMMITS, options), rootId) };
}
