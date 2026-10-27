/**
 * The progress picture as report text — the lines a copied diagnostic carries and the
 * one-sentence verdict its "Likely cause" header leads with. The numbers are
 * `runProgress.ts`'s; this module only words them.
 */

import { type RunProgress, type RepeatStreak, type RunSummary } from './runProgress';

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

/** The most recent EARLIER run of the chat that spun, when the latest did not; null otherwise. */
export function spunEarlier(p: RunProgress): { run: RunSummary; index: number } | null {
  if (p.spinning) return null;
  for (let i = p.runs.length - 2; i >= 0; i--) if (p.runs[i]!.spinning) return { run: p.runs[i]!, index: i };
  return null;
}

/** Runs named in the per-run line — the most recent ones. */
const MAX_NAMED_RUNS = 8;
/** How much of a run's opening message names it. */
const ASK_LABEL_CHARS = 48;

/**
 * `Runs (latest last; the figures above are run #11's): #6 "complete the…" 52 turns ·
 * 161 calls · 80 cache-answered · 0 changed ⚠ SPUN · …` — which run of the chat did what.
 */
function formatRuns(runs: readonly RunSummary[]): string {
  const first = Math.max(0, runs.length - MAX_NAMED_RUNS);
  const named = runs.slice(first).map((r, i) => {
    const ask = r.ask.replace(/\s+/g, ' ').trim();
    const label = ask.length > ASK_LABEL_CHARS ? `${ask.slice(0, ASK_LABEL_CHARS)}…` : ask;
    return `#${first + i + 1} "${label}" ${r.turns} turn(s) · ${r.calls} call(s)`
      + `${r.cacheAnswered ? ` · ${r.cacheAnswered} cache-answered` : ''} · ${r.mutationsSucceeded} changed${r.spinning ? ' ⚠ SPUN' : ''}`;
  });
  return `Runs (latest last; the figures above are run #${runs.length}'s): ${first ? `(${first} earlier) ` : ''}${named.join(' | ')}`;
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
    + `${p.cacheAnswered ? ` · ${p.cacheAnswered} call(s) answered from the read cache, never re-run` : ''}`
    + `${p.longestStreak ? ` · ${formatStreak(p.longestStreak)}${p.streaks > 1 ? ` (${p.streaks} such streaks)` : ''}` : ''}`,
  );

  if (p.repeatedTargets.length) {
    const named = p.repeatedTargets.slice(0, MAX_NAMED_TARGETS)
      .map((t) => `${t.label} ×${t.count}`)
      .join(' · ');
    const rest = p.repeatedTargets.length - MAX_NAMED_TARGETS;
    lines.push(`Revisited: ${named}${rest > 0 ? ` (+${rest} more)` : ''}`);
  }

  if (p.runs.length > 1) lines.push(formatRuns(p.runs));

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
  if (!p.spinning && !p.noEffect) {
    const earlier = spunEarlier(p);
    if (!earlier) return null;
    const { run, index } = earlier;
    return `NO PROGRESS in run #${index + 1} of ${p.runs.length} ("${run.ask.replace(/\s+/g, ' ').trim().slice(0, ASK_LABEL_CHARS)}"): it went back over ground it had already covered — ${run.turns} turn(s), ${run.calls} call(s)`
      + `${run.cacheAnswered ? `, ${run.cacheAnswered} of them answered from the read cache` : ''}, ${run.mutationsSucceeded} change(s). `
      + 'The latest run did not spin; the figures above are its own. This is a LOOP in that run, not context pressure — see the Runs line.';
  }

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
