// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import type { SpawnAccount } from '@/lib/spawn/spawnApi';
import { SpawnPackGrid } from './SpawnPackGrid';
import styles from './spawn.module.css';

/** The wallet: what is left, the packs to top it up, and what the tokens went on. */
export function SpawnTokensPanel({ account, busyPackId, onBuy }: {
  account: Pick<SpawnAccount, 'balance' | 'packs' | 'activity' | 'membership'>;
  busyPackId: string | null;
  onBuy: (packId: string) => void;
}) {
  const t = useTranslations('spawn.account.tokens');
  const fmt = useFormat();
  const member = account.membership === 'active';
  return (
    <section className={styles.panel} aria-labelledby="spawn-tokens-title">
      <h2 id="spawn-tokens-title" className={styles.cardTitle}>{t('title')}</h2>
      <p className={styles.balance}>{fmt.number(account.balance)}</p>
      <p className={styles.fine}>{t('balanceLabel')}</p>
      {member ? (
        <SpawnPackGrid packs={account.packs} onBuy={onBuy} busyPackId={busyPackId} />
      ) : (
        <p className={styles.cardBody}>{t('joinFirst')}</p>
      )}
      <p className={styles.fine}>{t('noChargeOnFail')}</p>
      {account.activity.length > 0 && (
        <>
          <h3 className={styles.cardTitle}>{t('activity')}</h3>
          <ul className={styles.activity}>
            {account.activity.map((row) => (
              <li key={row.id}>
                <span>{t(`kind.${row.kind === 'grant' ? 'grant' : 'spend'}`)}</span>
                <span className={row.amount > 0 ? styles.plus : undefined}>
                  {row.amount > 0 ? '+' : ''}{fmt.number(row.amount)} · {fmt.date(row.occurredAt)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
