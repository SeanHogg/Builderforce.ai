'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { investorApi, type CompanySummary } from '@/lib/investorApi';
import styles from './DiscoveryTab.module.css';

/**
 * Business — the tenant's own companies, once an idea graduates out of Read →
 * Prove → Build. Reuses the existing companies list query (`investorApi`); no
 * new schema. Portfolio (investor) rows are excluded — this tab is "your own
 * business", not "what you've invested in".
 */
export function BusinessTab() {
  const t = useTranslations('dashboard');
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    investorApi.companies.list()
      .then((rows) => { if (alive) setCompanies(rows.filter((c) => !c.isPortfolio)); })
      .catch(() => { if (alive) setCompanies([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) return <p className={styles.empty}>{t('loading')}</p>;

  if (companies.length === 0) {
    return <p className={styles.empty}>{t('business.empty')}</p>;
  }

  return (
    <ul className={styles.list}>
      {companies.map((company) => (
        <li key={company.id} className={styles.card}>
          <div className={styles.cardHead}>
            <strong>{company.name}</strong>
            {company.stage && <span className={styles.badge}>{company.stage}</span>}
            <Link href={`/investor?company=${company.id}`} className={styles.ghostButton}>{t('business.view')}</Link>
          </div>
          <p className={styles.cardBody}>
            {t('business.summary', {
              projects: company.projectCount,
              arr: company.arr ?? '—',
            })}
          </p>
        </li>
      ))}
    </ul>
  );
}
