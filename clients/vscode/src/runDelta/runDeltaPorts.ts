/**
 * The engine's inputs for ONE repository root (PRD 41 §C1, §C10), gathered on the extension host and handed to the engine as
 * PLAIN DATA ({@link PreparedDelta}), so `computeRunDelta` can run in a worker thread (`deltaWorkerHost.ts`) that the budget
 * can terminate.
 *
 *   - texts: {@link SideTexts} — pre-images and the base commit's blobs before, the working tree after — for every in-run file;
 *   - facts: {@link sideFacts} over the folder's knowledge store, each side built from exactly those texts, the in-run files
 *     swapped (`outside-run` files keep the stored copy on both sides);
 *   - churn: ONE `git log --since=90.days --name-only` per run (agent-tools' `gitHistoryPort`), cached by HEAD;
 *   - pastScores: the repository's stored deltas.
 *
 * `preparedPorts.ts` serves `DeltaPorts` from that data: pure, so it runs the same in a worker and in this thread.
 */

import { CHURN_DAYS } from "@builderforce/agent-tools/knowledge";
import { gitHistoryPort } from "@builderforce/agent-tools/node-git-history";
import type { DeltaRegistries, RunChangeSetInput } from "@builderforce/run-delta";
import type { PreparedDelta } from "./preparedPorts";
import type { RepoGit } from "./gitSide";
import { sideFacts, sideFilesOf, type KnowledgeContext } from "./sideFacts";
import type { SideTexts } from "./sideTexts";

export interface RepoDeltaSources {
  root: string;
  texts: SideTexts;
  input: RunChangeSetInput;
  registries: DeltaRegistries;
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

/** Gathers the engine's inputs on this thread: texts first, then each side's facts from them. */
export async function prepareDelta(src: RepoDeltaSources): Promise<PreparedDelta> {
  const inRun = src.input.files.filter((f) => f.attribution !== "outside-run");
  const [before, after] = await Promise.all([
    src.texts.beforeTexts(inRun.filter((f) => f.beforeHash !== undefined).map((f) => ({ path: f.path, beforeHash: f.beforeHash! }))),
    src.texts.afterTexts(inRun.filter((f) => f.afterHash !== undefined).map((f) => f.path)),
  ]);
  const files = (side: "before" | "after") => inRun.map((f) => {
    const hash = side === "before" ? f.beforeHash : f.afterHash;
    return { path: f.path, ...(hash ? { hash } : {}) };
  });
  const [beforeFacts, afterFacts, churn, pastScores] = await Promise.all([
    sideFacts(src.knowledge, sideFilesOf(files("before"), before), src.onError),
    sideFacts(src.knowledge, sideFilesOf(files("after"), after), src.onError),
    churnAt(src.root, src.git, inRun.map((f) => f.path)),
    src.pastScores(),
  ]);
  return {
    input: src.input, registries: src.registries,
    texts: { before: [...before], after: [...after] },
    facts: { before: beforeFacts, after: afterFacts },
    churn: [...churn], pastScores,
  };
}
