/**
 * The scrubber: a real `<input type="range">` (keyboard and screen-reader
 * operable by construction) with the recording's signal marks laid over it as
 * buttons. Each marker seeks to its moment and is named "time · label".
 */

import { useTranslations } from 'next-intl';
import type { ReplayMark } from '@builderforce/interaction-contract';
import { Icon } from '@/components/ui/Icon';
import { TIMELINE_MARK_KINDS, fmtClock, markStyle } from './replayMarks';

export interface ReplayTimelineProps {
  currentMs: number;
  totalMs: number;
  marks: readonly ReplayMark[];
  onSeek: (ms: number) => void;
}

export function ReplayTimeline({ currentMs, totalMs, marks, onSeek }: ReplayTimelineProps) {
  const t = useTranslations('replay.player');
  const span = Math.max(totalMs, 1);
  const shown = marks.filter((mark) => TIMELINE_MARK_KINDS.has(mark.kind) && mark.atMs <= span);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', minWidth: 0 }}>
      <div style={{ position: 'relative', height: 22 }} aria-label={t('markersAria')} role="group">
        {shown.map((mark, index) => {
          const style = markStyle(mark.kind);
          const label = mark.label ?? t(style.labelKey);
          return (
            <button
              key={`${mark.kind}-${mark.atMs}-${index}`}
              type="button"
              aria-label={t('markerAria', { time: fmtClock(mark.atMs), label })}
              title={`${fmtClock(mark.atMs)} · ${label}`}
              onClick={() => onSeek(mark.atMs)}
              style={{
                position: 'absolute',
                left: `${(mark.atMs / span) * 100}%`,
                transform: 'translateX(-50%)',
                top: 0,
                width: 22,
                height: 22,
                padding: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                borderRadius: 'var(--radius-full)',
                background: 'var(--surface-card)',
                color: style.tone,
                cursor: 'pointer',
              }}
            >
              <Icon name={style.icon} size={14} />
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <input
          type="range"
          min={0}
          max={span}
          step={100}
          value={Math.min(currentMs, span)}
          aria-label={t('scrubber')}
          aria-valuetext={`${fmtClock(currentMs)} / ${fmtClock(totalMs)}`}
          onChange={(event) => onSeek(Number(event.currentTarget.value))}
          style={{ flex: 1, minWidth: 0, accentColor: 'var(--accent)', minHeight: 44 }}
        />
        <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
          {fmtClock(currentMs)} / {fmtClock(totalMs)}
        </span>
      </div>
    </div>
  );
}
