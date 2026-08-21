'use client';

/**
 * THE collaborative clock — one component for `timer` and `stopwatch`.
 *
 * ── WHAT THIS FIXES ─────────────────────────────────────────────────────────
 * The Creation Canvas's `timer` was a card with the string "05:00" in its status field.
 * It did not run. The knowledge board — the second canvas that has now folded into this
 * one — had a real one, and a real stopwatch beside it, and the whole seam the roadmap
 * logged was that the surface which is actually the front door had the weaker version of
 * primitives the other one got right.
 *
 * ── WHY LIVENESS IS THE SHARED MODEL, NOT A LOCAL CLOCK ─────────────────────
 * A running clock stores `startedAt` (epoch ms) plus the elapsed time accumulated BEFORE
 * this run. Every viewer then derives the same value from the same two numbers. The
 * alternative — ticking a stored `remaining` down and writing it back — makes the clock a
 * stream of edits, so two people watching the same timebox see two different numbers and
 * the board's history fills with one revision per second.
 *
 * That is also what makes it collaborative for free: those two numbers are node data, and
 * node data is what the canvas already syncs.
 *
 * ── WHY ONE COMPONENT AND NOT TWO KINDS' WORTH ──────────────────────────────
 * A countdown and a count-up are the same machine read from opposite ends: same
 * start/pause/reset, same derivation, and the only difference is whether the number
 * shown is `duration - elapsed` or `elapsed`. Two components would be two places to fix
 * the day the derivation changes. The KINDS stay two, because "how long is left" and
 * "how long did that take" are different questions — see the contract's own note.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CreationNodeData } from './types';
import styles from './CreationCanvas.module.css';

/** How often the DISPLAY re-derives. Four times a second: fast enough that the seconds
 *  digit never looks stuck, slow enough that a board of ten clocks is not a render
 *  storm. Nothing is written on a tick — see the module header. */
const TICK_MS = 250;

/** A fresh timer's timebox. Five minutes, which is the length of every stand-up round
 *  and every retro column anybody has ever run. */
export const DEFAULT_TIMER_MS = 5 * 60 * 1000;

const num = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Elapsed ms for a running or paused clock, given "now". Pure and exported so the
 *  derivation can be asserted without mounting a board.
 *
 *  Takes the whole object data, like `clockRemainingMs` beside it, and NAMES the two
 *  fields it reads here instead of in the type. `Pick<CreationNodeData, 'startedAt' |
 *  'baseElapsedMs'>` does not work: the data type carries an index signature and
 *  declares neither field, so `Pick` produces REQUIRED `unknown` properties that no
 *  real clock object satisfies. Spelling them as two optional fields does not work
 *  either — an all-optional target is a weak type, and a type whose only match is
 *  through an index signature has "no properties in common" with it. Reads
 *  `startedAt` (when the clock was last started) and `baseElapsedMs` (what it had
 *  accumulated before that), both through `num`. */
export function clockElapsedMs(data: CreationNodeData, nowMs: number): number {
  const started = data.startedAt == null ? null : num(data.startedAt, 0);
  return num(data.baseElapsedMs) + (started ? Math.max(0, nowMs - started) : 0);
}

/** Remaining ms on a countdown, never negative — a timebox that has run out reads
 *  00:00 and stays there rather than counting into the past. */
export function clockRemainingMs(data: CreationNodeData, nowMs: number): number {
  return Math.max(0, num(data.durationMs, DEFAULT_TIMER_MS) - clockElapsedMs(data, nowMs));
}

/** mm:ss, or h:mm:ss once there is an hour to show. Tabular by CSS, not by padding
 *  every field to the same width — a clock that reads "01:05:03" is not a clock that
 *  should read "1:5:3". */
export function formatClock(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function CanvasClockBody({
  data, onEdit,
}: {
  data: CreationNodeData;
  onEdit?: (patch: Partial<CreationNodeData>) => void;
}) {
  const t = useTranslations('creationCanvas.clock');
  const countdown = data.kind === 'timer';
  const running = data.startedAt != null;

  // The only local state is WHAT TIME IT IS. Everything about the clock itself lives in
  // the shared model, which is what stops two viewers disagreeing.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return undefined;
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(tick);
  }, [running]);

  const elapsed = clockElapsedMs(data, running ? now : 0);
  const shown = countdown ? clockRemainingMs(data, running ? now : 0) : elapsed;
  const expired = countdown && shown === 0 && (running || num(data.baseElapsedMs) > 0);

  const start = () => onEdit?.({ startedAt: Date.now() } as Partial<CreationNodeData>);
  // Pausing FOLDS this run into the accumulated total and clears the start instant,
  // which is what lets resuming continue rather than restart.
  const pause = () => onEdit?.({ startedAt: null, baseElapsedMs: clockElapsedMs(data, Date.now()) } as Partial<CreationNodeData>);
  const reset = () => onEdit?.({ startedAt: null, baseElapsedMs: 0 } as Partial<CreationNodeData>);

  return (
    <div className={styles.clockBody} data-expired={expired ? 'true' : undefined}>
      <strong className={styles.clockValue} role="timer" aria-live="off">{formatClock(shown)}</strong>
      <span className={styles.clockCaption}>
        {expired ? t('finished') : running ? t('running') : t('paused')}
        {countdown && <> · {t('boxOf', { length: formatClock(num(data.durationMs, DEFAULT_TIMER_MS)) })}</>}
      </span>
      {onEdit && (
        <div className={styles.clockActions}>
          <button type="button" onClick={running ? pause : start}>{running ? t('pause') : t('start')}</button>
          <button type="button" onClick={reset} disabled={!running && elapsed === 0}>{t('reset')}</button>
        </div>
      )}
    </div>
  );
}
