// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import type { SpawnTrialView } from '@/lib/spawn/spawnApi';
import styles from './spawn.module.css';

/**
 * The free week. Offered (with the grown-up's email it needs) while the player may
 * still start one; a countdown while it runs; nothing otherwise — it decides its
 * own visibility from the trial the account carries.
 */
export function SpawnTrialPanel({ trial, busy, onStart }: {
  trial: SpawnTrialView;
  busy: boolean;
  onStart: (parentEmail: string) => void;
}) {
  const t = useTranslations('spawn.account.trial');
  const fmt = useFormat();
  const [email, setEmail] = useState('');

  if (trial.live) {
    return (
      <section className={styles.trialLive} aria-labelledby="spawn-trial-title">
        <h2 id="spawn-trial-title" className={styles.cardTitle}>{t('liveTitle', { count: trial.daysLeft ?? 0 })}</h2>
        <p className={styles.cardBody}>{t('liveBody', { email: trial.parentEmail ?? '' })}</p>
      </section>
    );
  }
  if (!trial.available) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onStart(email);
  };
  return (
    <section className={styles.trialOffer} aria-labelledby="spawn-trial-title">
      <span className={styles.badge}>{t('badge')}</span>
      <h2 id="spawn-trial-title" className={styles.h2}>{t('title', { days: trial.days })}</h2>
      <p className={styles.cardBody}>
        {t('body', { tokens: fmt.number(trial.tokens), builds: fmt.number(trial.builds) })}
      </p>
      <form className={styles.trialForm} onSubmit={submit}>
        <label className={styles.fieldLabel} htmlFor="spawn-parent-email">{t('emailLabel')}</label>
        <input
          id="spawn-parent-email"
          type="email"
          required
          autoComplete="off"
          inputMode="email"
          className={styles.input}
          placeholder={t('emailPlaceholder')}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button type="submit" className={styles.ctaBig} disabled={busy}>{busy ? t('starting') : t('start')}</button>
      </form>
      <p className={styles.fine}>{t('why')}</p>
    </section>
  );
}
