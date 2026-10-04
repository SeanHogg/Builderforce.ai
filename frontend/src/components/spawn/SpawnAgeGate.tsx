// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import styles from './spawn.module.css';

/**
 * "When were you born?" — month and year only, asked once (the server will not
 * take a second answer). Months are named in the reader's language by `Intl`.
 */
export function SpawnAgeGate({ minAge, busy, onConfirm }: {
  minAge: number;
  busy: boolean;
  onConfirm: (year: number, month: number) => void;
}) {
  const t = useTranslations('spawn.account.age');
  const fmt = useFormat();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');

  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: new Intl.DateTimeFormat(fmt.locale, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, i, 1))),
  })), [fmt.locale]);
  const years = useMemo(() => Array.from({ length: 90 }, (_, i) => String(thisYear - i)), [thisYear]);

  return (
    <section className={styles.panel} aria-labelledby="spawn-age-title">
      <h2 id="spawn-age-title" className={styles.cardTitle}>{t('title')}</h2>
      <p className={styles.cardBody}>{t('body', { age: minAge })}</p>
      <form
        className={styles.row}
        onSubmit={(event) => { event.preventDefault(); if (year && month) onConfirm(Number(year), Number(month)); }}
      >
        <label className={styles.row}>
          <span className={styles.fine}>{t('month')}</span>
          <select className={styles.select} value={month} onChange={(e) => setMonth(e.target.value)} required>
            <option value="" disabled>{t('choose')}</option>
            {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
        <label className={styles.row}>
          <span className={styles.fine}>{t('year')}</span>
          <select className={styles.select} value={year} onChange={(e) => setYear(e.target.value)} required>
            <option value="" disabled>{t('choose')}</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <button type="submit" className={styles.cta} disabled={busy || !year || !month}>{t('confirm')}</button>
      </form>
      <p className={styles.fine}>{t('why')}</p>
    </section>
  );
}
