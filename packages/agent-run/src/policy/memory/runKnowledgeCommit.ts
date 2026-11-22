/**
 * policy/memory/runKnowledgeCommit — everything a finished run leaves in project memory:
 * the code map of what it read and changed, then the model-extracted learned facts for a
 * completed run that changed files (or investigated read-only and answered), behind the chat's
 * Memory switch.
 *
 * Ported from the editor's former `clients/vscode/src/memoryCommit.ts` (`commitRunKnowledge` /
 * `commitRunKnowledgeIfAllowed`, same signatures), which the editor now imports from here
 * (`@builderforce/agent-run/memory`, `commit.ts`). The one thing that reads the disk - the diff /
 * file-head evidence (`readChangedExcerpt`, node `fs` + `git`) - stays the editor's
 * (`clients/vscode/src/changedExcerpt.ts`) and arrives as the surface's `excerpt` port: this
 * package runs in the Worker and the browser too. A surface without it extracts from the paths
 * and the task alone.
 *
 * No `node:*` imports, no DOM.
 */

import type { RunKnowledgeLog } from "@builderforce/agent-tools";
import { commitLearnedFacts, type LearnedFactDeps } from "./learnedFacts.js";

/** What a finished run hands its memory commit: the run record's note view and its code map. */
export type FinishedRun = Pick<RunKnowledgeLog, "activity" | "consolidate"> & {
  /** The run's final assistant answer — what a read-only investigation learns from. */
  answer?: string;
};

/** A run's record plus its final answer, as a {@link FinishedRun} — a view, the recorder is not mutated. */
export function finishedRun(log: Pick<RunKnowledgeLog, "activity" | "consolidate">, answer?: string): FinishedRun {
  const text = answer?.trim();
  return {
    get activity() {
      return log.activity;
    },
    consolidate: (opts) => log.consolidate(opts),
    ...(text ? { answer: text } : {}),
  };
}

/** The model route and the fact store, plus the surface's evidence reader when it has one. */
export interface MemoryCommitDeps extends LearnedFactDeps {
  /** A bounded diff / file-head excerpt of the changed paths under `root`. Absent ⇒ none. */
  excerpt?(root: string, changed: readonly string[]): Promise<string>;
}

/** The run-trace line a run gets when its chat's Memory switch kept every fact unwritten. */
export const MEMORY_OFF_NOTE =
  "No project facts were written for this run: the chat's Memory switch is off. Not a fault — turn Memory on to keep this run's code map and decisions.";

/**
 * The chat's Memory switch, applied in ONE place: off means the run writes no project
 * facts at all — `deps` is never even resolved. Never throws.
 */
export async function commitRunKnowledgeIfAllowed(
  root: string,
  run: FinishedRun,
  opts: { memory: boolean; learn?: boolean },
  resolveDeps: () => Promise<MemoryCommitDeps | undefined>,
  /** One line for the run's trace, told (synchronously) when Memory is off. */
  note?: (line: string) => void,
): Promise<void> {
  if (!opts.memory) {
    try {
      note?.(MEMORY_OFF_NOTE);
    } catch {
      /* a trace line is best-effort */
    }
    return;
  }
  try {
    const deps = await resolveDeps();
    if (deps) await commitRunKnowledge(root, run, deps, opts.learn === undefined ? undefined : { learn: opts.learn });
  } catch {
    /* best-effort: a finished run never fails over its memory */
  }
}

/**
 * The code map of what the run read and changed (deterministic — a read-only
 * investigation counts, PRD 35 E8), then the learned facts: for a run that changed files, or a read-only
 * investigation that read enough files and left a final answer (`commitLearnedFacts` decides). `learn: false`
 * (a failed or stopped run) writes the code map only. Never throws.
 */
export async function commitRunKnowledge(root: string, run: FinishedRun, deps: MemoryCommitDeps, opts?: { learn?: boolean }): Promise<void> {
  const activity = run.activity;
  // The root, so a tool call given an absolute path still maps as a repo file.
  const map = run.consolidate({ root });
  if (map) {
    try {
      await deps.remember(map.key, map.content);
    } catch {
      /* the map is an accelerant; the learned facts below still get their chance */
    }
  }
  if (opts?.learn === false) return;
  const changed = [...(activity.created ?? []), ...(activity.edited ?? [])];
  let excerpt = "";
  try {
    excerpt = deps.excerpt && changed.length > 0 ? await deps.excerpt(root, changed) : "";
  } catch {
    excerpt = "";
  }
  // `commitLearnedFacts` decides eligibility: changed files, or a read-only run with reads + an answer.
  await commitLearnedFacts(
    {
      changed,
      ...(activity.read?.length ? { read: activity.read } : {}),
      ...(run.answer ? { answer: run.answer } : {}),
      ...(activity.tools ? { tools: activity.tools } : {}),
      ...(excerpt ? { excerpt } : {}),
      ...(activity.prompt ? { prompt: activity.prompt } : {}),
    },
    deps,
  );
}
