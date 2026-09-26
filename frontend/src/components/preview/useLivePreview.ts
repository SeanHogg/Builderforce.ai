/**
 * Live-preview fetch + remount keys.
 *
 * `loadLivePreview` rethrows a plan-limit 402 so the panel can render
 * {@link UpgradeGate}; every other miss (no run, 404, 429) is "no preview".
 * Reload remounts the iframe without a new ticket. Restart mints a new ticket.
 */

import { useCallback, useEffect, useState } from 'react';
import { loadLivePreview, type LivePreviewLink } from '@/lib/api';
import { isPlanLimitError } from '@/lib/planLimitError';

export function isExpoPreviewUrl(url: string): boolean {
  return url.startsWith('exp://') || url.startsWith('exps://');
}

export function useLivePreview(opts: {
  projectId?: number | string;
  executionId?: number | null;
  enabled?: boolean;
}) {
  const { projectId, executionId, enabled = true } = opts;
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState<LivePreviewLink | null>(null);
  const [planError, setPlanError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    if (executionId == null && (projectId == null || projectId === '')) return;
    let cancelled = false;
    setLoading(true);
    setPlanError(null);
    loadLivePreview({ projectId, executionId })
      .then((next) => { if (!cancelled) setLink(next); })
      .catch((err) => {
        if (cancelled) return;
        if (isPlanLimitError(err)) {
          setPlanError(err);
          setLink(null);
        } else {
          setLink(null);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [enabled, projectId, executionId, generation]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const restart = useCallback(() => {
    setReloadKey((k) => k + 1);
    setGeneration((g) => g + 1);
  }, []);

  return { loading, link, planError, reloadKey, reload, restart };
}
