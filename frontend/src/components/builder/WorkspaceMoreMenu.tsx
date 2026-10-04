// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AnchoredPopover } from '@/components/ui/AnchoredPopover';
import { Icon } from '@/components/ui/Icon';
import { useRightTabLabels } from '@/lib/useModalityCopy';
import type { RightTab } from '@/lib/modality';
import styles from './workspaceChrome.module.css';

/**
 * The workspace's overflow: every side panel the project type offers, the
 * project's details, and its settings (source control, GitHub, deploy). These
 * used to be a cog, a Details button, a GitHub button in a second bar and a
 * permanent tab strip — four places for things opened now and then.
 */
export function WorkspaceMoreMenu({ tabs, onOpenTab, onOpenSettings, onOpenDetails }: {
  tabs: readonly RightTab[];
  onOpenTab: (tab: RightTab) => void;
  onOpenSettings: () => void;
  onOpenDetails?: () => void;
}) {
  const t = useTranslations('ide');
  const tabLabel = useRightTabLabels();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const choose = (action: () => void) => () => { setOpen(false); action(); };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={styles.iconButton}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('workspace.more')}
        title={t('workspace.more')}
      >
        <Icon name="more-horizontal" size={18} />
      </button>
      <AnchoredPopover open={open} anchorRef={anchorRef} onDismiss={() => setOpen(false)} placement="below" align="end">
        <div role="menu" aria-label={t('workspace.more')} className={styles.menu}>
          <div className={styles.menuGroup}>{t('workspace.panels')}</div>
          {tabs.map((tab) => (
            <button key={tab} type="button" role="menuitem" className={styles.menuItem} onClick={choose(() => onOpenTab(tab))}>
              {tabLabel(tab)}
            </button>
          ))}
          <div className={styles.menuSep} />
          {onOpenDetails && (
            <button type="button" role="menuitem" className={styles.menuItem} onClick={choose(onOpenDetails)}>
              <Icon name="project" size={16} />
              {t('projectDetailsTitle')}
            </button>
          )}
          <button type="button" role="menuitem" className={styles.menuItem} onClick={choose(onOpenSettings)}>
            <Icon name="settings" size={16} />
            {t('settingsRepoTitle')}
          </button>
        </div>
      </AnchoredPopover>
    </>
  );
}
