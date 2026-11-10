/**
 * The web's feed into the run delta's labels (PRD 41 §C11): next-intl's `t.raw` over the `runDelta` namespace, through
 * the view's ONE catalog walker — the card and panel words (`runDeltaLabels`) and the history and trend words
 * (`runDeltaHistoryLabels`, under `runDelta.history.*`). The VS Code webview reads the same catalogs through use-intl.
 */

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  runDeltaHistoryLabels, runDeltaLabels, type RunDeltaHistoryLabels, type RunDeltaLabels,
} from '@builderforce/knowledge-graph-view';

export interface WebRunDeltaLabels {
  labels: RunDeltaLabels;
  historyLabels: RunDeltaHistoryLabels;
}

export function useRunDeltaLabels(): WebRunDeltaLabels {
  const t = useTranslations('runDelta');
  return useMemo(() => {
    const raw = (key: string): unknown => {
      try {
        return t.raw(key);
      } catch {
        return undefined;
      }
    };
    return { labels: runDeltaLabels(raw), historyLabels: runDeltaHistoryLabels((key) => raw(`history.${key}`)) };
  }, [t]);
}
