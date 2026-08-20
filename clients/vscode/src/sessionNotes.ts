/**
 * The editor's half of the `.builderforce/` knowledge loop: a dated note per finished run.
 *
 * ## The gap this closes
 *
 * `codebaseScan.ts` already writes the grounding MAP — `context.yaml`, `project-map.md`,
 * `architecture.md` — and its own generated README told the user that `memory/` held
 * "session knowledge appended over time". It did not: the extension created that directory
 * with an empty `.gitkeep` and never wrote a line into it. So the editor's grounding was
 * a static snapshot of the repo's SHAPE, refreshed only on rescan, while the on-prem
 * runtime's `KnowledgeLoopService` was appending what each run actually DID and reading it
 * back on later runs. Only one of the two surfaces compounded.
 *
 * ## Same tree, same shape — deliberately
 *
 * Notes go to `<workspace>/.builderforce/memory/<YYYY-MM-DD>.md`, the exact path and
 * format the on-prem loop uses, via the SHARED `knowledge-notes` module. That is the whole
 * point: a developer who runs the CLI in the morning and the editor in the afternoon gets
 * ONE accumulating history, and a later run grounds on both. A near-miss format here would
 * produce entries the next grounding pass reads as unrelated noise.
 *
 * ## Best-effort by construction
 *
 * Nothing here may fail a run. A read-only workspace, a missing folder, a file locked by
 * another process — every one of those degrades to "no note", never to a failed turn. The
 * knowledge loop is an accelerant, not a dependency.
 */

import * as fs from "fs/promises";
import * as path from "path";
import {
  buildKnowledgeMemoryEntry,
  KNOWLEDGE_DIRS,
  knowledgeMemoryFileName,
  type RunActivity,
} from "@builderforce/agent-tools";

/** Tool names that CREATE a file, mapped to the argument carrying its path. */
const CREATE_TOOLS: ReadonlyMap<string, string> = new Map([
  ["write_file", "path"],
  ["write", "path"],
]);

/** Tool names that MODIFY an existing file, mapped to the argument carrying its path. */
const EDIT_TOOLS: ReadonlyMap<string, string> = new Map([
  ["edit_file", "path"],
  ["edit", "path"],
  ["apply_patch", "path"],
]);

function argPath(args: unknown, key: string): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Accumulates one run's activity from the tool calls it makes, then renders a note.
 *
 * Created vs edited is decided by the TOOL, not by probing the disk: by the time a run
 * ends, a file a `write` created and a file an `edit` changed both exist, so a stat-based
 * guess would call every write an edit. `write` on an existing path is counted as a create
 * because that is the tool the model chose — the note describes the run's actions, not a
 * filesystem diff.
 */
export class SessionNotes {
  private readonly created: string[] = [];
  private readonly edited: string[] = [];
  private readonly tools: string[] = [];

  /** Record one tool call. Unknown tools still count toward `**Tools**`. */
  record(name: string, args?: unknown): void {
    this.tools.push(name);
    const createArg = CREATE_TOOLS.get(name);
    if (createArg) {
      const p = argPath(args, createArg);
      if (p) this.created.push(p);
      return;
    }
    const editArg = EDIT_TOOLS.get(name);
    if (editArg) {
      const p = argPath(args, editArg);
      if (p) this.edited.push(p);
    }
  }

  /** True when nothing has been recorded — the caller can skip the write entirely. */
  get isEmpty(): boolean {
    return this.tools.length === 0;
  }

  /** This run's activity, in the shared note format's shape. */
  get activity(): RunActivity {
    return { created: this.created, edited: this.edited, tools: this.tools };
  }
}

/**
 * Append a run's note to `<root>/.builderforce/memory/<YYYY-MM-DD>.md`.
 *
 * Resolves to `true` when a note was written, `false` when there was nothing worth
 * recording OR the write failed — the caller has no decision to make either way, which is
 * why this never rejects.
 */
export async function appendSessionNote(
  root: string,
  params: { sessionKey: string; activity: RunActivity; at?: Date },
): Promise<boolean> {
  const at = params.at ?? new Date();
  const entry = buildKnowledgeMemoryEntry({
    sessionKey: params.sessionKey,
    ts: at.toISOString(),
    activity: params.activity,
  });
  // A run that touched nothing contributes NOTHING: an empty heading still costs the next
  // grounding pass tokens and tells it nothing.
  if (!entry) return false;

  try {
    const dir = path.join(root, KNOWLEDGE_DIRS.root, KNOWLEDGE_DIRS.memory);
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(path.join(dir, knowledgeMemoryFileName(at)), entry, "utf-8");
    return true;
  } catch {
    // Read-only workspace, permissions, a locked file — never fail the run over a note.
    return false;
  }
}

/**
 * Read back the most recent notes as grounding text, newest day first, bounded by
 * `maxChars`.
 *
 * This is the half that makes the loop a LOOP rather than a log: without a reader the
 * notes accumulate and nothing is any smarter for it. Bounded because the grounding
 * budget is shared with the project map and the architecture overview, and an unbounded
 * history would crowd both out as the file grows.
 */
export async function readRecentSessionNotes(
  root: string,
  options?: { maxDays?: number; maxChars?: number },
): Promise<string> {
  const maxDays = options?.maxDays ?? 3;
  const maxChars = options?.maxChars ?? 4000;
  const dir = path.join(root, KNOWLEDGE_DIRS.root, KNOWLEDGE_DIRS.memory);
  let files: string[];
  try {
    files = (await fs.readdir(dir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
  } catch {
    return "";
  }
  // Filenames are ISO dates, so a plain descending string sort IS newest-first.
  const recent = files.sort().reverse().slice(0, maxDays);
  const parts: string[] = [];
  let budget = maxChars;
  for (const file of recent) {
    if (budget <= 0) break;
    try {
      const text = (await fs.readFile(path.join(dir, file), "utf-8")).trim();
      if (!text) continue;
      // Take the TAIL of a day's file: the newest entries are appended last, and those
      // are the ones a run in progress is most likely to build on.
      const slice = text.length > budget ? `…\n${text.slice(text.length - budget)}` : text;
      parts.push(slice);
      budget -= slice.length;
    } catch {
      /* one unreadable day must not lose the others */
    }
  }
  return parts.join("\n\n");
}
