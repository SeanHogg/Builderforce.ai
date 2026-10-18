// No 'use client' directive: drawn only inside the `CreationCanvas` client boundary (the
// floating prompt and the Brain Object), the same reason `CanvasBarGroup` states.
import { useMemo } from 'react';
import { LiveActivity } from '@seanhogg/builderforce-brain-ui';
import { useRunSnapshot, type BrainRunActivity } from '@seanhogg/builderforce-brain-embedded';
import { useLiveActivityLabels } from '@/i18n/useLiveActivityLabels';
import styles from './styles/brain.module.css';

/**
 * The canvas run's in-flight step, read from THE run store.
 *
 * The canvas turn runs in brain-embedded's run store under `canvasRunKey(sessionId)`, and
 * that store publishes what the run is doing as each step is ENTERED (`activity`). Every
 * other Brain host animates its in-flight row off exactly that, so the board does too —
 * it used to re-derive a second phase vocabulary from the settled trace, which could only
 * name a step after it had finished.
 *
 * A run this viewer is not driving (a collaborator's turn, mirrored onto the board) has no
 * entry in this browser's store. It is narrated from the start time the board carries, so
 * a peer's turn still reads as alive rather than blank.
 */
export function useCanvasRunActivity(
  runKey: string | null | undefined,
  running: boolean,
  startedAt: number | null | undefined,
): BrainRunActivity | null {
  const { activity } = useRunSnapshot(runKey ?? null);
  return useMemo<BrainRunActivity | null>(() => {
    if (!running) return null;
    if (activity) return activity;
    return typeof startedAt === 'number' && startedAt > 0 ? { phase: 'thinking', startedAt, step: 0 } : null;
  }, [activity, running, startedAt]);
}

/**
 * The shared `LiveActivity` row placed OFF the transcript: `composer` is the pill above the
 * floating prompt, `inline` the card inside the Brain Object's anchor. The dock has none —
 * its transcript's own live row is the one reading of the run there.
 */
export function CanvasRunActivity({ runKey, running, startedAt, variant }: {
  runKey: string | null | undefined;
  running: boolean;
  startedAt: number | null | undefined;
  variant: 'composer' | 'inline';
}) {
  const activity = useCanvasRunActivity(runKey, running, startedAt);
  const labels = useLiveActivityLabels();
  if (!running) return null;
  return (
    <ol className={styles.runActivity} data-variant={variant} data-testid="canvas-run-activity">
      <LiveActivity activity={activity} isRunning={running} labels={labels} />
    </ol>
  );
}
