import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { boardsApi, type LaneRunResult } from '@/lib/builderforceApi';

/**
 * "Run this lane now" — start the tickets ALREADY sitting in a lane.
 *
 * The board's autonomous trigger fires on ENTRY: a ticket runs when it LANDS in a
 * staffed lane. That leaves a permanent hole on the other side of the same event —
 * staff an agent onto a lane that already holds forty tickets and nothing happens to
 * any of them, because none of them ever "entered". The board looks configured and is
 * inert, and the only way to start a resident ticket was to drag it out and back in.
 *
 * Staffing a lane now sweeps its residents automatically. This is the EXPLICIT half,
 * for a lane that was staffed before that existed, or whose gate or capability
 * requirement was just relaxed. Every per-ticket guard still applies — it routes
 * through the same funnel a drag does — so the result reports skips as well as starts.
 */
export function LaneRunNowButton({
  boardId,
  laneId,
  style,
}: {
  boardId: string;
  laneId: string;
  /** The host panel's shared subtle-button style, so this reads as one of its controls. */
  style: React.CSSProperties;
}) {
  const t = useTranslations('boardConfig');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<LaneRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      setResult(await boardsApi.runLane(boardId, laneId));
    } catch (e) {
      setError((e as Error).message || t('runLaneError'));
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <button type="button" style={style} onClick={run} disabled={running} title={t('runLaneTitle')}>
        {running ? t('runLaneRunning') : t('runLane')}
      </button>
      {result && (
        <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>
          {result.considered === 0
            ? t('runLaneEmpty')
            : t('runLaneResult', { started: result.started, skipped: result.skipped })}
        </span>
      )}
      {error && <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--danger)' }}>{error}</span>}
    </>
  );
}
