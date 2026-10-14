import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, ButtonLink } from '@/components/ui';
import { useAuth } from '@/lib/AuthContext';
import { workspaceChoiceHref } from '@/lib/auth';
import { creationListingApi } from '@/lib/creationListings';
import { invalidateCapabilityState } from '@/lib/capabilityApi';
import { useErrorMessage } from '@/i18n/useErrorMessage';
import type { SetupStepProps } from './setupSteps';
import styles from './capability.module.css';

/**
 * Step 1 — the workspace, then the install. Choosing or creating a workspace is
 * the existing picker (`/tenants?next=`), which comes back here; installing is
 * the marketplace's one free-acquire call, whose licence IS the entitlement.
 */
export function WorkspaceStep({ app, onDone }: SetupStepProps) {
  const t = useTranslations('marketplace.capability.workspace');
  const tApps = useTranslations('apps');
  const errorMessage = useErrorMessage();
  const { tenant, hasTenant } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = tApps(`${app.nameKey}.name` as never);
  const chooseHref = workspaceChoiceHref({ next: app.setupPath, intent: app.intent });

  if (!hasTenant || !tenant) {
    return (
      <div className={styles.stack}>
        <p className={styles.body}>{t('choose', { app: name })}</p>
        <ButtonLink href={chooseHref} variant="primary">{t('chooseAction')}</ButtonLink>
      </div>
    );
  }

  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      await creationListingApi.acquire(app.listingSlug);
      invalidateCapabilityState();
      onDone();
    } catch (cause) {
      setError(errorMessage(cause) ?? t('failed'));
      setBusy(false);
    }
  };

  return (
    <div className={styles.stack}>
      <p className={styles.body}>{t('installInto', { app: name, workspace: tenant.name })}</p>
      <div className={styles.row}>
        <Button variant="primary" onClick={() => void install()} disabled={busy} loading={busy} data-testid="setup-install">
          {busy ? t('installing') : t('install', { app: name })}
        </Button>
        <ButtonLink href={chooseHref} variant="ghost">{t('another')}</ButtonLink>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}
