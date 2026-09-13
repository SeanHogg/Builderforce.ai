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

import { asksForChange } from '@builderforce/agent-stall';
import { isCodeChangeTool } from './localWorkspaceTools';
import { isFailedToolResult, type BrainTraceEvent } from './brainTriage';
import { activityTarget } from './runActivity';
import { stableStringify } from './stableStringify';
import type { BrainMessage } from './types';

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

/**
 * Consecutive identical calls at which the streak becomes a verdict on its own.
 * Two in a row is a retry; three is the model asking the same question a third time
 * after hearing the same answer twice, whatever the rest of the run looks like.
 */
export const BACK_TO_BACK_AT = 3;

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
 * fingerprint the live loop-breakers use (`readCoverage.ts`, `repeatedFailure.ts`):
 * same tool, same arguments in any key order — so the report and the in-run
 * advisories always agree on what "identical" means.
 */
function callSignature(ev: BrainTraceEvent): string {
  let args = '';
  try {
    args = stableStringify(ev.args ?? null);
  } catch {
    args = String(ev.args ?? '');
  }
  return `${ev.label}(${args})`;
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
  const target = activityTarget(ev.args);
  return target ? `${ev.label}:${target}` : null;
}

export interface RunProgress {
  /** Tool calls whose label AND arguments exactly repeated an earlier call. */
  duplicateCalls: number;
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

/** Compute the progress/repetition picture for a recorded run. Pure. */
export function computeRunProgress(events: BrainTraceEvent[], messages: BrainMessage[] = []): RunProgress {
  const tools = events.filter((e) => e.category === 'tool');

  const seenCalls = new Set<string>();
  let duplicateCalls = 0;
  const targetCounts = new Map<string, number>();
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
    if (seenCalls.has(sig)) duplicateCalls += 1;
    else seenCalls.add(sig);

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
    }

    if (isMutationTool(ev.label)) {
      mutationsAttempted += 1;
      if (!ev.isError && !isFailedToolResult(ev.result)) mutationsSucceeded += 1;
    }
  }

  const repeatedTargets = [...targetCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  const distinctTargets = targetCounts.size;
  // Every targeted call beyond the first for a given target is a revisit.
  const revisits = repeatedTargets.reduce((sum, t) => sum + (t.count - 1), 0);
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

  const editIntent = hasEditIntent(messages);
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

/** Compact duration for a report line (0.4s / 12s / 3m 20s). */
export function progressDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s ? `${m}m ${s}s` : `${m}m`;
}

/** How many repeated targets to name before summarizing the tail. */
const MAX_NAMED_TARGETS = 4;

/** `git_status ×3 BACK-TO-BACK (all 3 failed)` — one phrasing for the report line and the verdict. */
function formatStreak(s: RepeatStreak): string {
  const outcome = s.failed === 0 ? '' : s.failed === s.count ? ` (all ${s.count} failed)` : ` (${s.failed} of ${s.count} failed)`;
  return `\`${s.label}\` ×${s.count} BACK-TO-BACK${outcome}`;
}

/**
 * Render the progress picture as report lines. Emitted only when there is
 * something to say — a run that advanced cleanly adds a single "Progress:" line
 * rather than four sections of zeroes.
 */
export function formatRunProgress(p: RunProgress): string[] {
  const lines: string[] = [];

  const reach = p.targetedCalls > 0
    ? `${p.distinctTargets} distinct target(s) over ${p.targetedCalls} targeted call(s)`
    : 'no targeted calls';
  lines.push(
    `Progress: ${reach}${p.repeatedTargets.length ? ` · ${Math.round(p.revisitRatio * 100)}% of calls revisited ground already covered` : ' · no repeats'}`
    + `${p.duplicateCalls ? ` · ${p.duplicateCalls} EXACT duplicate call(s)` : ''}`
    + `${p.longestStreak ? ` · ${formatStreak(p.longestStreak)}${p.streaks > 1 ? ` (${p.streaks} such streaks)` : ''}` : ''}`,
  );

  if (p.repeatedTargets.length) {
    const named = p.repeatedTargets.slice(0, MAX_NAMED_TARGETS)
      .map((t) => `${t.label} ×${t.count}`)
      .join(' · ');
    const rest = p.repeatedTargets.length - MAX_NAMED_TARGETS;
    lines.push(`Revisited: ${named}${rest > 0 ? ` (+${rest} more)` : ''}`);
  }

  if (p.editIntent) {
    lines.push(
      `Effect: the request asked for a CHANGE · ${p.mutationsAttempted} mutating call(s) attempted, ${p.mutationsSucceeded} succeeded`
      + `${p.noEffect ? ' · ⚠ NOTHING WAS CHANGED' : ''}`,
    );
  } else if (p.mutationsAttempted > 0) {
    lines.push(`Effect: ${p.mutationsAttempted} mutating call(s) attempted, ${p.mutationsSucceeded} succeeded.`);
  }

  if (p.wallClockMs > 0) {
    const active = Math.max(0, p.wallClockMs - p.idleMs);
    lines.push(
      `Time: ${progressDuration(active)} wall clock · ${progressDuration(p.modelMs)} in the model · ${progressDuration(p.toolMs)} in tools`
      + `${p.slowestStep ? ` · slowest ${p.slowestStep.label} (${progressDuration(p.slowestStep.ms)})` : ''}`
      + `${p.idleMs > 0 ? ` · ${progressDuration(p.idleMs)} waiting on the user between turns, excluded (span ${progressDuration(p.wallClockMs)})` : ''}`,
    );
  }

  return lines;
}

/**
 * The one-sentence verdict for a run that spun or had no effect. Returned
 * separately from {@link formatRunProgress} because it belongs in the "Likely
 * cause" header, above every other signal — a reader who acts on the header alone
 * must be sent at the real fault. Null when neither condition holds.
 */
export function runProgressVerdict(p: RunProgress): string | null {
  if (!p.spinning && !p.noEffect) return null;

  const worst = p.repeatedTargets[0];
  // A back-to-back streak is named FIRST: it is the tightest loop there is — the
  // same call, the same answer, and another identical call with nothing tried in
  // between — and it stands on its own even when the revisit ratio is low.
  const streak = p.stuckOnCall && p.longestStreak
    ? `it made the same call ${p.longestStreak.count} times in a row — ${formatStreak(p.longestStreak)} — with nothing else attempted between them${p.longestStreak.failed === p.longestStreak.count ? ', re-asking a question it had already been answered the same way each time' : ''}`
    : null;
  const revisit = p.repeatedTargets.length
    ? `${Math.round(p.revisitRatio * 100)}% of its targeted calls revisited a target it had already read${worst ? `, worst \`${worst.label}\` ×${worst.count}` : ''}`
    : null;
  const loop = p.spinning
    ? `NO PROGRESS — ${streak ? `${streak}${revisit ? `; ${revisit}` : ''}` : `the run kept going back over ground it had already covered: ${revisit}`}${p.duplicateCalls ? `, and ${p.duplicateCalls} call(s) repeated earlier arguments EXACTLY` : ''}. `
    : 'NO EFFECT — ';
  const effect = p.noEffect
    ? `The request asked for a change and the run finished with ZERO successful mutating calls${p.mutationsAttempted ? ` (${p.mutationsAttempted} attempted, all failed)` : ' — it never attempted one'}, so nothing was actually modified. `
    : '';
  // The remedy differs from every other verdict's, which is the whole reason this
  // one has to outrank them: shrinking context or swapping models does nothing to
  // a run that is re-reading the same file.
  const remedy = p.spinning
    ? `This is a LOOP, not context pressure and not a model that "won't call tools" — the numbers on those signals are a consequence of the repetition, not its cause. ${
      streak && p.longestStreak && p.longestStreak.failed > 0
        ? 'A call repeated back-to-back after FAILING is the model ignoring the error it was given: the failure text usually names the exact change to make (a `repo`, a path, a missing argument). Check that the tool result reached the model un-truncated, and that the repeated-failure advisory fired; if it did and the model still repeated the call, the model is not reading tool results — switch models for this run.'
        : streak
          ? 'A call repeated back-to-back after SUCCEEDING is the model not retaining the answer it already has: the result was truncated, or too large to keep in the transcript. Check the truncated-results count above, and shrink or page that result rather than the transcript.'
          : 'Look at the repeated targets above: the agent is not retaining what it already read (the result was truncated, or the read was too narrow to answer the question). Widen the read, or cache the file in the transcript, rather than shrinking context or switching models.'
    }`
    : 'Check the "Answered from memory" line first — a turn served from the Q&A cache or an Evermind head does NO work by construction, so a run made largely of those has no mutating call to find. Otherwise check whether the agent was ever offered a mutating tool this run (see the tools-advertised line) before concluding the model refused to act.';

  return `${loop}${effect}${remedy}`;
}
