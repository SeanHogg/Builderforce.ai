// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { sendWorkspaceCommand } from '@/lib/workspace/workspaceCommands';

const COPIED_MS = 2000;

/**
 * A Studio project's header actions, at the end of the workspace's header row.
 * Publish opens the workspace's own Publish panel (through the workspace command
 * channel) rather than a second copy of it; Share copies the project link.
 *
 * GitHub is not here: it is the workspace's settings, one entry in its ⋯ menu,
 * and a second button for it put the same panel behind two controls.
 */
export function StudioProjectActions({ projectId }: { projectId: number }) {
  const t = useTranslations('studio.project');
  return (
    <>
      <ShareButton />
      <Button type="button" variant="primary" size="sm" onClick={() => sendWorkspaceCommand(projectId, { type: 'openTab', tab: 'publish' })}>
        {t('publish')}
      </Button>
    </>
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
