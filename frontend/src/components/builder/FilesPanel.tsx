// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ProjectSearchPanel } from './ProjectSearchPanel';

type View = 'files' | 'search';

/**
 * The workspace's file side: the explorer (passed in, so its file operations stay
 * the workspace's) and project-wide search, behind a Files | Search switch.
 */
export function FilesPanel({ projectId, onOpenFile, explorer }: { projectId: number; onOpenFile: (path: string) => void; explorer: ReactNode }) {
  const t = useTranslations('builderSearch');
  const [view, setView] = useState<View>('files');
  const tabs: Array<{ id: View; label: string }> = [
    { id: 'files', label: t('filesTab') },
    { id: 'search', label: t('searchTab') },
  ];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div role="tablist" aria-label={t('panelLabel')} style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={view === tab.id}
            onClick={() => setView(tab.id)}
            style={{
              flex: 1, minHeight: 34, border: 0, background: 'none', cursor: 'pointer',
              color: view === tab.id ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: `2px solid ${view === tab.id ? 'var(--accent)' : 'transparent'}`,
              fontSize: 'var(--font-size-small)', fontWeight: 600,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {/* The explorer stays mounted so its expanded folders survive a trip to Search. */}
        <div style={{ position: 'absolute', inset: 0, display: view === 'files' ? 'block' : 'none' }}>{explorer}</div>
        {view === 'search' && <ProjectSearchPanel projectId={projectId} onOpenFile={onOpenFile} />}
      </div>
    </div>
  );
}
