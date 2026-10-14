/**
 * THE replay player (PRD 33 §6: one player). A DOM reconstruction played like
 * a video (D10): rrweb rebuilds the page in a sandboxed iframe, scaled to fit
 * the panel; the timeline, event list and controls sit around it.
 *
 * Loading, rrweb and follow mode live in `useReplayPlayback`; this file is
 * layout and the outward actions — copy a link at this moment, the speed /
 * inactivity controls, the heat overlay (`PlayerHeatOverlay`), "Export as
 * video" (`ReplayExportControl`) and the fixes prescribed for the recording's
 * own page (THE fix card, compact).
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useErrorText } from '@/i18n/useErrorMessage';
import { useToast } from '@/components/ToastProvider';
import { Icon } from '@/components/ui/Icon';
import { panelHref } from '@/components/insights/panelUrl';
import { HeatLegend } from './heatmap/HeatmapOverlay';
import { PlayerHeatOverlay } from './PlayerHeatOverlay';
import { ReplayEventList } from './ReplayEventList';
import { ReplayExportControl } from './ReplayExportControl';
import { ReplayHeader } from './ReplayHeader';
import { ReplaySummary } from './ReplaySummary';
import { ReplayTimeline } from './ReplayTimeline';
import { TicketFromMoment } from './TicketFromMoment';
import { PrescriptionCard } from './prescriptions/PrescriptionCard';
import { usePrescriptionsFor } from './prescriptions/usePrescriptionsFor';
import { fmtClock } from './replayMarks';
import { REPLAY_SPEEDS, useReplayPlayback } from './useReplayPlayback';

export interface ReplayPlayerProps {
  siteId: string;
  recordingId: string;
  /** Start position in seconds (a `&t=` link). */
  startAtSeconds?: number;
  /** Live follow: keep appending new chunks. */
  follow?: boolean;
  /** "Define from this click": a click mark's selector becomes a smart-event rule (the host opens the editor). */
  onDefineEvent?: (selector: string) => void;
}

/** Scale the recorded viewport down to the stage's width (never up). */
function useStageScale(viewport: { w: number; h: number } | null) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !viewport || typeof ResizeObserver === 'undefined') return undefined;
    // The observer reports the stage's size once on observe, then on every resize.
    const observer = new ResizeObserver(() => setScale(Math.min(1, stage.clientWidth / Math.max(viewport.w, 1))));
    observer.observe(stage);
    return () => observer.disconnect();
  }, [viewport]);
  return { stageRef, scale };
}

/** One player per recording: keyed, so switching recordings starts clean. */
export function ReplayPlayer(props: ReplayPlayerProps) {
  return <PlayerBody key={props.recordingId} {...props} />;
}

function PlayerBody({ siteId, recordingId, startAtSeconds = 0, follow = false, onDefineEvent }: ReplayPlayerProps) {
  const t = useTranslations('replay.player');
  const tHeat = useTranslations('replay.heat');
  const toast = useToast();
  const errorText = useErrorText();
  const playback = useReplayPlayback({ siteId, recordingId, follow, startAtMs: startAtSeconds * 1000 });
  const { recording, status, playing, currentMs, totalMs } = playback;
  const viewport = recording?.viewport ?? null;
  const { stageRef, scale } = useStageScale(viewport);
  const marks = recording?.marks ?? [];
  const [heatOn, setHeatOn] = useState(false);

  async function copyLink() {
    const seconds = Math.floor(currentMs / 1000);
    const href = panelHref({ kind: 'recording', id: recordingId, tab: 'replay', t: seconds });
    try {
      await navigator.clipboard.writeText(href);
      toast.success(t('copied'));
    } catch (error) {
      toast.error(t('copyFailed'));
      void error;
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0 }}>
      {recording && <ReplayHeader recording={recording} />}
      {follow && (
        <p role="status" style={{ margin: 0, color: 'var(--success)', fontSize: 'var(--font-size-small)' }}>{t('following')}</p>
      )}

      <div
        ref={stageRef}
        style={{
          position: 'relative',
          width: '100%',
          height: viewport ? viewport.h * scale : 240,
          overflow: 'hidden',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--surface)',
        }}
      >
        <div
          ref={playback.rootRef}
          data-testid="replay-stage"
          style={{
            width: viewport?.w ?? '100%',
            height: viewport?.h ?? '100%',
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            pointerEvents: 'none',
          }}
        />
        {heatOn && recording && viewport && status === 'ready' && (
          <div style={{ position: 'absolute', top: 0, left: 0, width: viewport.w, height: viewport.h, transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none' }}>
            <PlayerHeatOverlay siteId={siteId} recording={recording} currentMs={currentMs} frameDocument={playback.frameDocument} />
          </div>
        )}
        {status !== 'ready' && (
          <div
            role={status === 'error' ? 'alert' : 'status'}
            style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)', textAlign: 'center', color: status === 'error' ? 'var(--error)' : 'var(--text-secondary)' }}
          >
            {status === 'loading' && t('loading')}
            {status === 'empty' && t('empty')}
            {status === 'error' && `${t('error')} ${errorText(playback.error)}`}
          </div>
        )}
      </div>

      <ReplayTimeline currentMs={currentMs} totalMs={totalMs} marks={marks} onSeek={playback.seek} />

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)' }}>
        <button
          type="button"
          className="btn-primary"
          style={{ minHeight: 44, minWidth: 44 }}
          disabled={status !== 'ready'}
          aria-label={playing ? t('pause') : t('play')}
          onClick={playing ? playback.pause : playback.play}
        >
          <Icon name={playing ? 'pause' : 'play'} size={18} />
        </button>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--font-size-small)' }}>
          <span>{t('speed')}</span>
          <select
            className="input"
            value={playback.speed}
            onChange={(event) => playback.setSpeed(Number(event.currentTarget.value))}
            style={{ minHeight: 44 }}
          >
            {REPLAY_SPEEDS.map((speed) => (
              <option key={speed} value={speed}>{t('speedOption', { speed })}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--font-size-small)', minHeight: 44 }}>
          <input
            type="checkbox"
            checked={playback.skipInactive}
            onChange={(event) => playback.setSkipInactive(event.currentTarget.checked)}
          />
          <span>{t('skipInactive')}</span>
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--font-size-small)', minHeight: 44 }}>
          <input
            type="checkbox"
            checked={heatOn}
            disabled={status !== 'ready'}
            onChange={(event) => setHeatOn(event.currentTarget.checked)}
          />
          <span>{tHeat('playerToggle')}</span>
        </label>
        {heatOn && <HeatLegend />}
        <button type="button" className="btn-secondary" style={{ minHeight: 44 }} onClick={() => void copyLink()}>
          <Icon name="link" size={16} /> {t('copyLink', { time: fmtClock(currentMs) })}
        </button>
        <TicketFromMoment siteId={siteId} recording={recording} currentMs={currentMs} />
      </div>

      <ReplayExportControl siteId={siteId} recordingId={recordingId} />

      <section aria-labelledby={`replay-events-${recordingId}`} style={{ minWidth: 0 }}>
        <h3 id={`replay-events-${recordingId}`} style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--font-size-small)', color: 'var(--text-primary)' }}>
          {t('events')}
        </h3>
        <div style={{ maxHeight: 280, overflowY: 'auto' }}>
          <ReplayEventList marks={marks} currentMs={currentMs} onSeek={playback.seek} onDefineEvent={onDefineEvent} />
        </div>
      </section>

      <ReplaySummary siteId={siteId} recordingId={recordingId} onSeek={playback.seek} />

      {recording && <PlayerFixes siteId={siteId} route={recording.entryPath} />}
    </div>
  );
}

/** The fixes prescribed for the page this recording landed on. Nothing when there are none. */
function PlayerFixes({ siteId, route }: { siteId: string; route: string }) {
  const t = useTranslations('replay.fixes');
  const { items } = usePrescriptionsFor({ siteId, route });
  if (items.length === 0) return null;
  return (
    <section aria-label={t('playerTitle', { route })} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 }}>
      <h3 style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{t('playerTitle', { route })}</h3>
      {items.map((p) => <PrescriptionCard key={p.id} compact siteId={siteId} prescription={p} />)}
    </section>
  );
}
