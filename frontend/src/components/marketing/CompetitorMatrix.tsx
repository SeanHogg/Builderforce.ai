import { getTranslations } from 'next-intl/server';
import { BRAND, COMPETITORS } from '@/lib/content';

/**
 * THE comparison matrix — `compare.categories` rendered as a table.
 *
 * The data was already there and already translated: eight capability
 * categories, forty feature rows, a cell per vendor, in all five catalogs. Both
 * `/compare` and `/compare/[competitor]` read it with `t.raw('compare.categories')`,
 * declared the row type, and then rendered only `title` and `blurb` — so the
 * comparison page's actual comparison was dead data on every locale, and the
 * `capabilityHeader` key existed for a column header no table had.
 *
 * One component rather than a table on each page, because the two views differ
 * by exactly one thing — which columns show:
 *
 *   - `/compare` shows every vendor.
 *   - `/compare/{slug}` shows Builderforce.ai against that one vendor, which is
 *     the whole reason a reader followed a "vs" link instead of the index.
 *
 * `COMPETITORS` (content.ts) supplies the stable column KEY and ORDER; the
 * visible vendor name comes from `compare.competitorLabels.<key>` so a locale
 * can transliterate it. Builderforce.ai is always the first, highlighted column
 * and is never a catalog string — it is the brand, so it stays literal.
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

export default async function CompetitorMatrix({ only }: { only?: string }) {
  const t = await getTranslations();
  const categories = (t.raw('compare.categories') as CompareCategory[] | undefined) ?? [];
  // Self-gating: a leaf page for a vendor with no column, or a catalog without
  // the categories block, renders nothing rather than an empty table shell.
  const columns = COMPETITORS.filter((column) => !only || column.key === only);
  if (!categories.length || !columns.length) return null;

  const rowCount = categories.reduce((total, category) => total + (category.rows?.length ?? 0), 0);
  if (!rowCount) return null;

  return (
    <section className="cm" aria-labelledby="cm-heading">
      <style>{`
        .cm { max-width: var(--marketing-max); margin: 0 auto; padding: 8px var(--marketing-gutter) 16px; width: 100%; }
        .cm-heading {
          font-family: var(--font-display); font-weight: 700; font-size: var(--font-size-section);
          color: var(--text-primary); margin: 24px 0 10px;
        }
        .cm-note { font-size: var(--font-size-small); color: var(--text-muted); line-height: 1.6; margin: 0 0 8px; max-width: 72ch; }
        /* Only worth saying when the table is actually wider than the screen.
           A media query rather than a measurement, because this renders on the
           server and a hint that appears after hydration is a layout shift. */
        .cm-hint { font-size: var(--font-size-small); color: var(--text-muted); margin: 0 0 20px; }
        @media (min-width: 1200px) { .cm-hint { display: none; } }

        .cm-cat { margin-bottom: 28px; }
        .cm-cat-title {
          font-family: var(--font-display); font-weight: 600; font-size: var(--font-size-card-title);
          color: var(--text-primary); margin: 0 0 4px;
        }
        .cm-cat-blurb { font-size: var(--font-size-small); color: var(--text-secondary); line-height: 1.6; margin: 0 0 12px; max-width: 72ch; }

        /* .table-wrap / .data-table are the shared table chrome (globals.css);
           it already scrolls on x, which is what a matrix this wide needs on a
           phone. Everything below is the comparison-specific part only. */
        .cm-table { min-width: 560px; }
        .cm-table th, .cm-table td { vertical-align: top; font-size: var(--font-size-small); }
        .cm-table thead th {
          font-family: var(--font-display); font-weight: 650; color: var(--text-primary);
          white-space: nowrap;
        }
        /* The feature column stays put while the vendor columns scroll under it,
           so a cell is never orphaned from the capability it answers. It needs an
           opaque background of its own — a sticky cell paints over the row it
           left behind, and --bg-elevated/--bg-muted are the solid pair. */
        .cm-feature { position: sticky; left: 0; z-index: 1; background: var(--bg-elevated); min-width: 190px; }
        .cm-table thead .cm-feature { background: var(--bg-muted); }
        .cm-feature-name { font-weight: 600; color: var(--text-primary); }
        .cm-feature-note { display: block; margin-top: 3px; font-size: var(--font-size-eyebrow); color: var(--text-muted); line-height: 1.5; }
        .cm-cell { color: var(--text-secondary); min-width: 116px; }
        .cm-us { background: var(--surface-sunken); color: var(--text-primary); font-weight: 600; }
        .cm-table thead .cm-us { color: var(--coral-bright); }
      `}</style>

      <h2 id="cm-heading" className="cm-heading">{t('compare.matrixHeading')}</h2>
      <p className="cm-note">{t('compare.matrixNote')}</p>
      {columns.length > 1 && <p className="cm-hint">{t('compare.matrixScrollHint')}</p>}

      {categories.map((category) => (
        <div className="cm-cat" key={category.id}>
          <h3 className="cm-cat-title">{category.title}</h3>
          <p className="cm-cat-blurb">{category.blurb}</p>
          <div className="table-wrap">
            <table className="data-table cm-table">
              <caption className="sr-only">{category.title}</caption>
              <thead>
                <tr>
                  <th scope="col" className="cm-feature">{t('compare.capabilityHeader')}</th>
                  <th scope="col" className="cm-us">{BRAND.name}</th>
                  {columns.map((column) => (
                    <th scope="col" key={column.key}>{t(`compare.competitorLabels.${column.key}`)}</th>
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
                    <td className="cm-us">{row.values.builderforce}</td>
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
    </section>
  );
}
