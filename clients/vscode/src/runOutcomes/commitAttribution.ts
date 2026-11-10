/**
 * Per-run commit attribution in the editor (PRD 41 §D1, `followup-fix` step 4): when a commit includes content whose
 * normalized hash equals a run's `afterHash` for that path, the run's outcome records `{ commitSha, path }`. Recorded at
 * commit time through VS Code's git extension (`gitApi.ts`): every repository state change is checked for a moved HEAD,
 * and each new commit's files are hashed (EOL-normalized, `nodeContentHash` — the change set's own rule) and matched
 * against the run-attributed files of recent change sets in that repository.
 *
 * Only runs that already have a `run-outcome` record are attributed (features are frozen first, at run end). A run's
 * content is looked for in commits within {@link ATTRIBUTION_DAYS} of its finalization. Never throws: a git failure skips
 * that commit.
 */

import { scanByIndex, type LocalFirstStore } from "@builderforce/local-first";
import type { CommitAttribution } from "@builderforce/run-delta/predict";
import type * as vscode from "vscode";
import { getGitApi, watchGitRepositories } from "../gitApi";
import { nodeContentHash } from "../knowledge/nodeSha256";
import { fingerprintHash, repositoryIdentityOf } from "../runChangeBaseline";
import { CHANGE_SETS_BY_REPOSITORY_DAY, changeSetDayKey, type LocalChangeSetValue } from "../runChangeSets";
import { repoGit } from "../runDelta/gitSide";
import { commitFiles, newCommits } from "./outcomeGit";
import { runOutcomeIdOfChangeSet, updateRunOutcome } from "./runOutcomeRecords";

/** How long after its run end a run's content is still attributed to a commit (the longest label window). */
export const ATTRIBUTION_DAYS = 30;
/** At most this many new commits are read per HEAD move (a pull of hundreds is not the run's work). */
export const MAX_COMMITS_PER_MOVE = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

/** One run's attributable content in a repository: path → normalized hash. */
export interface RunContent {
  outcomeId: string;
  files: ReadonlyMap<string, string>;
}

/** The recent run content of one repository identity (change sets finalized within the window before `now`). */
export async function recentRunContent(store: LocalFirstStore, repository: string, now: Date): Promise<RunContent[]> {
  const since = now.getTime() - ATTRIBUTION_DAYS * DAY_MS;
  const out: RunContent[] = [];
  await store.read(async (tx) => {
    // Only the window's days of this repository (the change sets' repository-day index), never its whole history.
    for (let day = 0; day <= ATTRIBUTION_DAYS; day++) {
      const at = new Date(now.getTime() - day * DAY_MS).toISOString();
      await scanByIndex<LocalChangeSetValue>(tx, CHANGE_SETS_BY_REPOSITORY_DAY, changeSetDayKey(repository, at), (row) => {
        const cs = row.payload;
        if (typeof cs.capturedAt !== "string" || Date.parse(cs.capturedAt) < since) return;
        const files = new Map<string, string>();
        for (const f of cs.files) {
          if (f.attribution !== "run-authored" && f.attribution !== "run-modified-existing") continue;
          const hash = f.afterHash ? fingerprintHash(f.afterHash as `sha256:${string}`) : undefined;
          if (hash) files.set(f.path, hash);
        }
        if (files.size > 0) out.push({ outcomeId: runOutcomeIdOfChangeSet(row.id), files });
      });
    }
  });
  return out;
}

/** The attributions one commit's files earn, per run outcome: a path whose committed hash is the run's after-hash. */
export function matchCommit(
  runs: readonly RunContent[],
  commit: { sha: string; at: string; branch?: string; files: ReadonlyMap<string, { hash?: string; added: number }> },
): Map<string, CommitAttribution[]> {
  const out = new Map<string, CommitAttribution[]>();
  for (const run of runs) {
    for (const [path, file] of commit.files) {
      if (!file.hash || run.files.get(path) !== file.hash) continue;
      const list = out.get(run.outcomeId) ?? [];
      list.push({
        commitSha: commit.sha, path, committedAt: commit.at, addedLines: file.added, source: "vscode-git",
        ...(commit.branch ? { branch: commit.branch } : {}),
      });
      out.set(run.outcomeId, list);
    }
  }
  return out;
}

/** Attributes the commits between `from` (exclusive) and HEAD of one repository root. */
export async function attributeCommits(
  deps: { store: LocalFirstStore; deviceId(): string; now?: () => Date },
  root: string, from: string | undefined, branch: string | undefined,
): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const runs = await recentRunContent(deps.store, await repositoryIdentityOf(root), now);
  if (runs.length === 0) return 0;
  const git = repoGit(root);
  let recorded = 0;
  for (const sha of await newCommits(root, from, MAX_COMMITS_PER_MOVE)) {
    const commit = await commitFiles(root, sha);
    if (!commit || commit.files.size === 0) continue;
    const paths = [...commit.files.keys()];
    const blobs = await git.blobs(sha, paths);
    if (!blobs) continue;
    const files = new Map([...commit.files].map(([path, n]) => {
      const bytes = blobs.get(path);
      return [path, { added: n.added, ...(bytes ? { hash: nodeContentHash(bytes) } : {}) }] as const;
    }));
    for (const [outcomeId, attribution] of matchCommit(runs, { sha, at: commit.at, ...(branch ? { branch } : {}), files })) {
      if (await updateRunOutcome(deps.store, outcomeId, { attribution, deviceId: deps.deviceId(), at: now.toISOString() })) recorded++;
    }
  }
  return recorded;
}

/**
 * Watches every open repository for a moved HEAD and attributes its new commits. The first HEAD seen per repository is
 * only remembered (commits made before the editor opened were attributed then, or are out of reach). Returns the watch's
 * disposable.
 */
export function watchCommitAttribution(deps: { store: LocalFirstStore; deviceId(): string; onError(error: unknown): void }): vscode.Disposable {
  const heads = new Map<string, string>();
  let running = Promise.resolve();
  const check = (): void => {
    running = running.then(async () => {
      const api = await getGitApi();
      for (const repo of api?.repositories ?? []) {
        const root = repo.rootUri.fsPath;
        const head = repo.state.HEAD?.commit;
        const seen = heads.get(root);
        if (!head || head === seen) continue;
        heads.set(root, head);
        if (seen === undefined) continue;
        await attributeCommits(deps, root, seen, repo.state.HEAD?.name).catch(deps.onError);
      }
    }).catch(deps.onError);
  };
  check();
  return watchGitRepositories(check);
}
