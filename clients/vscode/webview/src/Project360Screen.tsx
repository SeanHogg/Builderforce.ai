import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Project360View,
  DEFAULT_PROJECT360_LABELS,
  type Project360,
  type Project360Action,
  type Project360Labels,
} from '@seanhogg/builderforce-brain-ui';
import { getToken, onIntent, post, refreshToken, type InitData, type LabelBundle } from './vscodeBridge';
import { authedFetch } from './authedFetch';

/**
 * The Project 360 screen — the thin transport wrapper around the shared
 * <Project360View>, exactly as <App>'s Chat wraps <BrainTimeline>. It fetches the
 * whole-picture rollup (`GET /api/projects/:id/360`) directly over HTTPS with the
 * host-minted tenant token (re-minting once on a 401), then hands the model to the
 * reusable presentational view. Every action the view raises (open board, ask the
 * Brain, run/open a task, review approvals) is forwarded to the privileged host,
 * which owns those commands.
 */

/** Overlay the host's localized label bundle onto the component defaults. */
function labelsFrom(bundle: LabelBundle): Partial<Project360Labels> {
  const out: Partial<Project360Labels> = {};
  for (const key of Object.keys(DEFAULT_PROJECT360_LABELS) as (keyof Project360Labels)[]) {
    const v = bundle[`p360.${key}`];
    if (typeof v === 'string') out[key] = v;
  }
  return out;
}

export function Project360Screen({ init }: { init: InitData }) {
  const projectId = init.project?.id;
  const [data, setData] = useState<Project360 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const labels = labelsFrom(init.labels);
  // Shared bearer-fetch: attaches the host-minted token and, on a 401, re-mints via
  // `refreshToken` and retries once (the promise-returning refresher opts into a retry).
  const api = useMemo(() => authedFetch(init.baseUrl, getToken, refreshToken), [init.baseUrl]);

  const load = useCallback(async (fresh = false) => {
    if (projectId == null) {
      setError('No project is selected.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    // `fresh=1` bypasses the endpoint's short-TTL cache — used for an explicit refresh
    // or a focus revalidate, so "who's working" is guaranteed live on demand.
    const path = `/api/projects/${projectId}/360${fresh ? '?fresh=1' : ''}`;
    try {
      setData(await api<Project360>(path));
    } catch (e) {
      setError((e as Error).message || 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [projectId, api]);

  useEffect(() => { void load(); }, [load]);

  // The host re-pushes a `revalidate` intent when the panel regains focus (a run may
  // have started, work may have moved) so "who's working" stays live without polling.
  useEffect(() => onIntent((intent) => { if (intent.kind === 'revalidate') void load(true); }), [load]);

  const onAction = useCallback((action: Project360Action) => {
    // The host maps each kind to the command it already owns (openBoard / humanRequests
    // / Brain seed / runTask / startTaskSession) — the panel never executes commands itself.
    post('p360.action', { action: action as unknown as Record<string, unknown> });
  }, []);

  return (
    <Project360View
      data={data}
      loading={loading}
      error={error}
      labels={labels}
      onAction={onAction}
      onRefresh={() => void load(true)}
    />
  );
}
