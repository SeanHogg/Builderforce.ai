/**
 * `DeltaPorts` for ONE repository root (PRD 41 §C1, §C10): the engine's only view of the host.
 *
 *   - `texts`: {@link SideTexts} (pre-images and `git show` before, the working tree after), remembered per side so `facts`
 *     builds each side from exactly the texts the rules read;
 *   - `facts`: {@link sideFacts} over the folder's knowledge store, the run's in-run files swapped to that side;
 *   - `churn`: ONE `git log --since=90.days --name-only` per run (agent-tools' `gitHistoryPort`, the churn badge's reader),
 *     cached by HEAD so a second delta of the same tree reads none;
 *   - `pastScores`: the repository's stored deltas;
 *   - `analyze`: absent — the analyzers stay L3 `not_measured` this pass, and the engine reports them so.
 */

import { CHURN_DAYS } from "@builderforce/agent-tools/knowledge";
import { gitHistoryPort } from "@builderforce/agent-tools/node-git-history";
import type { ChangedFileInput, DeltaPorts, SideText, UnresolvedFile } from "@builderforce/run-delta";
import type { RepoGit } from "./gitSide";
import { sideFacts, sideFilesOf, type KnowledgeContext } from "./sideFacts";
import type { SideTexts } from "./sideTexts";

export interface RepoDeltaSources {
  root: string;
  texts: SideTexts;
  /** The change set as the engine reads it (from {@link SideTexts.inputs}). */
  inputs: readonly ChangedFileInput[];
  knowledge?: KnowledgeContext;
  git?: RepoGit;
  pastScores(): Promise<number[]>;
  /** A side whose facts could only be partly built (an extract failed). */
  onError?(error: unknown): void;
}

const CHURN_CACHE_MAX = 32;
const churnCache = new Map<string, Promise<Map<string, number>>>();

/** Commits per path in the last {@link CHURN_DAYS} days, one `git log` per (root, HEAD, paths); empty when unknown. */
export async function churnAt(root: string, git: RepoGit | undefined, paths: readonly string[]): Promise<Map<string, number>> {
  if (!git || paths.length === 0) return new Map();
  const head = (await git.head()).commit;
  if (!head) return new Map();
  const key = `${root}\u0000${head}\u0000${[...paths].sort().join("\u0000")}`;
  let hit = churnCache.get(key);
  if (!hit) {
    hit = gitHistoryPort(root).then((port) => port?.commitsTouching([...paths], CHURN_DAYS) ?? new Map<string, number>()).catch(() => new Map<string, number>());
    churnCache.set(key, hit);
    if (churnCache.size > CHURN_CACHE_MAX) churnCache.delete(churnCache.keys().next().value!);
  }
  return hit;
}

export function runDeltaPorts(src: RepoDeltaSources): DeltaPorts {
  const byPath = new Map(src.inputs.map((f) => [f.path, f]));
  const seen: Record<"before" | "after", Map<string, SideText | UnresolvedFile>> = { before: new Map(), after: new Map() };
  const inRun = src.inputs.filter((f) => f.attribution !== "outside-run");
  return {
    async texts(side, paths) {
      const out = side === "before"
        ? await src.texts.beforeTexts(paths.map((p) => ({ path: p, ...(byPath.get(p)?.beforeHash ? { beforeHash: byPath.get(p)!.beforeHash! } : {}) })))
        : await src.texts.afterTexts(paths);
      for (const [p, t] of out) seen[side].set(p, t);
      return out;
    },
    facts(side) {
      const files = inRun.map((f) => ({ path: f.path, ...((side === "before" ? f.beforeHash : f.afterHash) ? { hash: (side === "before" ? f.beforeHash : f.afterHash)! } : {}) }));
      return sideFacts(src.knowledge, sideFilesOf(files, seen[side]), src.onError);
    },
    churn: (paths) => churnAt(src.root, src.git, paths),
    pastScores: () => src.pastScores(),
  };
}
