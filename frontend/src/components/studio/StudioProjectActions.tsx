// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { AnchoredPopover } from '@/components/ui/AnchoredPopover';
import { Icon } from '@/components/ui/Icon';
import styles from '@/components/builder/workspaceChrome.module.css';
import { sendWorkspaceCommand } from '@/lib/workspace/workspaceCommands';

const COPIED_MS = 2000;

/**
 * A Studio project's header actions, at the end of the workspace's header row.
 * Publish opens the workspace's own Publish panel (through the workspace command
 * channel) rather than a second copy of it, and its ▾ the repository and deploy
 * settings; Share copies the project link.
 *
 * GitHub is not a button of its own: it is the workspace's settings, reached from
 * Publish ▾ (where a person looks for "where does this go") and the ⋯ menu.
 */
export function StudioProjectActions({ projectId }: { projectId: number }) {
  const t = useTranslations('studio.project');
  return (
    <>
      <ShareButton />
      <PublishButton projectId={projectId} />
    </>
  );
}

/**
 * Publish, and beside it (▾) where a project goes besides its site: the
 * repository and deploy settings. Both open the workspace's own panels.
 */
function PublishButton({ projectId }: { projectId: number }) {
  const t = useTranslations('studio.project');
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const run = (command: Parameters<typeof sendWorkspaceCommand>[1]) => { setOpen(false); sendWorkspaceCommand(projectId, command); };

  return (
    <div className={styles.splitButton}>
      <Button type="button" variant="primary" size="sm" onClick={() => run({ type: 'openTab', tab: 'publish' })}>
        {t('publish')}
      </Button>
      <Button
        ref={anchorRef}
        type="button"
        variant="primary"
        size="sm"
        onClick={() => setOpen((was) => !was)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('publishOptions')}
        title={t('publishOptions')}
      >
        <Icon name="chevron-down" size={14} />
      </Button>
      <AnchoredPopover open={open} anchorRef={anchorRef} onDismiss={() => setOpen(false)} placement="below" align="end">
        <div role="menu" aria-label={t('publishOptions')} className={styles.menu}>
          <button type="button" role="menuitem" className={styles.menuItem} onClick={() => run({ type: 'openTab', tab: 'publish' })}>
            <Icon name="arrow-up-right" size={16} />
            {t('publishSite')}
          </button>
          <button type="button" role="menuitem" className={styles.menuItem} onClick={() => run({ type: 'openSettings' })}>
            <Icon name="branch" size={16} />
            {t('repoAndDeploy')}
          </button>
        </div>
      </AnchoredPopover>
    </div>
  );
}

function ShareButton() {
  const t = useTranslations('studio.project');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const share = () => {
    navigator.clipboard?.writeText(window.location.href).then(() => setCopied(true), () => setCopied(false));
  };

  return (
    <Button type="button" variant="secondary" size="sm" onClick={share} aria-live="polite">
      {copied ? t('linkCopied') : t('share')}
    </Button>
  );
}
