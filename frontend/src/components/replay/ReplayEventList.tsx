/**
 * Every mark of the recording as a list: the accessible, 44 px twin of the
 * timeline markers. A row seeks the player; the row at or just before the
 * playhead is marked current. With `onDefineEvent`, a click mark (its key is
 * the element's selector) offers "Define from this click" — the smart-event
 * editor opens prefilled with a click rule on that selector.
 */

import { useTranslations } from 'next-intl';
import type { ReplayMark } from '@builderforce/interaction-contract';
import { Icon } from '@/components/ui/Icon';
import { fmtClock, markStyle } from './replayMarks';

export interface ReplayEventListProps {
  marks: readonly ReplayMark[];
  currentMs: number;
  onSeek: (ms: number) => void;
  onDefineEvent?: (selector: string) => void;
}

/** Marks whose key is a clicked element's selector (`chunk.ts`), so a rule can be defined from them. */
export const DEFINABLE_MARK_KINDS: ReadonlySet<string> = new Set(['click', 'rage', 'dead']);

export function ReplayEventList({ marks, currentMs, onSeek, onDefineEvent }: ReplayEventListProps) {
  const t = useTranslations('replay.player');
  const tEvents = useTranslations('replay.smartEvents');
  if (marks.length === 0) {
    return <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('eventsEmpty')}</p>;
  }
  let current = -1;
  for (let index = 0; index < marks.length; index += 1) {
    if (marks[index]!.atMs <= currentMs) current = index;
  }

  return (
    <ol aria-label={t('events')} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {marks.map((mark, index) => {
        const style = markStyle(mark.kind);
        const kindLabel = t(style.labelKey);
        return (
          <li key={`${mark.kind}-${mark.atMs}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <button
              type="button"
              aria-current={index === current ? 'true' : undefined}
              aria-label={t('markerAria', { time: fmtClock(mark.atMs), label: mark.label ?? kindLabel })}
              onClick={() => onSeek(mark.atMs)}
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: 44,
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: '0 var(--space-2)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                background: index === current ? 'var(--surface)' : 'transparent',
                color: 'var(--text-primary)',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)', minWidth: 44 }}>
                {fmtClock(mark.atMs)}
              </span>
              <span style={{ color: style.tone, display: 'inline-flex' }}><Icon name={style.icon} size={14} /></span>
              <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{kindLabel}</span>
              {mark.label && (
                <span style={{ fontSize: 'var(--font-size-small)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                  {mark.label}
                </span>
              )}
            </button>
            {onDefineEvent && DEFINABLE_MARK_KINDS.has(mark.kind) && mark.key && (
              <button
                type="button"
                className="btn-ghost"
                aria-label={tEvents('defineFromClickAria', { label: mark.label ?? mark.key })}
                title={tEvents('defineFromClick')}
                onClick={() => onDefineEvent(mark.key)}
                style={{ minHeight: 44, minWidth: 44, flexShrink: 0 }}
              >
                <Icon name="flag" size={14} />
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
