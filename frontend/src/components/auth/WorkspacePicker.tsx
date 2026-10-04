// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import type { StudioWorkspaceState } from './useStudioWorkspace';
import type { Tenant } from '@/lib/types';

/**
 * What Studio shows while the visitor has a session but no workspace in it:
 * nothing while loading, a choice when there are several, a way to make one when
 * there are none. Renders null in every other state.
 */
export function StudioWorkspacePicker({ state, onChoose }: { state: StudioWorkspaceState; onChoose: (tenant: Tenant) => void }) {
  const t = useTranslations('studio.workspace');
  if (state.status !== 'choose' && state.status !== 'none' && state.status !== 'failed') return null;

  return (
    <section
      aria-labelledby="studio-workspace-title"
      style={{ display: 'grid', gap: 12, padding: 20, borderRadius: 'var(--radius-xl)', border: '1px solid var(--border-subtle)', background: 'var(--surface-card, var(--bg-elevated))' }}
    >
      <h2 id="studio-workspace-title" className="ui-text-card-title" style={{ margin: 0 }}>{t('title')}</h2>
      {state.status === 'choose' && (
        <>
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('lead')}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {state.workspaces.map((workspace) => (
              <Button key={workspace.id} type="button" onClick={() => onChoose(workspace)}>{workspace.name}</Button>
            ))}
          </div>
        </>
      )}
      {state.status === 'none' && (
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
          {t('none')} <Link href="/tenants" style={{ color: 'var(--accent)' }}>{t('create')}</Link>
        </p>
      )}
      {state.status === 'failed' && <p role="alert" style={{ margin: 0, color: 'var(--error-text)' }}>{t('loadFailed')}</p>}
    </section>
  );
}
