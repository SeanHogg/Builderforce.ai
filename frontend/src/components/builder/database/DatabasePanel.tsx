// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui';
import ProjectBackendPanel from '@/components/ProjectBackendPanel';
import { DatabaseTables } from './DatabaseTables';
import { DatabaseUsers } from './DatabaseUsers';
import { SiteRequired } from './SiteRequired';

type SectionId = 'tables' | 'users' | 'functions';

interface Section {
  id: SectionId;
  icon: string;
  render: (projectId: number) => ReactNode;
}

/**
 * What the app keeps and who uses it — the Database view beside Preview and
 * Code. A new section is a new entry here, not a new branch below.
 *
 * Tables and users belong to the published site, so they wait for one; server
 * functions and their secrets belong to the project and work before a publish.
 */
const SECTIONS: Section[] = [
  { id: 'tables', icon: '🗂️', render: (projectId) => <SiteRequired projectId={projectId}><DatabaseTables projectId={projectId} /></SiteRequired> },
  { id: 'users', icon: '👥', render: (projectId) => <SiteRequired projectId={projectId}><DatabaseUsers projectId={projectId} /></SiteRequired> },
  { id: 'functions', icon: '⚡', render: (projectId) => <ProjectBackendPanel projectId={projectId} /> },
];

export function DatabasePanel({ projectId }: { projectId: number }) {
  const t = useTranslations('builderDatabase');
  const [active, setActive] = useState<SectionId>('tables');
  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0]!;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg-base)' }}>
      <div role="tablist" aria-label={t('sectionsLabel')}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        {SECTIONS.map((s) => {
          const selected = s.id === active;
          return (
            <button key={s.id} type="button" role="tab" aria-selected={selected} onClick={() => setActive(s.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, minHeight: 32, padding: '4px 12px', cursor: 'pointer',
                borderRadius: 'var(--radius-sm)', border: 'none', fontWeight: 600, fontSize: 'var(--font-size-small)',
                background: selected ? 'var(--bg-elevated)' : 'transparent',
                color: selected ? 'var(--text-primary)' : 'var(--text-muted)',
              }}>
              <span aria-hidden><Icon source={s.icon} size="1em" /></span>
              {t(`sections.${s.id}`)}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 'clamp(8px, 2vw, 16px)' }}>
        {section.render(projectId)}
      </div>
    </div>
  );
}
