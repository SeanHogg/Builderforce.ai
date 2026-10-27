/**
 * Did the run actually GET ANYWHERE?
 *
 * The A-vs-B triage in `brainTriage.ts` answers "why did a turn come back
 * empty / degraded". It has no vocabulary at all for the failure this module
 * names: a run where every single turn succeeded — no errors, no truncation, no
 * empty finishes — and the agent still accomplished nothing, because it spent
 * its whole budget re-reading the same file at overlapping offsets and re-running
 * searches it had already run. That run scores clean on every existing signal,
 * so the verdict falls through to whichever context/degradation heuristic happens
 * to trip: a 33k-token prompt peak reports "CONTEXT EXHAUSTION" and sends the
 * reader off to shrink the transcript, when the transcript was never the problem.
 *
 * The signals here are structural and cheap to compute, and they are the ones a
 * human reads the transcript to find:
 *
 *  - **Repetition** — the same call made twice, and the same TARGET read over and
 *    over. Seven reads of one 566-line CSS file is not research, it is a loop.
 *  - **Reach** — how many distinct things the run touched, against how many calls
 *    it made. A run with 26 calls over 3 distinct targets is spinning; one with
 *    26 calls over 22 targets is working.
 *  - **Effect** — whether an edit-shaped REQUEST produced any successful mutation.
 *    "Reduce the height of the box" that ends with zero writes did not fail
 *    halfway; it never started.
 *  - **Time** — where the wall clock went (model vs tools), and the slowest step.
 *    A minute inside one search is a fact about our tools, not about the model.
 *
 * Pure over the recorded trace + visible messages, exactly like `brainTriage.ts`,
 * so every copy surface computes the identical block.
 */

import { asksForChange, isContinuationDirective } from '@builderforce/agent-stall';
import { isCodeChangeTool } from './localWorkspaceTools';
import { isFailedToolResult, type BrainTraceEvent } from './brainTriage';
import { visitTarget } from './runActivity';
import { BACK_TO_BACK_AT, callFingerprint } from '@builderforce/run-guards';
import type { BrainMessage } from './types';
import { splitRuns } from './runSlices';

/** One target the run went back to more than once. */
export interface RepeatedTarget {
  /** `tool:subject`, e.g. `read_file:LandingCanvasHero.module.css`. */
  label: string;
  count: number;
}

/**
 * The same call made again IMMEDIATELY — back to back, with no other tool call in
 * between. The exact-duplicate counter above catches a call repeated anywhere in
 * the run; this catches the tighter and more damning shape: `git_status` → same
 * error → `git_status` → same error → `git_status`. Nothing was learned between
 * the attempts because nothing else was tried.
 */
export interface RepeatStreak {
  /** The tool name, e.g. `git_status`. */
  label: string;
  /** Consecutive identical calls, including the first. */
  count: number;
  /** How many of those calls failed — a streak of failures is a stall on a known
   *  error; a streak of successes is a stall on an answer it already has. */
  failed: number;
}

/** Consecutive identical calls at which the streak becomes a verdict on its own —
 *  the shared `@builderforce/run-guards` threshold the live guards use too. */
export { BACK_TO_BACK_AT };

/** Tools that MUTATE something — the run's "did it have an effect" evidence.
 *  Covers the IDE workspace writers (`isCodeChangeTool`) plus the gateway's
 *  builtin create/update/write/save/delete family, matched structurally so a new
 *  create tool counts without an edit here. Read-only `*_list` / `*_get` /
 *  `*_search` names can't match. */
const MUTATION_TOOL = /(^|_)(write|edit|save|create|update|delete|apply|patch|publish|send|dispatch|run_command|assign|link|move|set)(_|$)/i;

export function isMutationTool(name: string): boolean {
  return isCodeChangeTool(name) || MUTATION_TOOL.test(name);
}

/**
 * Whether the run was asked to CHANGE something. Reads the user turns only — the
 * assistant's own restatement of the task would make this trivially self-fulfilling.
 * Uses the first user turn (the request) plus any later one, since a follow-up can
 * turn a question into a task.
 *
 * The per-message predicate is `asksForChange` from `@builderforce/agent-stall`: the
 * SERVER needs the identical judgement to decide whether an answer may be replayed
 * from cache (a change request must never be), so it cannot live here.
 */
export function hasEditIntent(messages: BrainMessage[]): boolean {
  return messages.some((m) => m.role === 'user' && asksForChange(m.content));
}

/**
 * The structural signature of a call — what makes two calls "the same call". Same
 * fingerprint the live loop-breakers use (`@builderforce/run-guards`):
 * same tool, same arguments in any key order — so the report and the in-run
 * advisories always agree on what "identical" means.
 */
function callSignature(ev: BrainTraceEvent): string {
  return callFingerprint(ev.label, ev.args);
}

/**
 * The signature of what a call was AIMED AT, ignoring the options around it.
 * This is the one that catches the real loop: `read_file` at offset 140, then 141,
 * then 208, then 340 is four DIFFERENT calls (so exact-duplicate detection stays
 * silent) aimed at one file. Reuses the same target extraction the live activity
 * indicator uses, so the report and the progress line always agree on what a step
 * was working on.
 */
function targetSignature(ev: BrainTraceEvent): string | null {
  const target = subjectOf(ev);
  return target ? `${ev.label}:${target}` : null;
}

/** What a call was aimed at, one spelling per file: `./src/a.ts`, `src\a.ts` and
 *  `src/a.ts` are the same target, so an edit of one resets reads of the others. */
function subjectOf(ev: BrainTraceEvent): string | undefined {
  return visitTarget(ev.args)?.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * A call the run's READ CACHE answered instead of the host: an exact-repeat stub, a
 * covered window, a replay, a derived search, a repeated write not re-applied (see
 * `runStore/beforeDispatch.ts`). The model asked again; nothing ran. Counted on its own so
 * "EXACT duplicate" never reads as work the tools repeated, and never as a mutation.
 */
export function isCacheAnswered(ev: BrainTraceEvent): boolean {
  const r = ev.result;
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  // `skipped` alone is also a steer's skipped remainder (`steerInterrupt.ts`) — the
  // repeated-write guard's answer is the one that carries its `note`.
  return o.covered === true || o.replayed === true || o.derived === true
    || (o.skipped === true && typeof o.note === 'string')
    || (typeof o.note === 'string' && /^Duplicate \S+ call/.test(o.note));
}

/** One run of a multi-run chat, in the per-run line (`runProgressReport.ts`). */
export interface RunSummary {
  ask: string;
  turns: number;
  calls: number;
  cacheAnswered: number;
  mutationsSucceeded: number;
  spinning: boolean;
}

export interface RunProgress {
  /** Tool calls whose label AND arguments exactly repeated an earlier call. */
  duplicateCalls: number;
  /** Of every call, those the read cache answered without running (see {@link isCacheAnswered}). */
  cacheAnswered: number;
  /**
   * Every run in the chat, oldest first — empty for a single-run trace. The figures above
   * are the LATEST run's: a chat's trace spans every run in it (see `runSlices.ts`).
   */
  runs: RunSummary[];
  /**
   * The longest run of CONSECUTIVE identical calls, or null when no call was ever
   * repeated back to back. See {@link RepeatStreak}.
   */
  longestStreak: RepeatStreak | null;
  /** How many distinct back-to-back streaks (two or more in a row) the run had. */
  streaks: number;
  /**
   * True when some call was repeated {@link BACK_TO_BACK_AT} or more times in a
   * row. Unlike `spinning` this needs no minimum run size — three identical calls
   * in a row is a stall in a 3-call run as surely as in a 300-call one.
   */
  stuckOnCall: boolean;
  /** Targets hit more than once, most-repeated first. */
  repeatedTargets: RepeatedTarget[];
  /** Distinct targets the run touched (calls with no discernible target excluded). */
  distinctTargets: number;
  /** Calls that named a target — the denominator `distinctTargets` is measured against. */
  targetedCalls: number;
  /**
   * Share of targeted calls that revisited a target already visited. 0 = every call
   * broke new ground; 0.8 = four calls in five went back over old ground.
   */
  revisitRatio: number;
  /** Mutation-tool calls attempted, and how many returned a success. */
  mutationsAttempted: number;
  mutationsSucceeded: number;
  /** True when the user asked for a CHANGE (see {@link hasEditIntent}). */
  editIntent: boolean;
  /**
   * The headline finding: an edit-shaped request, real work performed, and NOT ONE
   * successful mutation to show for it. This is the verdict the pasted report was
   * missing — the run was not starved of context, it never acted.
   */
  noEffect: boolean;
  /**
   * True when the run's calls are dominated by revisits — it is going back over
   * ground it has already covered rather than advancing. Requires enough calls to
   * be meaningful (a 3-call run that read one file twice is not a loop).
   */
  spinning: boolean;
  /** Wall-clock span of the recorded run, first step to last (ms). */
  wallClockMs: number;
  /**
   * Time inside that span the run was WAITING rather than working (ms): the user
   * between two messages, or an `ask_user` answer. A chat's trace spans every message
   * in it, so without this a follow-up sent hours later reported "191m wall clock ·
   * 8m in the model", which reads as three hours lost inside the run.
   */
  idleMs: number;
  /** Measured time inside model completions / inside tools (ms). */
  modelMs: number;
  toolMs: number;
  /** The single slowest step, whatever kind — usually the one worth fixing. */
  slowestStep: { label: string; ms: number } | null;
}

/**
 * An uncovered gap between two steps longer than this is the run WAITING, not working.
 * No step of the loop leaves time unaccounted for this long: a completion or a tool
 * call carries its own duration, so only a person (a new message, an `ask_user`
 * answer) opens a gap this wide.
 */
const IDLE_GAP_MS = 120_000;

/**
 * Compute the progress/repetition picture for a recorded trace. Pure. A chat's trace is
 * cut into its runs; the picture is the LATEST run's, and `runs` names every one so the
 * run that actually spun is visible.
 */
export function computeRunProgress(events: BrainTraceEvent[], messages: BrainMessage[] = []): RunProgress {
  const slices = splitRuns(events, messages);
  if (slices.length === 1) return { ...progressOf(events, hasEditIntent(messages)), runs: [] };
  const intentOf = (ask: string, own: BrainMessage[]) =>
    hasEditIntent(own) || (isContinuationDirective(ask) && hasEditIntent(messages));
  const each = slices.map((s) => ({ s, p: progressOf(s.events, intentOf(s.ask, s.messages)) }));
  const runs = each.map(({ s, p }) => ({
    ask: s.ask,
    turns: s.events.filter((e) => e.label === 'llm.complete').length,
    calls: s.events.filter((e) => e.category === 'tool').length,
    cacheAnswered: p.cacheAnswered,
    mutationsSucceeded: p.mutationsSucceeded,
    spinning: p.spinning,
  }));
  return { ...each[each.length - 1]!.p, runs };
}

function progressOf(events: BrainTraceEvent[], editIntent: boolean): Omit<RunProgress, 'runs'> {
  const tools = events.filter((e) => e.category === 'tool');

  const seenCalls = new Map<string, string | undefined>();
  let duplicateCalls = 0;
  let cacheAnswered = 0;
  // Visits per target, and visits since that target was last CHANGED: a read after the
  // run's own edit of the file is new ground (the bytes are new), not a revisit.
  const targetCounts = new Map<string, number>();
  const sinceEdit = new Map<string, number>();
  // Revisits per target, counted since its last change — what `repeatedTargets` names, so
  // the list and the ratio beside it are the same measurement.
  const revisitsOf = new Map<string, number>();
  let revisits = 0;
  let targetedCalls = 0;
  let mutationsAttempted = 0;
  let mutationsSucceeded = 0;

  // Back-to-back repeats: the current streak of identical calls, and the longest
  // one seen. A streak closes the moment a DIFFERENT call is made.
  let streaks = 0;
  let longestStreak: RepeatStreak | null = null;
  let current: { sig: string; streak: RepeatStreak } | null = null;

  for (const ev of tools) {
    const sig = callSignature(ev);
    const subject = subjectOf(ev);
    if (seenCalls.has(sig)) duplicateCalls += 1;
    else seenCalls.set(sig, subject);
    const cached = isCacheAnswered(ev);
    if (cached) cacheAnswered += 1;

    const failed = Boolean(ev.isError) || isFailedToolResult(ev.result);
    if (current && current.sig === sig) {
      current.streak.count += 1;
      if (failed) current.streak.failed += 1;
      if (current.streak.count === 2) streaks += 1;
      if (!longestStreak || current.streak.count > longestStreak.count) longestStreak = current.streak;
    } else {
      current = { sig, streak: { label: ev.label, count: 1, failed: failed ? 1 : 0 } };
    }

    const target = targetSignature(ev);
    if (target) {
      targetedCalls += 1;
      targetCounts.set(target, (targetCounts.get(target) ?? 0) + 1);
      const seen = sinceEdit.get(target) ?? 0;
      if (seen > 0) {
        revisits += 1;
        revisitsOf.set(target, (revisitsOf.get(target) ?? 0) + 1);
      }
      sinceEdit.set(target, seen + 1);
    }

    if (isMutationTool(ev.label)) {
      mutationsAttempted += 1;
      if (!cached && !ev.isError && !isFailedToolResult(ev.result)) {
        mutationsSucceeded += 1;
        // The target changed: its earlier reads and calls describe bytes that are gone.
        if (subject) {
          for (const key of sinceEdit.keys()) if (key.endsWith(`:${subject}`)) sinceEdit.set(key, 0);
          for (const [s, t] of seenCalls) if (t === subject) seenCalls.delete(s);
        }
      }
    }
  }

  const repeatedTargets = [...revisitsOf.entries()]
    .map(([label, again]) => ({ label, count: again + 1 }))
    .sort((a, b) => b.count - a.count);

  const distinctTargets = targetCounts.size;
  // Every targeted call beyond the first for a given target is a revisit — counted since
  // the target last changed, so re-reading a file the run just edited is not one.
  const revisitRatio = targetedCalls > 0 ? revisits / targetedCalls : 0;

  // Timing. `durationMs` is recorded per step; the wall clock comes from the
  // timestamps, so unmeasured steps (and the gaps between them) still count, except
  // IDLE gaps. A step is stamped when it COMPLETES, so the part of the gap before it
  // that its own duration does not cover is time in which nothing ran; past
  // IDLE_GAP_MS that is the run waiting on a person, not working.
  let modelMs = 0;
  let toolMs = 0;
  let slowestStep: { label: string; ms: number } | null = null;
  const timed: Array<{ t: number; ms: number }> = [];
  for (const ev of events) {
    const ms = typeof ev.durationMs === 'number' && Number.isFinite(ev.durationMs) ? ev.durationMs : 0;
    const t = Date.parse(ev.ts);
    if (Number.isFinite(t)) timed.push({ t, ms });
    if (ev.category === 'llm') modelMs += ms;
    else if (ev.category === 'tool') toolMs += ms;
    if (ms > 0 && (!slowestStep || ms > slowestStep.ms)) slowestStep = { label: ev.label, ms };
  }
  timed.sort((a, b) => a.t - b.t);
  let idleMs = 0;
  for (let i = 1; i < timed.length; i++) {
    const uncovered = timed[i]!.t - timed[i - 1]!.t - timed[i]!.ms;
    if (uncovered > IDLE_GAP_MS) idleMs += uncovered;
  }
  const wallClockMs = timed.length > 1 ? timed[timed.length - 1]!.t - timed[0]!.t : 0;

  const didWork = tools.length > 0;
  const noEffect = editIntent && didWork && mutationsSucceeded === 0;
  // Enough calls to have a shape, and most of them retreading. 6 is the smallest
  // run where "went back over old ground four times" is a pattern and not a
  // coincidence; 0.4 means revisits outnumber every second call.
  // A back-to-back streak needs no such floor: it IS the pattern, at any run size.
  const stuckOnCall = longestStreak !== null && longestStreak.count >= BACK_TO_BACK_AT;
  const spinning = (targetedCalls >= 6 && revisitRatio >= 0.4) || stuckOnCall;

  return {
    duplicateCalls,
    cacheAnswered,
    longestStreak,
    streaks,
    stuckOnCall,
    repeatedTargets,
    distinctTargets,
    targetedCalls,
    revisitRatio,
    mutationsAttempted,
    mutationsSucceeded,
    editIntent,
    noEffect,
    spinning,
    wallClockMs,
    idleMs,
    modelMs,
    toolMs,
    slowestStep,
  };
}
