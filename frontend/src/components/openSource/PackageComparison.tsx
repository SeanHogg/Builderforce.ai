import { getTranslations } from 'next-intl/server';
import type { OpenSourcePackage } from '@/lib/openSourcePackages';
import styles from './openSource.module.css';

/** One row of `openSource.packages.<key>.comparison.rows`. */
export interface ComparisonRow {
  aspect: string;
  ours: string;
  theirs: string;
}

/**
 * The open package against the closed alternative it replaces, for the rows
 * whose registry entry sets `hasComparison`. The table scrolls inside its own
 * wrapper on a narrow screen rather than widening the page.
 */
export default async function PackageComparison({ entry }: { entry: OpenSourcePackage }) {
  if (!entry.hasComparison) return null;
  const t = await getTranslations('openSource');
  const base = `packages.${entry.key}.comparison`;
  const rows = (t.raw(`${base}.rows`) as ComparisonRow[] | undefined) ?? [];
  if (rows.length === 0) return null;

  return (
    <section className={styles.band} aria-labelledby="os-compare">
      <h2 id="os-compare" className={styles.sectionTitle}>{t(`${base}.title`)}</h2>
      <p className={styles.body}>{t(`${base}.intro`)}</p>
      <div className={styles.tableWrap} tabIndex={0}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t('detail.aspect')}</th>
              <th scope="col">{t(`${base}.ours`)}</th>
              <th scope="col">{t(`${base}.theirs`)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.aspect}>
                <th scope="row">{row.aspect}</th>
                <td>{row.ours}</td>
                <td>{row.theirs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.note}>{t(`${base}.note`)}</p>
    </section>
  );
}
