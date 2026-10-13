/**
 * "Summarize" one recording (PRD 33 §2.1 "AI summary of one recording — cited,
 * deep-linked"; D13). The summary is grounded in the recording's timeline:
 * every sentence ends `#<ord>` of a mark, and each citation renders as a
 * button that seeks the player to that moment. The daily AI budget answers
 * 429 ("daily limit reached"); a model that wrote no cited sentence answers
 * 503 ("no grounded summary") — both shown in place, never as a fault.
 */

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplaySummaryDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { REPLAY_SUMMARY_LIMIT_STATUS, REPLAY_SUMMARY_UNCITED_STATUS } from '@/lib/replayAnalysisApi';
import { ApiRequestError } from '@/lib/apiClient';
import { useErrorText } from '@/i18n/useErrorMessage';
import { Icon } from '@/components/ui/Icon';
import { fmtClock } from './replayMarks';

export interface ReplaySummaryProps {
  siteId: string;
  recordingId: string;
  /** Seek the player (ms into the recording). */
  onSeek: (ms: number) => void;
}

type SummaryState =
  | { status: 'idle' | 'loading' }
  | { status: 'done'; summary: ReplaySummaryDto }
  | { status: 'limit' | 'uncited' }
  | { status: 'error'; message: string };

/** The in-place answer for an AI summary failure, by HTTP status (data, shared with `SegmentSummary`). */
export const SUMMARY_FAILURES: Readonly<Record<number, 'limit' | 'uncited'>> = {
  [REPLAY_SUMMARY_LIMIT_STATUS]: 'limit',
  [REPLAY_SUMMARY_UNCITED_STATUS]: 'uncited',
};

export function summaryFailure(error: unknown): 'limit' | 'uncited' | null {
  return error instanceof ApiRequestError ? SUMMARY_FAILURES[error.status] ?? null : null;
}

const CITATION = /#(\d+)/g;

/** The summary text with every `#ord` that names a citation turned into a seek button. */
function renderCited(summary: ReplaySummaryDto, onSeek: (ms: number) => void, aria: (time: string) => string): ReactNode[] {
  const atByOrd = new Map(summary.citations.map((citation) => [citation.ord, citation.atMs]));
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of summary.summary.matchAll(CITATION)) {
    const index = match.index ?? 0;
    const atMs = atByOrd.get(Number(match[1]));
    if (atMs == null) continue;
    if (index > last) parts.push(summary.summary.slice(last, index));
    const time = fmtClock(atMs);
    parts.push(
      <button
        key={`cite-${index}`}
        type="button"
        className="btn-ghost"
        aria-label={aria(time)}
        onClick={() => onSeek(atMs)}
        style={{ display: 'inline-flex', minHeight: 44, minWidth: 44, padding: '0 var(--space-1)', fontVariantNumeric: 'tabular-nums', color: 'var(--accent)' }}
      >
        {time}
      </button>,
    );
    last = index + match[0].length;
  }
  if (last < summary.summary.length) parts.push(summary.summary.slice(last));
  return parts;
}

export function ReplaySummary({ siteId, recordingId, onSeek }: ReplaySummaryProps) {
  const t = useTranslations('replay.summary');
  const errorText = useErrorText();
  const [state, setState] = useState<SummaryState>({ status: 'idle' });

  const run = async (regenerate: boolean) => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'done', summary: await replayApi.summarizeRecording(siteId, recordingId, { regenerate }) });
    } catch (error) {
      const failure = summaryFailure(error);
      setState(failure ? { status: failure } : { status: 'error', message: errorText(error) });
    }
  };

  return (
    <section aria-labelledby={`replay-summary-${recordingId}`} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <h3 id={`replay-summary-${recordingId}`} style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-primary)' }}>{t('title')}</h3>
        <button
          type="button"
          className="btn-secondary"
          disabled={state.status === 'loading'}
          onClick={() => void run(state.status === 'done')}
          style={{ minHeight: 44 }}
        >
          <Icon name="sparkles" size={14} /> {state.status === 'done' ? t('regenerate') : t('summarize')}
        </button>
      </div>
      {state.status === 'loading' && <p role="status" style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('loading')}</p>}
      {state.status === 'limit' && <p role="status" style={{ margin: 0, color: 'var(--warning)' }}>{t('limit')}</p>}
      {state.status === 'uncited' && <p role="status" style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('uncited')}</p>}
      {state.status === 'error' && <p role="alert" style={{ margin: 0, color: 'var(--error)' }}>{t('error')} {state.message}</p>}
      {state.status === 'done' && (
        <p style={{ margin: 0, lineHeight: 1.6, overflowWrap: 'anywhere' }}>
          {renderCited(state.summary, onSeek, (time) => t('citeAria', { time }))}
        </p>
      )}
    </section>
  );
}
