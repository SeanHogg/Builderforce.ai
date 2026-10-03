'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, ButtonLink } from '@/components/ui';
import { useConsumption } from '@/lib/useConsumption';
import { sendWorkspaceCommand } from '@/lib/workspace/workspaceCommands';

const COPIED_MS = 2000;

/**
 * A Studio project's header actions. Publish and GitHub open the workspace's own
 * panels (through the workspace command channel) rather than second copies of
 * them; Share copies the project link; Upgrade shows only on the free plan.
 */
export function StudioProjectActions({ projectId }: { projectId: number }) {
  const t = useTranslations('studio.project');
  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => sendWorkspaceCommand(projectId, { type: 'openSettings' })}>
        {t('github')}
      </Button>
      <ShareButton />
      <UpgradeLink />
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

/** The upgrade prompt is a plan fact, not an entitlement: it shows on the free plan only. */
function UpgradeLink() {
  const t = useTranslations('studio.project');
  const plan = useConsumption()?.plan.effective;
  if (plan !== 'free') return null;
  return (
    <ButtonLink href="/pricing" variant="secondary" size="sm">{t('upgrade')}</ButtonLink>
  );
}
