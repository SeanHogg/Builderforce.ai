/**
 * What the heatmaps capability actually needs (PRD 33 §4.2): an Insights
 * site. The toggle alone records nothing — replay and heatmaps boot only from
 * the install tag's `data-site` — so the card says which state the workspace
 * is in and links to the one place that changes it.
 */

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CAPABILITY_APPS } from '@/lib/marketplace/capabilityApps';
import styles from './EmbeddedCapabilities.module.css';

export function InsightsSiteNote({ siteKey }: { siteKey: string | null }) {
  const t = useTranslations('embedded.insights');
  const app = CAPABILITY_APPS.insights;
  return (
    <p className={styles.replaces} data-testid="insights-site-note">
      {siteKey ? t('siteReady') : t('needsSite')}{' '}
      <Link href={siteKey ? app.homePath : app.setupPath}>{siteKey ? t('open') : t('setup')}</Link>
    </p>
  );
}
