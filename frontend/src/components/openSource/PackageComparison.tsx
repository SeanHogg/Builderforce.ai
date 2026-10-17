import { getTranslations } from 'next-intl/server';
import { ComparisonMatrix } from '@/components/marketing/CompetitorMatrix';
import type { OpenSourcePackage } from '@/lib/openSourcePackages';

/** One row of `openSource.packages.<key>.comparison.rows`. */
export interface ComparisonRow {
  aspect: string;
  ours: string;
  theirs: string;
}

/**
 * The open package against the closed alternative it replaces, for the rows
 * whose registry entry sets `hasComparison`. Rendered by THE comparison table
 * the `/compare` pages use (`ComparisonMatrix`), so it scrolls inside its own
 * wrapper on a narrow screen and reads the same as every other matrix.
 */
export default async function PackageComparison({ entry }: { entry: OpenSourcePackage }) {
  if (!entry.hasComparison) return null;
  const t = await getTranslations('openSource');
  const base = `packages.${entry.key}.comparison`;
  const rows = (t.raw(`${base}.rows`) as ComparisonRow[] | undefined) ?? [];
  if (rows.length === 0) return null;

  return (
    <ComparisonMatrix
      headingId="os-compare"
      heading={t(`${base}.title`)}
      note={t(`${base}.intro`)}
      featureHeader={t('detail.aspect')}
      us={{ key: 'ours', label: t(`${base}.ours`) }}
      columns={[{ key: 'theirs', label: t(`${base}.theirs`) }]}
      categories={[{
        id: entry.key,
        title: '',
        blurb: '',
        rows: rows.map((row) => ({ feature: row.aspect, values: { ours: row.ours, theirs: row.theirs } })),
      }]}
      footnote={t(`${base}.note`)}
    />
  );
}
