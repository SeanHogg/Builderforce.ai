'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import { fetchSpawnPrices, type SpawnPrices } from '@/lib/spawn/spawnApi';
import { SPAWN_ACCOUNT_ROUTE } from '@/lib/spawn/spawnLinks';
import { SpawnPackGrid } from './SpawnPackGrid';
import styles from './spawn.module.css';

/** The landing page's prices — read from the API, so the page and the checkout charge the same numbers. */
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
      <div className={styles.sectionHead}>
        <p className={styles.eyebrow}>{t('eyebrow')}</p>
        <h2 id="pricing-title" className={styles.h2}>{t('title')}</h2>
        <p className={styles.lede}>{t('lede')}</p>
      </div>
      {failed && <p className={styles.error} role="alert">{t('loadFailed')}</p>}
      {prices && (
        <>
          <article className={styles.plan}>
            <p className={styles.eyebrow}>{t('planName')}</p>
            <p className={styles.price}>
              {fmt.money(prices.monthlyCents / 100, 'USD')} <span className={styles.priceUnit}>{t('perMonth')}</span>
            </p>
            <p className={styles.cardBody}>{t('planBody', { age: prices.minAge })}</p>
            <div className={styles.ctaRow}>
              <Link href={SPAWN_ACCOUNT_ROUTE} className={styles.cta}>{t('join')}</Link>
            </div>
          </article>
          <h3 className={styles.cardTitle}>{t('packsTitle')}</h3>
          <p className={styles.fine}>{t('packsLede')}</p>
          <SpawnPackGrid packs={prices.packs} />
        </>
      )}
    </section>
  );
}
