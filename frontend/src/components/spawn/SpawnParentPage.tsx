'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import { SpawnPackGrid } from './SpawnPackGrid';
import { useSpawnParent } from './useSpawnParent';
import styles from './spawn.module.css';

interface Point { icon: string; label: string }

/**
 * `/spawn/parent?t=…` — where a trial email sends the player's grown-up. No sign-in:
 * the link is the credential. It says whose Spawn this is and where their trial
 * stands, what Spawn is in three tiles, and offers the one thing to do next — join
 * for the player, or (once joined) top up their tokens.
 */
export function SpawnParentPage() {
  const t = useTranslations('spawn.parent');
  const tErrors = useTranslations('spawn.account.errors');
  const fmt = useFormat();
  const token = useSearchParams().get('t');
  const { view, errorKey, notice, busy, join, buy } = useSpawnParent(token);
  const points = t.raw('points') as Point[];

  if (!view) {
    return (
      <main className={styles.account}>
        <h1 className={styles.h2}>{t('title')}</h1>
        {errorKey ? <p className={styles.error} role="alert">{tErrors(errorKey)}</p> : <p className={styles.fine}>{t('loading')}</p>}
      </main>
    );
  }

  const price = fmt.money(view.monthlyCents / 100, 'USD');
  const active = view.membership === 'active';
  const status = view.membership === 'trial' ? t('status.trial', { count: view.trialDaysLeft ?? 0 })
    : active ? t('status.active')
      : view.membership === 'trial_ended' ? t('status.trialEnded')
        : t('status.other');

  return (
    <main className={styles.account}>
      <div className={styles.sectionHead}>
        <span className={styles.badge}>{t('badge')}</span>
        <h1 className={styles.h2}>{t('heading', { player: view.player })}</h1>
        <p className={styles.heroLede}>{status}</p>
      </div>

      {notice && <p className={styles.notice} role="status">{t(`notice.${notice}`)}</p>}
      {errorKey && <p className={styles.error} role="alert">{tErrors(errorKey)}</p>}

      <ul className={styles.tiles}>
        {points.map((point) => (
          <li key={point.label} className={styles.tile}>
            <span className={styles.tileIcon} aria-hidden>{point.icon}</span>
            <span className={styles.tileLabel}>{point.label}</span>
          </li>
        ))}
      </ul>

      {active ? (
        <section className={styles.panel} aria-labelledby="spawn-parent-tokens">
          <h2 id="spawn-parent-tokens" className={styles.cardTitle}>{t('tokensTitle')}</h2>
          <p className={styles.balance}>{fmt.number(view.balance)}</p>
          <p className={styles.fine}>{t('tokensBody')}</p>
          <SpawnPackGrid packs={view.packs} onBuy={buy} busyPackId={busy} />
        </section>
      ) : (
        <section className={styles.ctaBand} aria-labelledby="spawn-parent-join">
          <h2 id="spawn-parent-join" className={styles.h2}>{t('joinTitle', { player: view.player })}</h2>
          <button type="button" className={styles.ctaBig} onClick={join} disabled={busy === 'join'}>
            {busy === 'join' ? t('opening') : t('join', { price })}
          </button>
          <p className={styles.fine}>{t('joinFine')}</p>
        </section>
      )}
    </main>
  );
}
