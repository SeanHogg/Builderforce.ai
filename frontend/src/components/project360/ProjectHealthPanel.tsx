'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Project360View,
  DEFAULT_PROJECT360_LABELS,
  type Project360,
  type Project360Action,
  type Project360Labels,
} from '@seanhogg/builderforce-brain-ui';
import '@seanhogg/builderforce-brain-ui/styles.css';
import { getProject360 } from '@/lib/project360Api';

/**
 * Web Project 360 — the SAME shared <Project360View> the VS Code panel renders,
 * fed by the SAME `/api/projects/:id/360` rollup, themed by the app's `--bf-*`
 * bridge (globals.css) so it flips light/dark automatically. This is the "reuse the
 * component across surfaces" payoff: one presentational component, two hosts.
 *
 * On the web the improve/workforce actions route into the project workspace (where
 * the Brain + board live) rather than firing a VS Code command; the one-click
 * agent-seed parity is a follow-up (needs an IDE seed deep-link — see ROADMAP).
 */
export function ProjectHealthPanel({ projectId }: { projectId: number }) {
  const t = useTranslations('project360');
  const router = useRouter();
  const [data, setData] = useState<Project360 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Map the next-intl namespace onto the component's label contract (defaults for
  // any key not yet translated, so it never renders a raw key).
  const labels = useMemo<Partial<Project360Labels>>(() => {
    const out: Partial<Project360Labels> = {};
    for (const key of Object.keys(DEFAULT_PROJECT360_LABELS) as (keyof Project360Labels)[]) {
      const v = t.has(key) ? t(key) : undefined;
      if (typeof v === 'string') out[key] = v;
    }
    return out;
  }, [t]);

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    setError(null);
    try {
      setData(await getProject360(projectId, { fresh }));
    } catch (e) {
      setError((e as Error).message || 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const onAction = useCallback((action: Project360Action) => {
    // Every action lands the user in the project workspace, where the Brain and
    // board can act on it. (VS Code fires the command inline; the web routes there.)
    void action;
    router.push(`/ide/${projectId}`);
  }, [router, projectId]);

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
