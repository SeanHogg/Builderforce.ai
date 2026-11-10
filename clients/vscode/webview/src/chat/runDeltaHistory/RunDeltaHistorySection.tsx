/**
 * The run delta panel's HISTORY and TREND in the editor (PRD 41 §C11.3): the repository's past runs on this device, as the
 * ONE `RunDeltaHistory` view the web renders too. A container: it asks the host (`run-delta/history { repo }`) and passes
 * the rows in; the words come from the web's `runDelta.history.*` catalog, which ships with the card's `runDelta`
 * namespace, and times and numbers are written in the reader's locale (use-intl's formatter). It sits under the open
 * `RunDeltaPanel` (through the panel's `renderPanel` slot, `footerPanel`), so it re-reads whenever the panel opens on
 * another repository.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'use-intl';
import type { RunDeltaSummary } from '@builderforce/run-delta';
import type { RunDeltaLabels } from '@builderforce/knowledge-graph-view/delta';
import { RunDeltaHistory, runDeltaHistoryLabels } from '@builderforce/knowledge-graph-view/delta/history';
import { request } from '../../vscodeBridge';
import { HISTORY_LIMIT, RUN_DELTA_HISTORY, historyFromAnswer } from './runDeltaHistory';

export interface RunDeltaHistorySectionProps {
  /** The repository as the open card names it (`RunDeltaCardPayload.repo`). */
  repo: string;
  labels: RunDeltaLabels;
}

export function RunDeltaHistorySection({ repo, labels }: RunDeltaHistorySectionProps) {
  // A LITERAL namespace, as in `useRunDeltaLabels.ts`: the catalog trimmer ships what it can see.
  const t = useTranslations('runDelta');
  const format = useFormatter();
  const historyLabels = useMemo(() => runDeltaHistoryLabels((key) => {
    try {
      return t.raw(`history.${key}`);
    } catch {
      return undefined;
    }
  }), [t]);
  const formatTime = useCallback((iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }), [format]);
  const formatNumber = useCallback((value: number) => format.number(value, { maximumFractionDigits: 2 }), [format]);
  const [items, setItems] = useState<RunDeltaSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(false);
    request<unknown>(RUN_DELTA_HISTORY, { repo, limit: HISTORY_LIMIT }).then(
      (answer) => { if (live) { setItems(historyFromAnswer(answer)); setLoading(false); } },
      () => { if (live) { setError(true); setLoading(false); } },
    );
    return () => { live = false; };
  }, [repo, attempt]);

  return (
    <RunDeltaHistory
      items={items}
      labels={labels}
      historyLabels={historyLabels}
      formatTime={formatTime}
      formatNumber={formatNumber}
      loading={loading}
      error={error}
      onRetry={retry}
      bare
    />
  );
}
