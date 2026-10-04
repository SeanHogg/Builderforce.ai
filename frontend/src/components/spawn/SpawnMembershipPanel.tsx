// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import type { SpawnMembershipStatus } from '@/lib/spawn/spawnApi';
import styles from './spawn.module.css';

/** The membership: its state, and — unless it is active — the way to (re)join. */
export function SpawnMembershipPanel({ status, monthlyCents, busy, onJoin }: {
  status: SpawnMembershipStatus;
  monthlyCents: number;
  busy: boolean;
  onJoin: () => void;
}) {
  const t = useTranslations('spawn.account.membership');
  const fmt = useFormat();
  const price = fmt.money(monthlyCents / 100, 'USD');
  const active = status === 'active';
  return (
    <section className={styles.panel} aria-labelledby="spawn-membership-title">
      <div className={styles.row} style={{ justifyContent: 'space-between' }}>
        <h2 id="spawn-membership-title" className={styles.cardTitle}>{t('title')}</h2>
        <span className={active ? styles.statusOk : styles.statusWarn}>{t(`status.${status}`)}</span>
      </div>
      <p className={styles.cardBody}>{active ? t('activeBody', { price }) : t(`body.${status}`, { price })}</p>
      {!active && (
        <div className={styles.ctaRow}>
          <button type="button" className={styles.cta} onClick={onJoin} disabled={busy}>
            {busy ? t('opening') : t('join', { price })}
          </button>
        </div>
      )}
      <p className={styles.fine}>{t('parentNote')}</p>
    </section>
  );
}
