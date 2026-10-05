'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import { fetchSpawnPrices, type SpawnPrices } from '@/lib/spawn/spawnApi';
import { SPAWN_ACCOUNT_ROUTE } from '@/lib/spawn/spawnLinks';
import { SpawnPackGrid } from './SpawnPackGrid';
import styles from './spawn.module.css';

/** The landing page's prices — the membership, then the packs, read from the API so the page and the checkout charge the same numbers. */
export function SpawnPricing() {
  const t = useTranslations('spawn.pricing');
  const fmt = useFormat();
  const [prices, setPrices] = useState<SpawnPrices | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchSpawnPrices().then(setPrices).catch(() => setFailed(true));
  }, []);

  return (
    <section id="pricing" className={styles.section} aria-labelledby="pricing-title">
      <h2 id="pricing-title" className={styles.h2}>{t('title')}</h2>
      {failed && <p className={styles.error} role="alert">{t('loadFailed')}</p>}
      {prices && (
        <>
          <div className={styles.plan}>
            <span className={styles.price}>
              {fmt.money(prices.monthlyCents / 100, 'USD')} <span className={styles.priceUnit}>{t('perMonth')}</span>
            </span>
            <span className={styles.planName}>{t('planName')}</span>
            <Link href={SPAWN_ACCOUNT_ROUTE} className={styles.cta}>{t('join')}</Link>
          </div>
          <SpawnPackGrid packs={prices.packs} />
        </>
      )}
    </section>
  );
}
