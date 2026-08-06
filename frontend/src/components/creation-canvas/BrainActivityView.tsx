'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import styles from './CreationCanvas.module.css';
import {
  brainActivityPhase,
  brainActivityTokens,
  brainRunSummary,
  formatElapsed,
  formatTokenCount,
  type BrainRunSummary,
} from './brainActivity';

/**
 * ONE processing signal for every Brain surface on the canvas.
 *
 * The dock used to narrate a turn twice in two different vocabularies — the
 * transcript said "Thinking…" forever while the footer strip rotated through
 * "Churning…", "Designing…", "Executing add object" — and the Brain Object on the
 * board said nothing at all, so a running turn looked stalled out there. Phase,
 * detail, tokens and elapsed are derived here, once, and every surface renders the
 * same words: the transcript's live node, the dock strip, and the board anchor.
 *
 * `startedAt` is threaded from the host that owns the run so two surfaces mounted a
 * tick apart never land on different words at an idle-rotation boundary.
 */

export interface BrainActivityLive {
  /** The phase word — "Churning…", "Executing…". */
  label: string;
  /** The tool the trace named, when it named one. */
  detail: string | null;
  /** Tokens spent so far, or elapsed time until the gateway reports any. */
  meta: string;
}

export interface BrainActivitySettled {
  /** "Thought for 52s" — the receipt for the run that just ended. */
  label: string;
  actions: string | null;
  tokens: string | null;
}

export interface BrainActivityState {
  live: BrainActivityLive | null;
  settled: BrainActivitySettled | null;
}

/**
 * Narrate the turn: what Brain is doing right now, then what it cost.
 *
 * @param running   Whether a turn is in flight.
 * @param trace     Steps recorded so far, oldest first.
 * @param startedAt Epoch ms the run began, when the host tracks it — otherwise the
 *                  clock starts when this surface first saw `running`.
 */
export function useBrainActivity(
  running: boolean,
  trace: readonly BrainTraceEvent[],
  startedAt?: number | null,
): BrainActivityState {
  const t = useTranslations('creationCanvas');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [summary, setSummary] = useState<BrainRunSummary | null>(null);
  const elapsedRef = useRef(0);
  const traceRef = useRef<readonly BrainTraceEvent[]>(trace);
  traceRef.current = trace;

  useEffect(() => {
    if (!running) {
      // Settle the receipt from the run that just ended rather than clearing it:
      // "Thought for 52s" is the answer to "did that actually do anything?".
      if (elapsedRef.current > 0) setSummary(brainRunSummary(traceRef.current, elapsedRef.current));
      elapsedRef.current = 0;
      setElapsedMs(0);
      return;
    }
    setSummary(null);
    const origin = typeof startedAt === 'number' && startedAt > 0 ? startedAt : Date.now();
    const tick = () => {
      elapsedRef.current = Math.max(0, Date.now() - origin);
      setElapsedMs(elapsedRef.current);
    };
    tick();
    const timer = window.setInterval(tick, 400);
    return () => window.clearInterval(timer);
  }, [running, startedAt]);

  if (running) {
    const phase = brainActivityPhase(trace, elapsedMs);
    const tokens = brainActivityTokens(trace);
    return {
      live: {
        label: t(`brainPhase.${phase.id}`),
        detail: phase.detail ?? null,
        meta: tokens > 0 ? t('tokensSpent', { count: formatTokenCount(tokens) }) : formatElapsed(elapsedMs),
      },
      settled: null,
    };
  }

  if (!summary) return { live: null, settled: null };
  return {
    live: null,
    settled: {
      label: t('thoughtFor', { duration: formatElapsed(summary.durationMs) }),
      actions: summary.toolCount > 0 ? t('ranActions', { count: summary.toolCount }) : null,
      tokens: summary.tokens > 0 ? t('tokensSpent', { count: formatTokenCount(summary.tokens) }) : null,
    },
  };
}

/**
 * The single-line phrasing — "Executing… · add object" — shared by the strip and
 * the transcript's live node, so the two never disagree about the same moment.
 */
export function brainActivityLine(live: BrainActivityLive | null): string | null {
  if (!live) return null;
  return live.detail ? `${live.label} · ${live.detail}` : live.label;
}

/**
 * The rendered signal. `strip` is the dock footer (full width, own top border);
 * `inline` is the compact card shown inside the Brain Object on the board.
 *
 * Only the strip announces: two live regions narrating the same run would read the
 * turn out twice to a screen reader.
 */
export function BrainActivityBar({ state, variant = 'strip' }: { state: BrainActivityState; variant?: 'strip' | 'inline' }) {
  const live = state.live;
  const announce = variant === 'strip' ? { role: 'status', 'aria-live': 'polite' as const } : {};
  if (live) {
    return (
      <div className={styles.brainActivity} data-variant={variant} data-state="running" {...announce}>
        <span className={styles.brainActivitySpark} aria-hidden>✳</span>
        <b>{live.label}</b>
        {live.detail && <small>{live.detail}</small>}
        <em>{live.meta}</em>
      </div>
    );
  }
  const settled = state.settled;
  if (!settled) return null;
  return (
    <div className={styles.brainActivity} data-variant={variant} data-state="settled" {...announce}>
      <span className={styles.brainActivitySpark} aria-hidden>✓</span>
      <b>{settled.label}</b>
      {settled.actions && <small>{settled.actions}</small>}
      {settled.tokens && <em>{settled.tokens}</em>}
    </div>
  );
}

/** Convenience for a surface that owns no lifted activity state of its own. */
export function BrainActivityIndicator({
  running, trace, startedAt = null, variant = 'strip',
}: {
  running: boolean;
  trace: readonly BrainTraceEvent[];
  startedAt?: number | null;
  variant?: 'strip' | 'inline';
}) {
  const state = useBrainActivity(running, trace, startedAt);
  return <BrainActivityBar state={state} variant={variant} />;
}
