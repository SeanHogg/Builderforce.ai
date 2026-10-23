/**
 * The loop-breaker for re-reading.
 *
 * Three guards, one tally:
 *
 * 1. The EXACT repeat — same tool, same arguments. The run loop answers it with a stub
 *    telling the model to reuse the earlier result.
 *
 * 2. The CIRCLING read — seven DIFFERENT `read_file` calls shuffling a window up and
 *    down one 566-line file until the tool budget is gone and the one-line change the
 *    user asked for is never made. The exact-repeat guard stays silent for all of them;
 *    the visit tally ({@link VisitTally}) is what sees it.
 *
 * 3. The COVERED window — fourteen `read_file`s at shifting offsets (1050, 1080, 1105…)
 *    that all sat inside a window the run had already returned. An overlapping window is
 *    an exact-repeat in disguise: those lines are already above. The loop stubs (or
 *    replays from cache once compaction has dropped the original) and tells the model to
 *    page FORWARD. A jump to uncovered lines, and a page past a truncated window, still run.
 *
 * All three share the one question that decides whether they are still valid: "did
 * something just change what a re-read would see?" — answered once, by {@link
 * ReadCoverage.invalidate}.
 *
 * WHICH tools change what, and what a call is ABOUT, is the host's vocabulary (its tool
 * names, its shell classifier), so it arrives as {@link ReadCoverageTraits}; the rules
 * here are the same on every host. Pure: no clock, no I/O.
 */

import { READ_DEFAULT_LINE_LIMIT, stableStringify } from "@builderforce/agent-tools";
import { VisitTally, type ReadVisit } from "./visitTally.js";

/** The host's tool vocabulary, as the read guard needs it. */
export interface ReadCoverageTraits {
  /** What a call VISITED — its target plus the question asked of it (`scope ∋ query`). */
  visitTarget(args: unknown): string | undefined;
  /** The bare target a call names (a path, a command, a query). */
  activityTarget(args: unknown): string | undefined;
  /** Joins a scope to the question asked of it in a {@link visitTarget}. */
  questionSeparator: string;
  /** Could this call have changed ANY file, unnamed (a shell command, a tree-rewriting git tool)? */
  isUnscopedMutation(tool: string, args: unknown): boolean;
  /** A file write / edit / delete. */
  isCodeChangeTool(tool: string): boolean;
  /** A tool that acts on the local workspace (not a platform / MCP call). */
  isLocalWorkspaceTool(tool: string): boolean;
  /** A local tool that PUBLISHES work (commit / push / open a PR). */
  isRepoPublishTool(tool: string): boolean;
  /** A host read of repository STATE (branches, PRs) that a publish moves. */
  isRepoStateReadTool(tool: string): boolean;
}

/** Argument keys that name a path — spelled `./a/b/`, `a\\b` and `a/b` by different turns. */
const PATH_ARG_KEYS = new Set(["path", "scope", "repo", "file", "filePath", "dir"]);

function normalizePathArg(value: string): string {
  const p = value.split("\\").join("/").replace(/^\.\/+/, "").replace(/\/+$/, "");
  return p === "." ? "" : p;
}

/**
 * The arguments as the guard compares them: strings trimmed, path arguments normalized,
 * empty/absent values dropped, and a `read_file` at offset 1 treated as no offset (that
 * IS the default).
 */
export function canonicalReadArgs(tool: string, args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (value == null) continue;
    if (typeof value === "string") {
      const trimmed = PATH_ARG_KEYS.has(key) ? normalizePathArg(value.trim()) : value.trim();
      if (trimmed) out[key] = trimmed;
      continue;
    }
    out[key] = value;
  }
  if (tool === "read_file" && (out.offset === 1 || out.offset === 0)) delete out.offset;
  return out;
}

/** Reads whose answer depends on files OTHER than a named target. An edit to any file
 *  can change them, so a code change forgets their cached answers. */
const TREE_WIDE_READ_TOOLS = new Set(["search_code", "find_symbol", "list_files", "semantic_search", "repo_map"]);

/** A tool result as an object — the host may hand it back already parsed or as JSON text. */
function resultObject(result: unknown): Record<string, unknown> | null {
  if (result && typeof result === "object" && !Array.isArray(result)) return result as Record<string, unknown>;
  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function isUnderDir(p: string, dir: string): boolean {
  if (!dir) return true;
  const path = normalizePathArg(p);
  return path === dir || path.startsWith(`${dir}/`);
}

interface LineSpan {
  /** Inclusive 1-based first line. */
  start: number;
  /** Inclusive 1-based last line. */
  end: number;
}

function asPositiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** The line range a `read_file` call is ASKING for. */
function requestedReadWindow(args: Record<string, unknown>): LineSpan {
  const start = asPositiveInt(args.offset, 1);
  const limit = asPositiveInt(args.limit, READ_DEFAULT_LINE_LIMIT);
  return { start, end: start + limit - 1 };
}

/** The line range an earlier `read_file` actually RETURNED; null when the cached payload
 *  does not describe a window (a stub, a failure, an empty body). */
function servedReadWindow(result: unknown): LineSpan | null {
  const data = resultObject(result);
  if (!data || data.ok === false) return null;
  const start = asPositiveInt(data.offset, 1);
  const content = typeof data.content === "string" ? data.content : "";
  const returned = content === "" ? 0 : content.split("\n").length;
  if (returned <= 0) return null;
  let end = start + returned - 1;
  // A complete (not truncated) read of the rest of the file covers through EOF.
  if (data.truncated !== true && typeof data.totalLines === "number" && data.totalLines >= start) {
    end = Math.max(end, Math.floor(data.totalLines));
  }
  return { start, end };
}

function spanContains(outer: LineSpan, inner: LineSpan): boolean {
  return inner.start >= outer.start && inner.end <= outer.end;
}

/** Clip a requested window to EOF when the covering read actually reached the end of the file. */
function clipRequestedToEof(want: LineSpan, covering: unknown): LineSpan {
  const data = resultObject(covering);
  if (!data || data.truncated === true || typeof data.totalLines !== "number" || data.totalLines < 1) return want;
  return { start: want.start, end: Math.min(want.end, Math.floor(data.totalLines)) };
}

/**
 * What a successful read RETURNED, kept so an exact repeat can be answered from memory —
 * the "already above you" stub stops being true the moment compaction summarizes that
 * result away. `anchor` is the transcript message the result was handed to the model in
 * (opaque here; the run loop decides whether that message is still in the working context).
 */
export interface CachedRead {
  /** The tool's UNTRIMMED result — the loop re-trims it to the budget on replay. */
  result: unknown;
  anchor: unknown;
}

/** What {@link ReadCoverage.coveredRead} hands the loop. */
export interface CoveredRead {
  /** Inclusive first line of the request (after EOF clip). */
  start: number;
  /** Inclusive last line of the request (after EOF clip). */
  end: number;
  /** The covering read's cache — replay this when compaction dropped the original. */
  cached: CachedRead | null;
  /** The note the model should read instead of another copy of those lines. */
  note: string;
}

/** One successful read this run has already made, by its canonical fingerprint. */
interface ExactRead {
  tool: string;
  args: Record<string, unknown>;
  /** The file/search target the read was about, or null for a target-less platform read. */
  target: string | null;
  cached?: CachedRead;
}

/**
 * Per-run tally of which reads have been made, which targets they were about, and how
 * often. One instance per run; the run loop owns it and drops it when the run ends.
 */
export class ReadCoverage {
  private readonly visits = new VisitTally();
  /** Successful reads by `${tool}:${canonical args}` — the exact-repeat guard. */
  private readonly exact = new Map<string, ExactRead>();

  constructor(private readonly traits: ReadCoverageTraits) {}

  private static exactKey(tool: string, args: unknown): string {
    return `${tool}:${stableStringify(canonicalReadArgs(tool, args))}`;
  }

  /** Was this visit ABOUT `target` — the target itself, or a question asked of it? */
  private visitedScopeIs(visited: string | null, target: string): boolean {
    return visited === target || (visited?.startsWith(`${target}${this.traits.questionSeparator}`) ?? false);
  }

  /** Has this exact read already SUCCEEDED this run, with nothing since that could have changed its answer? */
  isRepeat(tool: string, args: unknown): boolean {
    return this.exact.has(ReadCoverage.exactKey(tool, args));
  }

  /** Keep what a SUCCESSFUL read returned, with the message that carried it. A no-op for
   *  a read that was never recorded (a failure has nothing to replay). */
  cacheResult(tool: string, args: unknown, cached: CachedRead): void {
    const read = this.exact.get(ReadCoverage.exactKey(tool, args));
    if (read) read.cached = cached;
  }

  /** The cached result of an exact earlier read, or null when none is held. */
  cachedResult(tool: string, args: unknown): CachedRead | null {
    return this.exact.get(ReadCoverage.exactKey(tool, args))?.cached ?? null;
  }

  /**
   * Record a SUCCESSFUL read. Arms the exact-repeat guard for it, and returns the
   * resulting target visit — or null when the call names no target.
   */
  record(tool: string, args: unknown): ReadVisit | null {
    const target = this.traits.visitTarget(args) ?? null;
    this.exact.set(ReadCoverage.exactKey(tool, args), { tool, args: canonicalReadArgs(tool, args), target });
    if (!target) return null;
    return this.visits.record(`${tool}:${target}`, args);
  }

  /**
   * A non-read call has run. Forget exactly the reads it could have changed — no more,
   * no less — for every guard:
   *
   * - An unscoped mutation (shell, merge, undo) forgets every cached ANSWER, and marks
   *   every target so its NEXT read is excused — but keeps the visit COUNT: the tally
   *   counts the model's behaviour, which a build in between does not change.
   * - A file write/edit/delete forgets its own target across every tool that reads it,
   *   plus every tree-wide answer; nothing about other files.
   * - A local tool that PUBLISHES work forgets the platform reads and the repo-state
   *   reads, and keeps the file reads.
   * - The remaining local tools change nothing a read observes.
   * - Anything else is a platform / MCP call: it forgets target-less platform reads.
   */
  invalidate(tool: string, args: unknown): void {
    const t = this.traits;
    if (t.isUnscopedMutation(tool, args)) {
      this.exact.clear();
      this.visits.markAllMayHaveChanged();
      return;
    }
    if (t.isCodeChangeTool(tool)) {
      const target = t.activityTarget(args);
      if (!target) return;
      this.visits.forget((key) => this.visitedScopeIs(key.slice(key.indexOf(":") + 1), target));
      for (const [key, read] of [...this.exact.entries()]) {
        if (this.visitedScopeIs(read.target, target) || TREE_WIDE_READ_TOOLS.has(read.tool)) this.exact.delete(key);
      }
      return;
    }
    if (t.isLocalWorkspaceTool(tool) && !t.isRepoPublishTool(tool)) return;
    for (const [key, read] of [...this.exact.entries()]) {
      if (!t.isLocalWorkspaceTool(read.tool) || t.isRepoStateReadTool(read.tool)) this.exact.delete(key);
    }
  }

  /**
   * Answer a `read_file` whose window is already inside an earlier successful window of
   * the SAME file. Null for a jump to lines the earlier read did not return, and for a
   * page that extends past a truncated window — those still need the disk.
   */
  coveredRead(tool: string, args: unknown): CoveredRead | null {
    if (tool !== "read_file") return null;
    const wanted = canonicalReadArgs(tool, args);
    const path = typeof wanted.path === "string" ? wanted.path : "";
    if (!path) return null;
    // A JSON `key` read is not a line window, in either direction.
    if (typeof wanted.key === "string") return null;
    const want = requestedReadWindow(wanted);
    for (const read of this.exact.values()) {
      if (read.tool !== "read_file" || !read.cached) continue;
      if (typeof read.args.key === "string") continue;
      const earlierPath = typeof read.args.path === "string" ? read.args.path : "";
      if (earlierPath !== path) continue;
      const got = servedReadWindow(read.cached.result);
      if (!got) continue;
      const clipped = clipRequestedToEof(want, read.cached.result);
      if (clipped.start > clipped.end) continue;
      if (!spanContains(got, clipped)) continue;
      return {
        start: clipped.start,
        end: clipped.end,
        cached: read.cached,
        note: `Lines ${clipped.start}–${clipped.end} of this file were already returned by an earlier read_file (lines ${got.start}–${got.end}). Reuse that result; if you need later lines, page forward with offset ${got.end + 1}. Do not re-open a window you already have.`,
      };
    }
    return null;
  }

  /**
   * Answer a `search_code` from a WIDER complete search already held (same query, an
   * ancestor scope), filtered to the narrower `path`. A derived 0 is never returned — a
   * parent's 0 may be a false negative, and the tool treats `truncated:false` as proof
   * of absence — so the narrower search must actually run.
   */
  derivedSearch(tool: string, args: unknown): Record<string, unknown> | null {
    if (tool !== "search_code") return null;
    const wanted = canonicalReadArgs(tool, args);
    const scope = typeof wanted.path === "string" ? wanted.path : "";
    if (!scope) return null;
    const { path: _scope, ...rest } = wanted;
    const others = stableStringify(rest);
    for (const read of this.exact.values()) {
      if (read.tool !== "search_code" || !read.cached) continue;
      const { path: earlierPath, ...earlierRest } = read.args;
      const earlier = typeof earlierPath === "string" ? earlierPath : "";
      if (earlier === scope || !isUnderDir(scope, earlier)) continue;
      if (stableStringify(earlierRest) !== others) continue;
      const result = resultObject(read.cached.result);
      if (!result || result.ok !== true || result.truncated === true || !Array.isArray(result.matches)) continue;
      const matches = (result.matches as Array<Record<string, unknown>>).filter(
        (m) => typeof m.path === "string" && isUnderDir(m.path, scope),
      );
      if (matches.length === 0) continue;
      return {
        ok: true,
        query: wanted.query,
        total: matches.length,
        truncated: false,
        matches,
        note: `Answered from this run's earlier complete search for the same query${earlier ? ` under "${earlier}"` : " over the whole tree"}, filtered to "${scope}" — not re-run.`,
      };
    }
    return null;
  }
}
