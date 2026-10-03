// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button, EmptyState, SectionError, SectionLoading } from '@/components/ui';
import { fetchSite } from '@/lib/api';
import { subscribeSitePublished } from '@/lib/sitePublishEvents';
import { sendWorkspaceCommand } from '@/lib/workspace/workspaceCommands';

type SiteState = { kind: 'loading' } | { kind: 'none' } | { kind: 'live' } | { kind: 'failed'; error: unknown };

/**
 * Renders `children` once the project has a site, which is what owns its
 * tables and sign-ins. Until then it says so and offers the Publish panel —
 * and it notices the publish, so the view fills in without a reload.
 */
export function SiteRequired({ projectId, children }: { projectId: number; children: ReactNode }) {
  const t = useTranslations('builderDatabase.needsSite');
  const [state, setState] = useState<SiteState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      fetchSite(projectId)
        .then((site) => { if (!cancelled) setState({ kind: site ? 'live' : 'none' }); })
        .catch((error: unknown) => { if (!cancelled) setState({ kind: 'failed', error }); });
    };
    check();
    const unsubscribe = subscribeSitePublished((published) => { if (published === projectId) check(); });
    return () => { cancelled = true; unsubscribe(); };
  }, [projectId]);

  if (state.kind === 'loading') return <SectionLoading label={t('checking')} />;
  if (state.kind === 'failed') return <SectionError error={state.error} />;
  if (state.kind === 'live') return <>{children}</>;
  return (
    <EmptyState
      icon="🗄️"
      title={t('title')}
      description={t('body')}
      actions={(
        <Button type="button" variant="primary" onClick={() => sendWorkspaceCommand(projectId, { type: 'openTab', tab: 'publish' })}>
          {t('action')}
        </Button>
      )}
    />
  );
}
