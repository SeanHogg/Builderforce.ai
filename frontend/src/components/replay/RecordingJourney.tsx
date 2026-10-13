/**
 * The recording read as a path: the pages in order, then every signal on the
 * way, each with its time. A row opens the replay at that moment.
 */

import { useTranslations } from 'next-intl';
import type { ReplayMark, ReplayRecordingDto } from '@builderforce/interaction-contract';
import { Icon } from '@/components/ui/Icon';
import { fmtClock, markStyle } from './replayMarks';

export interface RecordingJourneyProps {
  recording: ReplayRecordingDto;
  onSeek: (atMs: number) => void;
}

const STEP_KINDS = new Set(['page']);

function MarkRow({ mark, onSeek }: { mark: ReplayMark; onSeek: (atMs: number) => void }) {
  const t = useTranslations('replay.player');
  const style = markStyle(mark.kind);
  const label = mark.label ?? mark.key;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSeek(mark.atMs)}
        aria-label={t('markerAria', { time: fmtClock(mark.atMs), label })}
        style={{
          width: '100%', minHeight: 44, display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          padding: '0 var(--space-2)', border: 'none', background: 'transparent', color: 'var(--text-primary)',
          textAlign: 'left', cursor: 'pointer', borderRadius: 'var(--radius-sm)',
        }}
      >
        <span style={{ minWidth: 44, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', fontSize: 'var(--font-size-small)' }}>{fmtClock(mark.atMs)}</span>
        <span style={{ color: style.tone, display: 'inline-flex' }}><Icon name={style.icon} size={14} /></span>
        <span style={{ overflowWrap: 'anywhere', fontSize: 'var(--font-size-small)' }}>{label}</span>
      </button>
    </li>
  );
}

export function RecordingJourney({ recording, onSeek }: RecordingJourneyProps) {
  const t = useTranslations('insights.journey');
  const steps = recording.marks.filter((mark) => STEP_KINDS.has(mark.kind));
  const signals = recording.marks.filter((mark) => !STEP_KINDS.has(mark.kind));
  const listStyle = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minWidth: 0 }}>
      <section aria-labelledby="journey-steps">
        <h3 id="journey-steps" style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--font-size-small)' }}>
          {t('steps', { count: steps.length || recording.pageCount })}
        </h3>
        {steps.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
            {recording.entryPath === recording.exitPath ? recording.entryPath : t('entryExit', { entry: recording.entryPath, exit: recording.exitPath })}
          </p>
        ) : (
          <ol style={listStyle}>
            {steps.map((mark, index) => <MarkRow key={`${mark.atMs}-${index}`} mark={mark} onSeek={onSeek} />)}
          </ol>
        )}
      </section>
      <section aria-labelledby="journey-signals">
        <h3 id="journey-signals" style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--font-size-small)' }}>{t('signals')}</h3>
        {signals.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('noSignals')}</p>
        ) : (
          <ol style={listStyle}>
            {signals.map((mark, index) => <MarkRow key={`${mark.kind}-${mark.atMs}-${index}`} mark={mark} onSeek={onSeek} />)}
          </ol>
        )}
      </section>
    </div>
  );
}
