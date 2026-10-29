/**
 * policy/memory/runKnowledgeCommit — everything a finished run leaves in project memory:
 * the code map of what it read and changed, then the model-extracted learned facts for a
 * run that changed files, behind the chat's Memory switch.
 *
 * Ports `clients/vscode/src/memoryCommit.ts`' `commitRunKnowledge` /
 * `commitRunKnowledgeIfAllowed` with the same signatures. The one thing that read the
 * disk there — the diff / file-head evidence (`readChangedExcerpt`, node `fs` + `git`) —
 * is the surface's `excerpt` port here: this package runs in the Worker and the browser
 * too. A surface without it extracts from the paths and the task alone.
 *
 * No `node:*` imports, no DOM.
 */

import type { RunKnowledgeLog } from "@builderforce/agent-tools";
import { commitLearnedFacts, type LearnedFactDeps } from "./learnedFacts.js";

/** What a finished run hands its memory commit: the run record's note view and its code map. */
export type FinishedRun = Pick<RunKnowledgeLog, "activity" | "consolidate">;

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
  opts: { memory: boolean },
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
    if (deps) await commitRunKnowledge(root, run, deps);
  } catch {
    /* best-effort: a finished run never fails over its memory */
  }
}

/**
 * The code map of what the run read and changed (deterministic — a read-only
 * investigation counts, PRD 35 E8), then the learned facts for a run that changed files.
 * Never throws.
 */
export async function commitRunKnowledge(root: string, run: FinishedRun, deps: MemoryCommitDeps): Promise<void> {
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
  const changed = [...(activity.created ?? []), ...(activity.edited ?? [])];
  if (changed.length === 0) return;
  let excerpt = "";
  try {
    excerpt = deps.excerpt ? await deps.excerpt(root, changed) : "";
  } catch {
    excerpt = "";
  }
  await commitLearnedFacts(
    {
      changed,
      ...(activity.tools ? { tools: activity.tools } : {}),
      ...(excerpt ? { excerpt } : {}),
      ...(activity.prompt ? { prompt: activity.prompt } : {}),
    },
    deps,
  );
}
