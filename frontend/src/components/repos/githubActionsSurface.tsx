'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { reposApi, type GithubActionsStatus } from '@/lib/builderforceApi';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';

/**
 * The GitHub Actions execution surface, as the UI sees it.
 *
 * Two very different screens need the same fact — "does this project's repo carry
 * the Builderforce agent workflow?" — and used to have no way to ask:
 *
 *   • Source control settings, to offer "Enable GitHub agent runs" (previously an
 *     API-only POST an operator had to curl by hand), and
 *   • the cloud-agent surface picker, where `GitHub Actions` was selectable for a
 *     project that could not run it. Dispatch then silently degraded to the
 *     durable executor and explained itself in the run timeline — after the fact.
 *
 * One hook, one endpoint, one definition of "enabled", so the settings panel and
 * the picker can never tell a user two different stories.
 */

export interface GithubActionsReadiness {
  status: GithubActionsStatus | null;
  loading: boolean;
  /** Re-read after enabling (the server invalidates its cache on that write, so
   *  this reflects the change immediately rather than after a TTL). */
  refresh: () => void;
}

/**
 * Read the surface's readiness for a project. Defaults to the globally-scoped
 * project so callers that live in shared chrome (the agent form, which is opened
 * from several places) need no plumbing; pass `projectId` where the screen already
 * knows one.
 *
 * Degrades to `status: null` — never throws and never blocks a form — when there
 * is no project in scope or the read fails. "Unknown" must not be rendered as
 * "broken": the surface picker stays usable and only warns on a POSITIVE "not
 * enabled" answer.
 */
export function useGithubActionsReadiness(projectId?: number | null): GithubActionsReadiness {
  const scope = useOptionalProjectScope();
  const effectiveProjectId = projectId ?? scope?.currentProjectId ?? null;
  const [status, setStatus] = useState<GithubActionsStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (effectiveProjectId == null) { setStatus(null); return; }
    setLoading(true);
    let cancelled = false;
    reposApi.githubActionsStatus(effectiveProjectId)
      .then((s) => { if (!cancelled) setStatus(s); })
      .catch(() => { if (!cancelled) setStatus(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [effectiveProjectId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { status, loading, refresh };
}

/**
 * The warning shown under the cloud-agent surface picker when `GitHub Actions` is
 * chosen for a project whose repo cannot run it.
 *
 * Self-gating on purpose: it resolves its own readiness rather than taking a
 * `canUseActions` boolean, so no caller can render it with a stale or
 * hand-computed answer, and adding it to a new surface picker is one line. The
 * only prop is the picker's CURRENT selection — form state the component cannot
 * know, not an entitlement it could compute.
 *
 * Renders nothing unless the answer is a POSITIVE "not enabled": no project in
 * scope, a failed read, or a still-loading read all stay silent rather than
 * warning about something we did not actually verify.
 */
export function GithubActionsSurfaceNotice({ surface }: { surface: string }) {
  const t = useTranslations('githubActionsSurface');
  const { status } = useGithubActionsReadiness();

  if (surface !== 'github_actions') return null;
  if (!status || status.ready) return null;

  const hasRepo = status.repositories.some((r) => r.supported);

  return (
    <div
      role="status"
      style={{
        marginTop: 8, padding: '10px 12px', borderRadius: 8,
        border: '1px solid var(--warning-border, var(--border))',
        background: 'var(--warning-bg, var(--bg-elevated))',
        color: 'var(--text-strong)', fontSize: 12, lineHeight: 1.5,
      }}
    >
      <strong style={{ display: 'block', marginBottom: 4 }}>{t('notReadyTitle')}</strong>
      {hasRepo ? t('notReadyBody') : t('noGithubRepoBody')}
    </div>
  );
}
