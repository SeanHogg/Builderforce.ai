// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { sendWorkspaceCommand } from '@/lib/workspace/workspaceCommands';

const COPIED_MS = 2000;

/**
 * A Studio project's header actions. Publish and GitHub open the workspace's own
 * panels (through the workspace command channel) rather than second copies of
 * them; Share copies the project link.
 *
 * There is no Upgrade here. The Brain composer directly below already carries the
 * plan chip ("Free · Upgrade"), so a second upgrade button in the bar put the same
 * call to action on screen twice, a few hundred pixels apart.
 */
export function StudioProjectActions({ projectId }: { projectId: number }) {
  const t = useTranslations('studio.project');
  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => sendWorkspaceCommand(projectId, { type: 'openSettings' })}>
        {t('github')}
      </Button>
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
