'use client';

import { useTranslations } from 'next-intl';
import { ButtonLink, SectionLoading } from '@/components/ui';
import { useRequireSession } from '@/lib/useRequireSession';
import { useCapability } from '@/lib/useCapability';
import { capabilityAppFor, capabilityListingHref } from '@/lib/marketplace/capabilityApps';
import { CAPABILITY_APP_COMPONENTS } from './capabilityAppComponents';
import styles from './capability.module.css';

/**
 * `/apps/<id>`: a capability app, decided by the workspace's entitlement — never
 * by a branch per app (PRD 33 §4.2 step 8).
 *
 *   not entitled (or signed out) → the listing, where it is installed
 *   entitled, no site yet        → the set-up flow
 *   otherwise                    → the app (`CAPABILITY_APP_COMPONENTS`)
 */
export function CapabilityAppView({ appId }: { appId: string }) {
  const t = useTranslations('apps');
  const app = capabilityAppFor(appId);
  const session = useRequireSession();
  const { state, entitled } = useCapability(app?.listingSlug ?? '');

  if (!app) return null;
  const name = t(`${app.nameKey}.name` as never);

  if (session === 'loading') return <SectionLoading label={t('loading')} />;
  if (session !== 'anonymous' && entitled === null) return <SectionLoading label={t('loading')} />;

  if (session === 'anonymous' || entitled === false) {
    return (
      <div className={styles.page}>
        <div className={styles.card} data-testid="capability-app-not-entitled">
          <h1 className={styles.title}>{name}</h1>
          <p className={styles.body}>{t('notEntitled', { app: name })}</p>
          <ButtonLink href={capabilityListingHref(app)} variant="primary">{t('getIt', { app: name })}</ButtonLink>
        </div>
      </div>
    );
  }

  if ((state?.siteCount ?? 0) === 0) {
    return (
      <div className={styles.page}>
        <div className={styles.card} data-testid="capability-app-setup">
          <h1 className={styles.title}>{name}</h1>
          <p className={styles.body}>{t('needsSetup', { app: name })}</p>
          <ButtonLink href={app.setupPath} variant="primary">{t('setUp')}</ButtonLink>
        </div>
      </div>
    );
  }

  const App = CAPABILITY_APP_COMPONENTS[app.id];
  return (
    <div className={styles.page} data-testid="capability-app">
      <App />
    </div>
  );
}
