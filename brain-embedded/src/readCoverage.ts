/**
 * The loop-breaker for re-reading.
 *
 * Two guards, one tally:
 *
 * 1. The EXACT repeat — same tool, same arguments. The run loop answers it with a stub
 *    telling the model to reuse the earlier result. That catches a model that asks the
 *    identical question twice.
 *
 * 2. The CIRCLING read — the failure that actually burns runs:
 *
 *     read_file(LandingCanvasHero.module.css, offset 1)
 *     read_file(LandingCanvasHero.module.css, offset 140)
 *     read_file(LandingCanvasHero.module.css, offset 141)   ← one line later
 *     read_file(LandingCanvasHero.module.css, offset 208)
 *     read_file(LandingCanvasHero.module.css, offset 240)
 *     read_file(LandingCanvasHero.module.css, offset 340)
 *     read_file(LandingCanvasHero.module.css, offset 440)
 *
 *    Seven DIFFERENT calls, so the exact-repeat guard stays silent for all of them,
 *    while the model shuffles a window up and down one 566-line file until the tool
 *    budget is gone and the user's actual request — a one-line CSS change — is never
 *    made. Every existing signal scores that run clean.
 *
 * 3. The COVERED window — chat #109: `read_file(BrainService.ts)` fourteen times at
 *    shifting offsets (1050, then 1080, then 1105…) that all sat inside a window the
 *    run had already returned. The circling advisory at 3/5 visits fired and was
 *    ignored; the bytes still flooded the context (prompt peak 97,669). An overlapping
 *    window is an exact-repeat in disguise: those lines are already above. The loop
 *    stubs (or replays from cache once compaction has dropped the original) and tells
 *    the model to page FORWARD from the last line it already has. A jump to uncovered
 *    lines, and a page that extends past a truncated window, still run — those are
 *    the legitimate second pass. An edit of the file still forgets coverage.
 *
 * Both guards live in ONE object because they share the one question that decides
 * whether they are still valid: "did something just change what a re-read would see?"
 * They used to be two structures with two answers. The exact-repeat set was cleared
 * wholesale by EVERY non-read call — a ticket write, a git status, a failed dispatch —
 * so a run that interleaves reads with platform writes never suppressed anything, while
 * the circling tally had already learned to forget only the target an edit touched.
 * Now one `invalidate` speaks for both.
 *
 * Pure and self-contained: a small tally with one method to record a visit and one
 * to describe it. No clock, no I/O.
 */

import { activityTarget, visitTarget, VISIT_QUESTION_SEPARATOR } from './runActivity';
import { isUnscopedMutationTool, isCodeChangeTool, isLocalWorkspaceTool } from './localWorkspaceTools';
import { isReadOnlyShellCommand } from './readOnlyShell';
import { stableStringify } from './stableStringify';

/** Argument keys that name a path — spelled `./a/b/`, `a\\b` and `a/b` by different turns. */
const PATH_ARG_KEYS = new Set(['path', 'scope', 'repo', 'file', 'filePath', 'dir']);

function normalizePathArg(value: string): string {
  const p = value.split('\\').join('/').replace(/^\.\/+/, '').replace(/\/+$/, '');
  return p === '.' ? '' : p;
}

/**
 * The arguments as the guard compares them: strings trimmed, path arguments normalized,
 * empty/absent values dropped, and a `read_file` at offset 1 treated as no offset (that
 * IS the default). A model that asks for `{path: "./api/src/"}` after `{path: "api/src"}`
 * is asking the same question, and the fingerprint used to see two.
 */
export function canonicalReadArgs(tool: string, args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (value == null) continue;
    if (typeof value === 'string') {
      const trimmed = PATH_ARG_KEYS.has(key) ? normalizePathArg(value.trim()) : value.trim();
      if (trimmed) out[key] = trimmed;
      continue;
    }
    out[key] = value;
  }
  if (tool === 'read_file' && (out.offset === 1 || out.offset === 0)) delete out.offset;
  return out;
}

/**
 * Reads whose answer depends on files OTHER than a named target — a search or a symbol
 * lookup over a tree. An edit to any file can change them, so a code change forgets their
 * cached answers (it still forgets only its own target from the visit tally).
 */
const TREE_WIDE_READ_TOOLS = new Set(['search_code', 'find_symbol', 'list_files']);

/**
 * Was this visit ABOUT `target` — the target itself, or a question asked of it (a search
 * scoped to the file an edit just changed)? See `visitTarget`.
 */
function visitedScopeIs(visited: string | null, target: string): boolean {
  return visited === target || (visited?.startsWith(`${target}${VISIT_QUESTION_SEPARATOR}`) ?? false);
}

/** A `run_command` whose every segment only reads — `git log`, `ls`, a `for` loop of `git rev-list`. */
function isReadOnlyShellCall(tool: string, args: unknown): boolean {
  if (tool !== 'run_command' || !args || typeof args !== 'object') return false;
  const record = args as Record<string, unknown>;
  const command = typeof record.command === 'string' ? record.command : typeof record.cmd === 'string' ? record.cmd : '';
  return isReadOnlyShellCommand(command);
}

/** A tool result as an object — the host may hand it back already parsed or as JSON text. */
function resultObject(result: unknown): Record<string, unknown> | null {
  if (result && typeof result === 'object' && !Array.isArray(result)) return result as Record<string, unknown>;
  if (typeof result === 'string') {
    try {
      const parsed = JSON.parse(result) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
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

/**
 * Default `read_file` window when the caller omitted `limit` — matches
 * `READ_DEFAULT_LINE_LIMIT` in `@builderforce/agent-tools`. Kept as a number here so
 * this module stays free of that package.
 */
const READ_WINDOW_DEFAULT = 2000;

interface LineSpan {
  /** Inclusive 1-based first line. */
  start: number;
  /** Inclusive 1-based last line. */
  end: number;
}

function asPositiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** The line range a `read_file` call is ASKING for. */
function requestedReadWindow(args: Record<string, unknown>): LineSpan {
  const start = asPositiveInt(args.offset, 1);
  const limit = asPositiveInt(args.limit, READ_WINDOW_DEFAULT);
  return { start, end: start + limit - 1 };
}

/**
 * The line range an earlier `read_file` actually RETURNED. Null when the cached
 * payload does not describe a window (a stub, a failure, an empty body).
 */
function servedReadWindow(result: unknown): LineSpan | null {
  const data = resultObject(result);
  if (!data || data.ok === false) return null;
  const start = asPositiveInt(data.offset, 1);
  const content = typeof data.content === 'string' ? data.content : '';
  const returned = content === '' ? 0 : content.split('\n').length;
  if (returned <= 0) return null;
  let end = start + returned - 1;
  // A complete (not truncated) read of the rest of the file covers through EOF, even
  // when the caller asked for a 2000-line window of a 400-line file.
  if (data.truncated !== true && typeof data.totalLines === 'number' && data.totalLines >= start) {
    end = Math.max(end, Math.floor(data.totalLines));
  }
  return { start, end };
}

function spanContains(outer: LineSpan, inner: LineSpan): boolean {
  return inner.start >= outer.start && inner.end <= outer.end;
}

/**
 * Clip a requested window to EOF when the covering read actually reached the end of
 * the file. A later default-size `read_file` of a 400-line file (asking for 1–2000)
 * is the same question as the complete 1–400 already held — without the clip it
 * would look like it extends past the covering window and would run again.
 */
function clipRequestedToEof(want: LineSpan, covering: unknown): LineSpan {
  const data = resultObject(covering);
  if (!data || data.truncated === true || typeof data.totalLines !== 'number' || data.totalLines < 1) return want;
  return { start: want.start, end: Math.min(want.end, Math.floor(data.totalLines)) };
}

/**
 * Visits to one target before the model is told it is circling. Two reads of a
 * long file is ordinary (read the top, jump to the section); the THIRD is the
 * point where a pass stops being navigation and starts being a loop.
 */
export const REVISIT_NUDGE_AT = 3;

/**
 * Visits after which the advisory escalates from a reminder to an instruction.
 * By the fifth read of one file the gentle version has demonstrably not worked.
 */
export const REVISIT_HARD_AT = 5;

export interface ReadVisit {
  /** How many times this target has now been read, including this call. */
  count: number;
  /** The distinct argument sets already used against it, oldest first, capped. */
  priorArgs: string[];
  /**
   * Something with an UNKNOWN blast radius (a shell command, a merge, an undo) ran
   * between the previous read of this target and this one, so this read may well be
   * returning different bytes. The advisory stays silent for it — re-reading after a
   * build or a codemod is exactly the right move — but the COUNT still stands, so a
   * model circling one file across three `run_command`s is still caught on the next
   * read. See {@link ReadCoverage.invalidate}.
   */
  mayHaveChanged: boolean;
}

/** Distinct argument sets remembered per target — enough to quote back, not a log. */
const MAX_REMEMBERED_ARGS = 8;

/**
 * What a successful read RETURNED, kept so an exact repeat can be answered from memory.
 *
 * The exact-repeat stub tells the model "the result is already in the conversation
 * above" — which stops being true the moment auto-compaction summarizes that result
 * away. Measured on chat #101: a file read once, compacted out of the working context,
 * then requested again five times, and every one of those answered with a stub pointing
 * at content the model could no longer see. It read the stub as "I lack the file",
 * asked again, and the run ended with 50% of its calls revisiting old ground and not
 * one edit made. The cache is what lets the loop re-serve the result instead — without
 * touching the disk, and without a stub that lies.
 *
 * `anchor` is the transcript message the result was handed to the model in (opaque
 * here; the run loop decides whether that message is still in the working context).
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
  /** The canonical arguments it was made with (see {@link canonicalReadArgs}). */
  args: Record<string, unknown>;
  /** The file/search target the read was about, or null for a target-less platform read. */
  target: string | null;
  /** What it returned, once the loop has handed it to the model (see {@link CachedRead}). */
  cached?: CachedRead;
}

/**
 * Per-run tally of which reads have been made, which targets they were about, and how
 * often. One instance per run; the run loop owns it and drops it when the run ends.
 */
export class ReadCoverage {
  private readonly visits = new Map<string, ReadVisit>();
  /** Successful reads by `${tool}:${canonical args}` — the exact-repeat guard. */
  private readonly exact = new Map<string, ExactRead>();

  private static exactKey(tool: string, args: unknown): string {
    return `${tool}:${stableStringify(canonicalReadArgs(tool, args))}`;
  }

  /**
   * Has this exact read — same tool, same arguments in any key order — already
   * SUCCEEDED this run, with nothing since that could have changed its answer? The run
   * loop answers such a call with a stub instead of re-running it.
   */
  isRepeat(tool: string, args: unknown): boolean {
    return this.exact.has(ReadCoverage.exactKey(tool, args));
  }

  /**
   * Keep what a SUCCESSFUL read returned, with the transcript message that carried it,
   * so an exact repeat can be replayed once that message has left the working context.
   * A no-op for a read that was never recorded (a failure has nothing to replay).
   */
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
   * resulting target visit — or null when the call names no target (nothing to be
   * circling around; the exact guard still applies).
   */
  record(tool: string, args: unknown): ReadVisit | null {
    const target = visitTarget(args) ?? null;
    this.exact.set(ReadCoverage.exactKey(tool, args), { tool, args: canonicalReadArgs(tool, args), target });
    if (!target) return null;
    const key = `${tool}:${target}`;
    const existing = this.visits.get(key);
    let argText: string;
    try {
      argText = JSON.stringify(args ?? {});
    } catch {
      argText = String(args ?? '');
    }
    if (!existing) {
      const fresh: ReadVisit = { count: 1, priorArgs: [argText], mayHaveChanged: false };
      this.visits.set(key, fresh);
      return { ...fresh };
    }
    existing.count += 1;
    if (!existing.priorArgs.includes(argText) && existing.priorArgs.length < MAX_REMEMBERED_ARGS) {
      existing.priorArgs.push(argText);
    }
    // The "something ran that could have changed this" pass is spent by the read it
    // excuses: the NEXT read of the same target, with nothing unscoped in between, is
    // circling again. Returned as a SNAPSHOT so the caller cannot hold — or reset — the
    // live tally behind the class's back.
    const visit: ReadVisit = { ...existing };
    existing.mayHaveChanged = false;
    return visit;
  }

  /**
   * A non-read call has run. Forget exactly the reads it could have changed — no more,
   * no less — for BOTH guards:
   *
   * - A tool whose blast radius is unknown (`run_command`, a base-branch merge, an
   *   undo) forgets every cached ANSWER: the honest answer to "what did that touch?" is
   *   "anything", so no exact repeat may be stubbed out afterwards. It does NOT forget
   *   the visit TALLY, and that distinction is the whole difference between a guard that
   *   works and one that is inert. The tally counts the MODEL's behaviour — how many
   *   times it has gone back to one target, with every one of those results still sitting
   *   in the transcript above it — and a build running in between changes none of that.
   *   Clearing it wholesale is what made the advisory unreachable in any run that
   *   verifies its work: read, read, `run_command` (typecheck), read, read, `run_command`
   *   … never reaches three, so the nudge at 3 and the hard stop at 5 never fired, and a
   *   run spent 46% of its calls re-reading ground it had already covered with the loop
   *   guard silent throughout. Instead each target is marked {@link ReadVisit.mayHaveChanged}
   *   so the NEXT read of it is excused — a re-read after a build is the right move — and
   *   the one after that is not.
   * - A file write/edit/delete forgets its own target, across every tool that reads it —
   *   `read_file` and `search_code` on one path are the same stale picture. A re-read of
   *   what was just changed is genuinely new information; nagging about it would punish
   *   exactly the right behaviour. It forgets NOTHING about other files: clearing the
   *   whole tally on every non-read call is what once let one CSS file be read 14 times
   *   with the advisory firing on neither it nor its component.
   * - The remaining local tools (`git_status`, `git_diff`, `git_commit`, …) change nothing
   *   a read observes, so they forget nothing.
   * - Anything else is a platform or MCP call. It may have changed what a PLATFORM read
   *   returns (a ticket update changes the ticket list), so target-less platform reads
   *   are forgotten; file reads are not, because a ticket write does not edit source.
   */
  invalidate(tool: string, args: unknown): void {
    // A shell command that provably only READS (`git log`, `ls`, a loop of `git rev-list`)
    // changed nothing, so it forgets nothing — see `readOnlyShell.ts`. Every other shell
    // command keeps the unknown-blast-radius treatment below.
    if (isUnscopedMutationTool(tool) && !isReadOnlyShellCall(tool, args)) {
      this.exact.clear();
      for (const visit of this.visits.values()) visit.mayHaveChanged = true;
      return;
    }
    if (isCodeChangeTool(tool)) {
      const target = activityTarget(args);
      // A file mutation with no resolvable path changed nothing this tally describes.
      if (!target) return;
      for (const key of [...this.visits.keys()]) {
        if (visitedScopeIs(key.slice(key.indexOf(':') + 1), target)) this.visits.delete(key);
      }
      for (const [key, read] of [...this.exact.entries()]) {
        // Its own target, and every tree-wide answer the change may have altered: a
        // search that returned no match for a name the edit just added is now wrong.
        if (visitedScopeIs(read.target, target) || TREE_WIDE_READ_TOOLS.has(read.tool)) this.exact.delete(key);
      }
      return;
    }
    if (isLocalWorkspaceTool(tool)) return;
    for (const [key, read] of [...this.exact.entries()]) {
      if (!isLocalWorkspaceTool(read.tool)) this.exact.delete(key);
    }
  }

  /**
   * Answer a `read_file` whose window is already inside an earlier successful window
   * of the SAME file. Chat #109's fourteen overlapping reads of one service file were
   * different exact-repeat keys (offset 1050, then 1080, then 1105) so the stub never
   * ran; the circling advisory fired and was ignored; the bytes still filled the
   * window. This is that stub for overlapping windows.
   *
   * A jump to lines the earlier read did not return, and a page that extends past a
   * truncated window, return null — those still need the disk. An edit of the file
   * forgets the covering cache via {@link invalidate}.
   */
  coveredRead(tool: string, args: unknown): CoveredRead | null {
    if (tool !== 'read_file') return null;
    const wanted = canonicalReadArgs(tool, args);
    const path = typeof wanted.path === 'string' ? wanted.path : '';
    if (!path) return null;
    const want = requestedReadWindow(wanted);
    for (const read of this.exact.values()) {
      if (read.tool !== 'read_file' || !read.cached) continue;
      const earlierPath = typeof read.args.path === 'string' ? read.args.path : '';
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
   * Answer a `search_code` from a WIDER search already held: the same query (and the same
   * other arguments) run earlier over an ancestor directory — or the whole tree — whose
   * result was complete (not truncated). Filtering those matches to the narrower `path`
   * is exactly what re-running the search would return, without running it.
   *
   * Measured on a ticket-review run: one directory searched nine times and one file six,
   * mostly re-asking a question an earlier, broader search had already answered. Null when
   * no complete covering result is held — then the search runs as normal.
   */
  derivedSearch(tool: string, args: unknown): Record<string, unknown> | null {
    if (tool !== 'search_code') return null;
    const wanted = canonicalReadArgs(tool, args);
    const scope = typeof wanted.path === 'string' ? wanted.path : '';
    if (!scope) return null; // an unscoped search has no wider search to come from
    const { path: _scope, ...rest } = wanted;
    const others = stableStringify(rest);
    for (const read of this.exact.values()) {
      if (read.tool !== 'search_code' || !read.cached) continue;
      const { path: earlierPath, ...earlierRest } = read.args;
      const earlier = typeof earlierPath === 'string' ? earlierPath : '';
      if (earlier === scope || !isUnderDir(scope, earlier)) continue;
      if (stableStringify(earlierRest) !== others) continue;
      const result = resultObject(read.cached.result);
      if (!result || result.ok !== true || result.truncated === true || !Array.isArray(result.matches)) continue;
      const matches = (result.matches as Array<Record<string, unknown>>).filter(
        (m) => typeof m.path === 'string' && isUnderDir(m.path, scope),
      );
      return {
        ok: true,
        query: wanted.query,
        total: matches.length,
        truncated: false,
        matches,
        note: `Answered from this run's earlier complete search for the same query${earlier ? ` under "${earlier}"` : ' over the whole tree'}, filtered to "${scope}" — not re-run. ${matches.length === 0 ? 'The term does not appear under this path.' : ''}`.trim(),
      };
    }
    return null;
  }
}

/**
 * The advisory to attach to a read result once a target has been visited enough
 * times to look like circling. Null below the threshold — the overwhelming majority
 * of reads carry nothing extra.
 *
 * Written as a diagnosis plus a next move, not a scolding: a model told only "you
 * are repeating yourself" tends to repeat itself apologetically. It is told what it
 * has already been given, why looking again will not help, and which of the two
 * things it should do instead — page FORWARD through the rest of the file from the
 * offset its last result named, or act on what it has. (Not "read it whole in one
 * call": a large file is delivered in budgeted windows, so that advice asked for
 * something the transcript could never carry.)
 */
export function revisitAdvisory(tool: string, target: string, visit: ReadVisit): string | null {
  if (visit.count < REVISIT_NUDGE_AT) return null;
  // A shell command / merge / undo ran since the last read of this target, so this one
  // is genuinely fetching news rather than circling. Nagging here would punish exactly
  // the behaviour the guard wants (verify, then look at what changed).
  if (visit.mayHaveChanged) return null;

  const shape = visit.priorArgs.length > 1
    ? ` The argument sets you have already used on it: ${visit.priorArgs.map((a) => `\`${a}\``).join(', ')}.`
    : '';

  if (visit.count >= REVISIT_HARD_AT) {
    return `STOP RE-READING. This is call ${visit.count} of \`${tool}\` against ${target} in this run, and the previous ${visit.count - 1} results are all still above you in this conversation.${shape} Re-reading it again will return content you already have and will not move the task forward — this pattern is how a run exhausts its tool budget without producing a single change. Do ONE of these now: (a) if you still need more of the file, continue from the \`offset\` the last result's note gave you and page forward in order — never re-open a window you already have; (b) otherwise stop reading and make the edit, or state plainly what is blocking you. Do not issue another partial read of this target.`;
  }

  return `You have now read ${target} ${visit.count} times in this run with \`${tool}\`, and every earlier result is still above you in this conversation.${shape} If you are looking for something you have not found, another window over the same lines is unlikely to surface it — page forward from the \`offset\` the last result's note gave you, or search for the specific symbol with search_code. If you already have what you need, act on it rather than re-reading.`;
}

/**
 * Attach an advisory to a tool result without disturbing its shape. Object results
 * gain a `note` field (the same channel the tools' own guidance uses, so the model
 * meets one convention rather than two); anything else is wrapped so the original
 * value survives intact under `result`.
 */
export function withAdvisory(result: unknown, advisory: string): unknown {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const existing = (result as { note?: unknown }).note;
    const note = typeof existing === 'string' && existing ? `${existing}\n\n${advisory}` : advisory;
    return { ...(result as Record<string, unknown>), note };
  }
  return { result, note: advisory };
}
