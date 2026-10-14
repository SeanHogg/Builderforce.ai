/**
 * The live "≈ N recordings match" count under a rule being typed — a funnel
 * step in `FunnelEditor` or a smart event in `SmartEventEditor`. Debounced, and
 * a superseded answer is dropped; a rule the API rejects reads as `invalid`
 * rather than a fault.
 */

import { useEffect, useState } from 'react';
import { replayApi } from '@/lib/replayApi';
import type { SmartEventDraft } from './funnelLevel';

export const PREVIEW_DEBOUNCE_MS = 400;

export interface SmartEventPreview {
  count: number | null;
  loading: boolean;
  invalid: boolean;
}

export function useSmartEventPreview(siteId: string, days: number, rule: SmartEventDraft | null): SmartEventPreview {
  const [state, setState] = useState<SmartEventPreview>({ count: null, loading: false, invalid: false });
  const ruleKind = rule?.ruleKind ?? null;
  const match = rule?.match.trim() ?? '';
  const matchMode = rule?.matchMode ?? null;

  useEffect(() => {
    if (!ruleKind || !matchMode || !match) {
      setState({ count: null, loading: false, invalid: false });
      return undefined;
    }
    let cancelled = false;
    setState((current) => ({ ...current, loading: true }));
    const timer = setTimeout(() => {
      replayApi.previewSmartEvent(siteId, { ruleKind, match, matchMode }, { days }).then(
        (answer) => { if (!cancelled) setState({ count: answer.count, loading: false, invalid: false }); },
        (error: unknown) => {
          void error;
          if (!cancelled) setState({ count: null, loading: false, invalid: true });
        },
      );
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [siteId, days, ruleKind, match, matchMode]);

  return state;
}
