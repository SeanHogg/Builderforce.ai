import { getTranslations } from 'next-intl/server';
import { BRAND } from '@/lib/content/brand';
import { COMPARE_ARENAS, DEFAULT_COMPARE_ARENA } from '@/lib/content/compare';

/**
 * THE comparison matrix — `compare.arenas.<arena>.categories` as a table.
 *
 * The data was already there and already translated: eight capability
 * categories, forty feature rows, a cell per vendor, in all five catalogs. Both
 * `/compare` and `/compare/[competitor]` read it with `t.raw('compare.categories')`,
 * declared the row type, and then rendered only `title` and `blurb` — so the
 * comparison page's actual comparison was dead data on every locale, and the
 * `capabilityHeader` key existed for a column header no table had.
 *
 * One component rather than a table on each page, because the views differ by
 * exactly two things — which ARENA's categories, and which columns show:
 *
 *   - `/compare` renders one matrix per arena tab, every vendor in it.
 *   - `/compare/{slug}` shows Builderforce.ai against that one vendor, in that
 *     vendor's own arena, which is the whole reason a reader followed a "vs"
 *     link instead of the index.
 *
 * `COMPARE_ARENAS` (content.ts) supplies the stable column KEY and ORDER per
 * arena; the visible vendor name comes from `compare.competitorLabels.<key>` so
 * a locale can transliterate it. Builderforce.ai is always the first,
 * highlighted column and is never a catalog string — it is the brand, so it
 * stays literal.
 */
export interface CompareRow {
  feature: string;
  /** Optional qualifier shown under the feature name. */
  note?: string;
  /** Cell value per column key — `builderforce` plus every COMPETITORS key. */
  values: Record<string, string>;
}

export interface CompareCategory {
  id: string;
  title: string;
  blurb: string;
  rows: CompareRow[];
}

export interface ComparisonMatrixColumn {
  /** Key into each row's `values`. */
  key: string;
  /** Visible column header. */
  label: string;
}

/**
 * THE comparison table markup, data in — the presentational half of
 * `CompetitorMatrix`, exported so every "ours against theirs" surface renders
 * the one `.cm-*` table (globals.css) instead of hand-rolling its own. The
 * `/compare` pages feed it an arena's categories; `/open-source/<slug>` feeds it
 * a package against the closed runtime it replaces.
 *
 * Self-gating: no columns or no rows renders nothing rather than a table shell.
 * A category with an empty `title` renders no sub-heading (a single-table
 * comparison has nothing to subdivide); the caption falls back to `heading`.
 */
export function ComparisonMatrix({
  headingId,
  heading,
  note,
  hint,
  featureHeader,
  us,
  columns,
  categories,
  footnote,
}: {
  /** Unique per document — `/compare` renders one matrix per arena tab. */
  headingId: string;
  heading: string;
  note?: string;
  /** Narrow-screen scroll hint; shown only when there is more than one rival column. */
  hint?: string;
  /** Header of the row-label column. */
  featureHeader: string;
  /** The highlighted first value column — ours. */
  us: ComparisonMatrixColumn;
  columns: ComparisonMatrixColumn[];
  categories: CompareCategory[];
  /** Closing note under the table. */
  footnote?: string;
}) {
  const rowCount = categories.reduce((total, category) => total + (category.rows?.length ?? 0), 0);
  if (!columns.length || !rowCount) return null;

  return (
    <section className="cm" aria-labelledby={headingId}>
      {/* Chrome lives in globals.css (`.cm-*`). It used to be an inline <style>
          here, which was fine while one matrix rendered per page; `/compare`
          now renders one per arena tab, and React 18 does not dedupe a <style>
          element, so the same block would ship six times in one document. */}
      <h2 id={headingId} className="cm-heading">{heading}</h2>
      {note && <p className="cm-note">{note}</p>}
      {hint && columns.length > 1 && <p className="cm-hint">{hint}</p>}

      {categories.map((category) => (
        <div className="cm-cat" key={category.id}>
          {category.title && <h3 className="cm-cat-title">{category.title}</h3>}
          {category.blurb && <p className="cm-cat-blurb">{category.blurb}</p>}
          <div className="table-wrap" tabIndex={0}>
            <table className="data-table cm-table">
              <caption className="sr-only">{category.title || heading}</caption>
              <thead>
                <tr>
                  <th scope="col" className="cm-feature">{featureHeader}</th>
                  <th scope="col" className="cm-us">{us.label}</th>
                  {columns.map((column) => (
                    <th scope="col" key={column.key}>{column.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(category.rows ?? []).map((row) => (
                  <tr key={row.feature}>
                    <th scope="row" className="cm-feature">
                      <span className="cm-feature-name">{row.feature}</span>
                      {row.note && <span className="cm-feature-note">{row.note}</span>}
                    </th>
                    <td className="cm-us">{row.values[us.key]}</td>
                    {columns.map((column) => (
                      <td className="cm-cell" key={column.key}>{row.values[column.key]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {footnote && <p className="cm-note">{footnote}</p>}
    </section>
  );
}

export default async function CompetitorMatrix({
  arena = DEFAULT_COMPARE_ARENA,
  only,
}: {
  /** Arena key from `COMPARE_ARENAS`. Defaults to the first (AI coding agents). */
  arena?: string;
  /** Render Builderforce.ai against this one vendor column. */
  only?: string;
}) {
  const t = await getTranslations();
  const spec = COMPARE_ARENAS.find((a) => a.key === arena);
  const categories = (t.raw(`compare.arenas.${arena}.categories`) as CompareCategory[] | undefined) ?? [];
  // Self-gating: an unknown arena, a leaf page for a vendor with no column, or a
  // catalog without the block renders nothing rather than an empty table shell.
  const columns = (spec?.competitors ?? []).filter((column) => !only || column.key === only);
  if (!categories.length || !columns.length) return null;

  return (
    // The id carries the arena because `/compare` renders one matrix per arena
    // tab in a single document — a fixed id would repeat six times.
    <ComparisonMatrix
      headingId={`cm-heading-${arena}`}
      heading={t('compare.matrixHeading')}
      note={t('compare.matrixNote')}
      hint={t('compare.matrixScrollHint')}
      featureHeader={t('compare.capabilityHeader')}
      us={{ key: 'builderforce', label: BRAND.name }}
      columns={columns.map((column) => ({ key: column.key, label: t(`compare.competitorLabels.${column.key}`) }))}
      categories={categories}
    />
  );
}
