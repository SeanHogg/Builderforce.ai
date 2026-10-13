/**
 * "Summarize this segment" (PRD 33 §2.1 "AI summary of … a segment — cited,
 * deep-linked"): the patterns across a sample of the filtered recordings, each
 * with example moments that open the `recording` kind at that second. Shown
 * above a list only when a filter is applied, and only on request (it spends
 * the daily AI budget; 429 / 503 read in place as in `ReplaySummary`).
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayFilter, ReplaySegmentSummaryDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useErrorText } from '@/i18n/useErrorMessage';
import { Icon } from '@/components/ui/Icon';
import { fmtClock } from './replayMarks';
import { summaryFailure } from './ReplaySummary';

export interface SegmentSummaryProps {
  siteId: string;
  days: number;
  filter: ReplayFilter;
  /** Open a recording at a moment (seconds). */
  onOpenRecording: (recordingId: string, seconds: number) => void;
}

type State =
  | { status: 'idle' | 'loading' | 'limit' | 'uncited' }
  | { status: 'done'; summary: ReplaySegmentSummaryDto }
  | { status: 'error'; message: string };

export function SegmentSummary({ siteId, days, filter, onOpenRecording }: SegmentSummaryProps) {
  const t = useTranslations('replay.summary');
  const errorText = useErrorText();
  const [state, setState] = useState<State>({ status: 'idle' });
  if (filter.all.length === 0) return null;

  const run = async () => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'done', summary: await replayApi.summarizeSegment(siteId, { days, filter }) });
    } catch (error) {
      const failure = summaryFailure(error);
      setState(failure ? { status: failure } : { status: 'error', message: errorText(error) });
    }
  };

  return (
    <section
      aria-label={t('segmentTitle')}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface-card)', minWidth: 0 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 'var(--font-size-small)' }}>{t('segmentTitle')}</strong>
        <button type="button" className="btn-secondary" disabled={state.status === 'loading'} onClick={() => void run()} style={{ minHeight: 44 }}>
          <Icon name="sparkles" size={14} /> {state.status === 'done' ? t('regenerate') : t('summarizeSegment')}
        </button>
      </div>
      {state.status === 'loading' && <p role="status" style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('loading')}</p>}
      {state.status === 'limit' && <p role="status" style={{ margin: 0, color: 'var(--warning)' }}>{t('limit')}</p>}
      {state.status === 'uncited' && <p role="status" style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('uncited')}</p>}
      {state.status === 'error' && <p role="alert" style={{ margin: 0, color: 'var(--error)' }}>{t('error')} {state.message}</p>}
      {state.status === 'done' && (
        <>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('sampled', { count: state.summary.sampled })}</p>
          <ul style={{ margin: 0, paddingLeft: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {state.summary.patterns.map((pattern, index) => (
              <li key={index} style={{ overflowWrap: 'anywhere' }}>
                <span>{pattern.text}</span>
                <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 'var(--space-1)', marginLeft: 'var(--space-1)' }}>
                  {pattern.examples.map((example) => {
                    const time = fmtClock(example.atMs);
                    return (
                      <button
                        key={`${example.recordingId}:${example.atMs}`}
                        type="button"
                        className="btn-ghost"
                        aria-label={t('exampleAria', { time })}
                        onClick={() => onOpenRecording(example.recordingId, Math.floor(example.atMs / 1000))}
                        style={{ minHeight: 44, minWidth: 44, padding: '0 var(--space-1)', color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}
                      >
                        <Icon name="play" size={12} /> {time}
                      </button>
                    );
                  })}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
