/**
 * The `plan` panel kind (PRD 33 D4, §4.2 step 7): this month's recordings
 * against the free allowance and the prepaid credits, the packs on sale, and
 * where the receipts are. Opened from the app header's usage chip
 * (`?panel=plan:usage`) and by the processor's return (`?panel=plan:packs&checkout=…`).
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayUsageDto } from '@builderforce/interaction-contract';
import { ButtonLink, SectionError, SectionLoading } from '@/components/ui';
import { PackList } from '@/components/marketplace/capability/PackList';
import { replaySitesApi } from '@/lib/replaySitesApi';
import { invalidateCapabilityState } from '@/lib/capabilityApi';
import { CAPABILITY_APPS } from '@/lib/marketplace/capabilityApps';
import type { InsightPanelKindProps } from '../panelKinds';
import styles from '@/components/marketplace/capability/capability.module.css';

/** Where the workspace's payments and receipts already live. */
export const RECEIPTS_HREF = '/billing';

export function PlanKind({ id, tab }: InsightPanelKindProps) {
  const t = useTranslations('insights.plan');
  const [usage, setUsage] = useState<ReplayUsageDto | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [returned] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('checkout'));

  useEffect(() => {
    // Back from the processor: the credit lands by webhook, so read fresh numbers.
    if (returned) invalidateCapabilityState();
    let live = true;
    replaySitesApi.usage()
      .then((next) => { if (live) setUsage(next); })
      .catch((cause: unknown) => { if (live) setError(cause); });
    return () => { live = false; };
  }, [returned]);

  const focus = tab ?? id;
  const number = (n: number) => n.toLocaleString();
  const share = usage && usage.limit > 0 ? Math.min(1, usage.used / usage.limit) : 0;

  return (
    <div className={styles.stack} data-testid="plan-kind">
      {returned && <p className={styles.body} role="status">{t('checkoutReturned')}</p>}
      {error ? <SectionError error={error} /> : !usage ? <SectionLoading label={t('loading')} /> : (
        <section className={styles.stack} aria-label={t('usageTitle')}>
          <h3 className={styles.title}>{t('usageTitle')}</h3>
          <p className={styles.body} data-testid="plan-usage">
            {t('usedOfLimit', { used: number(usage.used), limit: number(usage.limit), period: usage.period })}
          </p>
          <div
            className={styles.meter}
            role="meter"
            aria-valuemin={0}
            aria-valuemax={usage.limit}
            aria-valuenow={usage.used}
            aria-label={t('usageTitle')}
          >
            <div className={styles.meterFill} style={{ width: `${Math.round(share * 100)}%` }} />
          </div>
          <ul className={styles.list}>
            <li className={styles.listItem}>
              <span>{t('free')}</span>
              <span className={styles.listMeta}>{t('freeUsed', { used: number(usage.freeUsed), allowance: number(usage.freeAllowance) })}</span>
            </li>
            <li className={styles.listItem}>
              <span>{t('credits')}</span>
              <span className={styles.listMeta} data-testid="plan-credits">{number(usage.credits)}</span>
            </li>
          </ul>
        </section>
      )}
      <section className={styles.stack} aria-label={t('packsTitle')} data-focus={focus === 'packs' ? 'true' : undefined}>
        <h3 className={styles.title}>{t('packsTitle')}</h3>
        <PackList appPath={CAPABILITY_APPS.insights.homePath} />
      </section>
      <ButtonLink href={RECEIPTS_HREF} variant="ghost">{t('receipts')}</ButtonLink>
    </div>
  );
}
