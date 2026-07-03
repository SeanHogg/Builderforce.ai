import { useCallback, useEffect, useState } from 'react';
import {
  Project360View,
  DEFAULT_PROJECT360_LABELS,
  type Project360,
  type Project360Action,
  type Project360Labels,
} from '@seanhogg/builderforce-brain-ui';
import { getToken, onIntent, post, refreshToken, type InitData, type LabelBundle } from './vscodeBridge';

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

  const load = useCallback(async () => {
    if (projectId == null) {
      setError('No project is selected.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const call = (token: string | null) =>
      fetch(`${init.baseUrl}/api/projects/${projectId}/360`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
    try {
      let res = await call(getToken());
      if (res.status === 401) {
        await refreshToken();
        res = await call(getToken());
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as Project360);
    } catch (e) {
      setError((e as Error).message || 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [projectId, init.baseUrl]);

  useEffect(() => { void load(); }, [load]);

  // The host re-pushes a `revalidate` intent when the panel regains focus (a run may
  // have started, work may have moved) so "who's working" stays live without polling.
  useEffect(() => onIntent((intent) => { if (intent.kind === 'revalidate') void load(); }), [load]);

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
      onRefresh={() => void load()}
    />
  );
}
