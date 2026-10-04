// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import type { SpawnPack } from '@/lib/spawn/spawnApi';
import { SPAWN_ACCOUNT_ROUTE } from '@/lib/spawn/spawnLinks';
import styles from './spawn.module.css';

/**
 * The four token packs. With `onBuy` each card buys its pack (the account page);
 * without it each card links to the account page, where buying happens (the
 * landing page) — one grid, so the two pages can never show different packs.
 */
export function SpawnPackGrid({ packs, onBuy, busyPackId }: {
  packs: SpawnPack[];
  onBuy?: (packId: string) => void;
  busyPackId?: string | null;
}) {
  const t = useTranslations('spawn.pricing');
  const fmt = useFormat();
  return (
    <div className={styles.grid}>
      {packs.map((pack) => (
        <article key={pack.id} className={styles.pack}>
          <p className={styles.packPrice}>{fmt.money(pack.cents / 100, 'USD')}</p>
          <p className={styles.packTokens}>{t('tokens', { count: fmt.number(pack.tokens) })}</p>
          <p className={styles.cardBody}>{t('builds', { count: fmt.number(pack.estimatedBuilds) })}</p>
          {onBuy ? (
            <button type="button" className={styles.packButton} onClick={() => onBuy(pack.id)} disabled={busyPackId === pack.id}>
              {busyPackId === pack.id ? t('opening') : t('buy')}
            </button>
          ) : (
            <Link href={SPAWN_ACCOUNT_ROUTE} className={styles.packButton}>{t('buy')}</Link>
          )}
        </article>
      ))}
    </div>
  );
}
