// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { useRightTabLabels } from '@/lib/useModalityCopy';
import type { RightTab } from '@/lib/modality';
import styles from './workspaceChrome.module.css';

/**
 * The workspace's side panel — Files, Versions, Publish and the rest — as a
 * panel you open and close rather than a column that is always taking width
 * from the preview.
 *
 * Closed, it stays MOUNTED (hidden): some panes do work while unseen — the
 * Versions pane records a version per agent turn — so closing must never
 * unmount them.
 */
export function WorkspaceRail({ tabs, active, open, fill = false, onSelect, onClose, children }: {
  tabs: readonly RightTab[];
  active: RightTab;
  open: boolean;
  /** Take the whole row (a narrow screen, where it replaces the workspace while open). */
  fill?: boolean;
  onSelect: (tab: RightTab) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useTranslations('ide');
  const tabLabel = useRightTabLabels();
  return (
    <aside
      aria-hidden={!open}
      style={{
        width: fill ? 'auto' : 'min(320px, 100%)', flex: fill ? 1 : '0 0 auto', minWidth: 0, borderLeft: '1px solid var(--border-subtle)', overflow: 'hidden',
        display: open ? 'flex' : 'none', flexDirection: 'column', background: 'var(--bg-surface)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        <div role="tablist" style={{ display: 'flex', flex: 1, minWidth: 0, overflowX: 'auto' }}>
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={active === tab}
              onClick={() => onSelect(tab)}
              style={{
                padding: '8px 10px', fontSize: 'var(--font-size-small)', fontWeight: 600, whiteSpace: 'nowrap',
                background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-display)',
                color: active === tab ? 'var(--text-primary)' : 'var(--text-muted)',
                borderBottom: `2px solid ${active === tab ? 'var(--accent)' : 'transparent'}`,
              }}
            >
              {tabLabel(tab)}
            </button>
          ))}
        </div>
        <button type="button" className={styles.iconButton} onClick={onClose} aria-label={t('workspace.closePanel')} title={t('workspace.closePanel')}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>{children}</div>
    </aside>
  );
}
