import React, { useEffect, useState } from 'react';
import type { BrainRunActivity, BrainRunPhase } from '@seanhogg/builderforce-brain-embedded';

/**
 * The in-flight step, animated.
 *
 * The timeline renders SETTLED steps: a tool appears once it has finished, with
 * its duration attached. That leaves the whole time a step is actually running
 * with nothing to show but a static "Thinking…" line — so a `search_code` that
 * takes 67 seconds and a wedged extension host look exactly alike, and the only
 * honest thing a user can conclude is that the product hung.
 *
 * This component is the missing half. It renders the CURRENT phase from
 * `BrainRunActivity` (published on entry by the run store, not on completion),
 * with three things a static label cannot carry:
 *
 *  1. **Motion** — a rotating ring, a travelling shimmer on the label, and an
 *     indeterminate progress bar. Motion is the signal; the words are the detail.
 *  2. **Subject** — WHICH tool, on WHAT file or query. "Reading
 *     LandingCanvasHero.module.css" is progress; "Thinking…" is not.
 *  3. **Elapsed** — a live counter, ticking here rather than in the parent, plus
 *     an explicit reassurance once a step passes {@link SLOW_AFTER_MS}. A user
 *     who can see 1m 07s and climbing knows the difference between slow and stuck.
 *
 * Self-contained by design: it owns its own timer, decides its own visibility
 * (returns null when nothing is in flight), and takes a narrow prop contract, so
 * it drops into the web panel, the VS Code webview or the canvas dock unchanged.
 * The `awaiting` phase deliberately does NOT animate — nothing is progressing
 * while the run waits on a human, and pretending otherwise is a lie in motion.
 */

/** Past this, a step gets an explicit "still working" reassurance. */
export const SLOW_AFTER_MS = 12_000;

/** How often the elapsed counter repaints. One second: it is a clock, not a spinner. */
const TICK_MS = 1_000;

export interface LiveActivityLabels {
  /** Phase lines. `tool` / `awaiting` must contain `{tool}`. */
  starting: string;
  thinking: string;
  writing: string;
  tool: string;
  awaiting: string;
  finishing: string;
  /** Appended when the step names a subject — must contain `{target}`. */
  on: string;
  /** Loop iteration chip — must contain `{step}`. */
  step: string;
  /** Shown once a step passes {@link SLOW_AFTER_MS} — must contain `{elapsed}`. */
  slow: string;
  /** Accessible name for the whole indicator. */
  ariaLabel: string;
}

export const DEFAULT_LIVE_ACTIVITY_LABELS: LiveActivityLabels = {
  starting: 'Starting…',
  thinking: 'Thinking…',
  writing: 'Writing the reply…',
  tool: 'Running {tool}',
  awaiting: 'Waiting for you to approve {tool}',
  finishing: 'Wrapping up…',
  on: ' on {target}',
  step: 'step {step}',
  slow: 'Still working — {elapsed} elapsed',
  ariaLabel: 'Current activity',
};

/** Elapsed, formatted for a live counter (0s → 59s → 1m 07s). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/** The glyph per phase. A ring for work that spins, a caret for text arriving,
 *  a pause bar for a run that is waiting on the user. */
const PHASE_GLYPH: Record<BrainRunPhase, string> = {
  starting: '◇',
  thinking: '◍',
  writing: '▍',
  tool: '⟳',
  awaiting: '⏸',
  finishing: '◆',
};

/**
 * Compose the phase sentence. Exported because it is the whole localizable surface
 * of this component — which template each phase picks, and whether the subject is
 * appended — and that is worth testing without standing up a DOM.
 */
export function phaseLine(activity: BrainRunActivity, labels: LiveActivityLabels): string {
  const tool = activity.label ?? '';
  const base =
    activity.phase === 'starting' ? labels.starting
      : activity.phase === 'thinking' ? labels.thinking
        : activity.phase === 'writing' ? labels.writing
          : activity.phase === 'finishing' ? labels.finishing
            : activity.phase === 'awaiting' ? labels.awaiting.replace('{tool}', tool)
              : labels.tool.replace('{tool}', tool);
  // A subject is only appended where one exists — never a placeholder standing in
  // for information we do not have.
  return activity.detail ? `${base}${labels.on.replace('{target}', activity.detail)}` : base;
}

export interface LiveActivityProps {
  /** The in-flight step, or null when the run is idle. */
  activity: BrainRunActivity | null | undefined;
  /** True while the run is executing. A run can be running with no phase yet. */
  isRunning: boolean;
  labels?: Partial<LiveActivityLabels>;
}

function LiveActivityInner({ activity, isRunning, labels: partial }: LiveActivityProps) {
  const labels = { ...DEFAULT_LIVE_ACTIVITY_LABELS, ...partial };
  // A run with no published phase yet (an older run store, or the instant between
  // acceptance and the first phase) still gets an indicator — falling back to
  // `starting` rather than rendering nothing, which is the very failure this fixes.
  const live: BrainRunActivity | null = activity ?? (isRunning ? { phase: 'starting', startedAt: Date.now(), step: 0 } : null);

  const [now, setNow] = useState(() => Date.now());
  const startedAt = live?.startedAt;
  useEffect(() => {
    if (startedAt == null) return;
    // Re-seeded on every phase change so the counter restarts with the step.
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [startedAt]);

  if (!live) return null;

  const elapsed = Math.max(0, now - live.startedAt);
  const slow = elapsed >= SLOW_AFTER_MS;
  // Waiting on a human is not progress. Everything animated is suppressed for it.
  const waiting = live.phase === 'awaiting';

  return (
    <li
      className={`bf-tl__item bf-tl__item--live bf-tl__item--live-${live.phase}`}
      aria-live="polite"
      aria-label={labels.ariaLabel}
    >
      <span className="bf-tl__gutter">
        <span className={`bf-tl__dot ${waiting ? 'bf-tl__dot--muted' : 'bf-tl__dot--working'}`} aria-hidden>
          {PHASE_GLYPH[live.phase]}
        </span>
      </span>
      <div className="bf-tl__body">
        <div className="bf-tl__live-head">
          <span className={`bf-tl__live-line${waiting ? '' : ' bf-tl__live-line--shimmer'}`}>
            {phaseLine(live, labels)}
          </span>
          {/* The elapsed clock is the load-bearing element: it is what proves the
              run is alive. Monospaced so a ticking number doesn't reflow the row. */}
          <span className="bf-tl__live-elapsed">{formatElapsed(elapsed)}</span>
          {live.step > 0 && (
            <span className="bf-tl__live-step">{labels.step.replace('{step}', String(live.step))}</span>
          )}
        </div>
        {!waiting && (
          <span className="bf-tl__live-bar" aria-hidden>
            <span className="bf-tl__live-bar-fill" />
          </span>
        )}
        {slow && !waiting && (
          <span className="bf-tl__live-slow">{labels.slow.replace('{elapsed}', formatElapsed(elapsed))}</span>
        )}
      </div>
    </li>
  );
}

/**
 * Memoized: this component re-renders once a second on its own timer, and it sits
 * inside a transcript that re-renders on every streamed token. Without the memo the
 * two multiply.
 */
export const LiveActivity = React.memo(LiveActivityInner);
