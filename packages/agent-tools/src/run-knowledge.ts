/**
 * run-knowledge — the ONE record of what a run did and found, for every runtime.
 *
 * The loop kernel and the engine were already one (`@builderforce/agent-loop`); the
 * lifecycle AROUND them was not. The editor accumulated a run's activity in its own
 * `SessionNotes`, on-prem in its own `RunAccumulator`, the cloud engine in a
 * `writtenPaths` set — three copies with three different tool-name lists, none of
 * which kept what the run READ. {@link RunKnowledgeRecorder} is the editor's copy,
 * extracted here so every runtime records a run the same way, and
 * {@link buildCodeMapFact} turns that record into the fact the next run recalls.
 *
 * ## The gap the code map closes
 *
 * A run that spends ninety turns locating the code behind a feature leaves with that
 * knowledge in its transcript and nowhere else. The session note records only the
 * files it created or edited, and the learned-facts step extracts decisions and root
 * causes (and is told not to restate file lists). So the next run asked about the
 * same area repeats the whole search — every surface, every time.
 *
 * This module turns the run's own reads and edits into a CODE MAP: the files that
 * mattered, ranked by how much the run leaned on them, under a key per AREA (the
 * directory those files share). A later run on that area recalls it through the
 * ordinary facts path (`recall_facts`, the run-context block) and opens those files
 * first instead of searching.
 *
 * ## Deterministic on purpose
 *
 * No model call. The map is built from what the run actually opened, so it cannot
 * invent a path, costs nothing, and works offline. The same area's key is stable, so
 * a newer run on it REPLACES the older map rather than stacking a second one.
 *
 * PURE: no `node:*`, no I/O — every surface (editor, on-prem, cloud) writes the fact
 * through its own facts port.
 */

import type { RunActivity } from "./knowledge-notes.js";

/** Key prefix every code-map fact carries. Not `workspace:` — the scan sync retires those. */
export const CODE_MAP_FACT_PREFIX = "codemap:";

/**
 * Tool names that CREATE / MODIFY / READ a file. Every runtime's spelling of each
 * (shared `write_file`, on-prem native `write`/`create`, …) — one list, so no surface
 * misses half a run because of an alias.
 */
const CREATE_TOOLS: ReadonlySet<string> = new Set(["write_file", "write", "create"]);
const EDIT_TOOLS: ReadonlySet<string> = new Set(["edit_file", "edit", "apply_patch"]);
const READ_TOOLS: ReadonlySet<string> = new Set(["read_file", "read", "view", "file_outline"]);

function argPath(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const rec = args as Record<string, unknown>;
  const value = rec["path"] ?? rec["file_path"];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Accumulates one run's activity from the tool calls it makes.
 *
 * Created vs edited is decided by the TOOL, not by probing the disk: by the time a run
 * ends, a file a `write` created and a file an `edit` changed both exist, so a stat-based
 * guess would call every write an edit. Record SUCCESSFUL calls only — a note claiming a
 * file was written when the write threw would ground every later run on a lie.
 */
export class RunKnowledgeRecorder {
  private readonly created: string[] = [];
  private readonly edited: string[] = [];
  private readonly read: string[] = [];
  private readonly tools: string[] = [];
  /** What this run was asked — the note and the code map describe THAT, not a template. */
  private prompt: string | undefined;

  setPrompt(prompt: string): void {
    const asked = prompt.replace(/\s+/g, " ").trim();
    if (asked) this.prompt = asked;
  }

  /** Record one successful tool call. Unknown tools still count toward `tools`. */
  record(name: string, args?: unknown): void {
    this.tools.push(name);
    const p = argPath(args);
    if (!p) return;
    if (CREATE_TOOLS.has(name)) this.created.push(p);
    else if (EDIT_TOOLS.has(name)) this.edited.push(p);
    else if (READ_TOOLS.has(name)) this.read.push(p);
  }

  /** True when nothing has been recorded — the caller can skip the write entirely. */
  get isEmpty(): boolean {
    return this.tools.length === 0;
  }

  /** This run's activity, in the shared note format's shape. `read` keeps duplicates. */
  get activity(): RunActivity {
    return {
      created: this.created,
      edited: this.edited,
      read: this.read,
      tools: this.tools,
      ...(this.prompt ? { prompt: this.prompt } : {}),
    };
  }
}

/** The code map for a recorded activity — what every runtime commits at run end. */
export function codeMapFromActivity(activity: RunActivity, at: Date = new Date()): CodeMapFact | null {
  return buildCodeMapFact(
    {
      ...(activity.prompt ? { prompt: activity.prompt } : {}),
      read: activity.read ?? [],
      changed: [...(activity.created ?? []), ...(activity.edited ?? [])],
    },
    at,
  );
}

/** Fewer distinct files than this, with nothing changed, is a lookup — not a map worth keeping. */
export const MIN_MAPPED_FILES = 3;
const MAX_MAPPED_FILES = 12;
/** An area this shallow (`src`, `api`) names nothing; fall back to the top file's own folder. */
const MIN_AREA_SEGMENTS = 2;
const MAX_AREA_SEGMENTS = 5;
const MAX_PROMPT_CHARS = 200;
const MAX_KEY_CHARS = 255;

export interface RunExploration {
  /** What the run was asked. A map with no task is a list of files, not a lesson. */
  prompt?: string;
  /** Every successful read, duplicates INCLUDED — a file read eight times mattered more. */
  read: readonly string[];
  /** Files the run created or edited. These rank above any read. */
  changed: readonly string[];
}

export interface CodeMapFact {
  key: string;
  content: string;
}

/** `./a\\b.ts` → `a/b.ts`; absolute or escaping paths are dropped (they are not repo files). */
function normalizePath(raw: string): string | undefined {
  const p = raw.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "");
  if (!p || p.startsWith("/") || /^[a-z]:\//i.test(p) || p.split("/").includes("..")) return undefined;
  return p;
}

function dirSegments(file: string): string[] {
  const parts = file.split("/");
  parts.pop();
  return parts;
}

/** The deepest directory every file shares. */
function commonDir(files: readonly string[]): string[] {
  if (files.length === 0) return [];
  let shared = dirSegments(files[0]!);
  for (const f of files.slice(1)) {
    const segs = dirSegments(f);
    let i = 0;
    while (i < shared.length && i < segs.length && shared[i] === segs[i]) i++;
    shared = shared.slice(0, i);
  }
  return shared;
}

/**
 * The area a set of ranked files belongs to: the directory the top few share, or —
 * when they share almost nothing (a run that touched `api/` and `frontend/`) — the
 * folder of the file the run leaned on most. Capped so a key never names one file.
 */
function areaOf(ranked: readonly string[]): string {
  const top = ranked.slice(0, 5);
  let area = commonDir(top);
  if (area.length < MIN_AREA_SEGMENTS) area = dirSegments(ranked[0]!);
  return area.slice(0, MAX_AREA_SEGMENTS).join("/") || "(root)";
}

/** The fact key for an area — stable across runs, so the newest map of it replaces the last. */
export function codeMapFactKey(area: string): string {
  return `${CODE_MAP_FACT_PREFIX}${area}`.slice(0, MAX_KEY_CHARS);
}

/**
 * The code-map fact for one finished run, or `null` when the run touched too little
 * to be worth remembering. `at` dates the map so a reader can judge its age.
 */
export function buildCodeMapFact(input: RunExploration, at: Date = new Date()): CodeMapFact | null {
  const changed = [...new Set(input.changed.map(normalizePath).filter((p): p is string => !!p))];
  const readCounts = new Map<string, number>();
  for (const raw of input.read) {
    const p = normalizePath(raw);
    if (p) readCounts.set(p, (readCounts.get(p) ?? 0) + 1);
  }
  const changedSet = new Set(changed);
  const readOnly = [...readCounts.entries()]
    .filter(([p]) => !changedSet.has(p))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([p]) => p);
  const ranked = [...changed, ...readOnly];
  if (ranked.length === 0) return null;
  if (changed.length === 0 && ranked.length < MIN_MAPPED_FILES) return null;

  const shown = ranked.slice(0, MAX_MAPPED_FILES);
  const area = areaOf(shown);
  const asked = (input.prompt ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_PROMPT_CHARS);
  const lines = [
    `Code map for \`${area}\` (mapped ${at.toISOString().slice(0, 10)}${asked ? ` by a run asked: "${asked}"` : ""}).`,
    "Open these first instead of searching:",
    ...shown.map((p) => {
      if (changedSet.has(p)) return `- ${p} (changed)`;
      const n = readCounts.get(p) ?? 1;
      return `- ${p}${n > 1 ? ` (read ${n}×)` : ""}`;
    }),
  ];
  if (ranked.length > shown.length) lines.push(`(+${ranked.length - shown.length} more file(s) touched)`);
  return { key: codeMapFactKey(area), content: lines.join("\n") };
}
