import type { CreationNodeData } from '../types';
import { useTranslations } from 'next-intl';
import { tabularFromObject } from '@/lib/canvasTabularData';
import { detectGeoColumns } from '@/lib/canvasGeo';
import styles from '../CreationCanvas.module.css';
import { useFormat } from '@/i18n/useFormat';

/**
 * "Plot on a map", offered only when the rows can actually be plotted.
 *
 * It decides its own visibility rather than taking a `canPlot` prop, because the same
 * `detectGeoColumns` call that answers "should this button exist" also answers "what
 * would it plot" — splitting those across a parent and a child is how the two get to
 * disagree. Absent (not disabled) when there are no coordinates: an inert control on a
 * dataset that will never have geography is noise, whereas the button APPEARING the
 * moment a lat/lng column lands is the affordance itself.
 */
export function DatasetPlotAction({ data, onPlot }: { data: CreationNodeData; onPlot: () => void }) {
  const t = useTranslations('creationCanvas');
  const source = tabularFromObject(data as Record<string, unknown>);
  if (!source.columns.length || !source.rows.length) return null;
  const columns = detectGeoColumns(source);
  if (!columns.latitude || !columns.longitude) return null;
  return <>
    <button type="button" className={styles.fullButton} onClick={onPlot}>{t('datasetPlotAction')}</button>
    <p className={styles.inspectorHint}>{t('datasetPlotHint', { latitude: columns.latitude, longitude: columns.longitude })}</p>
  </>;
}

/**
 * Column-level shape of an imported dataset. This is what tells a user whether
 * the column they want to analyze actually survived the import, and it is the
 * same profile Brain reads before it queries.
 */
export function DatasetProfileSummary({ data }: { data: CreationNodeData }) {
  const fmt = useFormat();
  const t = useTranslations('creationCanvas');
  const profile = Array.isArray(data.profile) ? data.profile as Array<Record<string, unknown>> : [];
  const rowCount = Number(data.rowCount) || (Array.isArray(data.rows) ? data.rows.length : 0);
  if (!profile.length) return <p className={styles.inspectorHint}>{rowCount ? t('datasetProfilePending') : t('datasetProfileEmpty')}</p>;
  return <section className={styles.datasetProfile} aria-label={t('datasetProfileLabel')}>
    <div className={styles.datasetProfileHead}><strong>{t('datasetProfileLabel')}</strong><span>{t('dataGridShape', { rows: fmt.number(rowCount), columns: profile.length })}</span></div>
    <div className={styles.datasetProfileList}>
      {profile.slice(0, 40).map((column, index) => {
        const filled = Number(column.filled) || 0;
        const coverage = rowCount ? Math.round(filled / rowCount * 100) : 0;
        const top = Array.isArray(column.topValues) ? column.topValues as Array<Record<string, unknown>> : [];
        return <article key={`${String(column.name)}-${index}`}>
          <div><b>{String(column.name)}</b><small>{t(`datasetColumnType_${String(column.type)}` as 'datasetColumnType_text')}</small></div>
          <p>{t('datasetColumnCoverage', { coverage, distinct: Number(column.distinct) || 0 })}</p>
          {column.type === 'number' && column.min != null
            ? <small>{t('datasetColumnRange', { min: String(column.min), max: String(column.max), sum: String(column.sum ?? 0) })}</small>
            : top.length ? <small>{top.slice(0, 3).map((value) => `${String(value.value)} (${Number(value.count) || 0})`).join(' · ')}</small> : null}
        </article>;
      })}
    </div>
  </section>;
}

export function SourceList({ sources }: { sources: unknown }) {
  const t = useTranslations('creationCanvas');
  if (!Array.isArray(sources) || !sources.length) return null;
  return <div className={styles.sourceList}><strong>{t('evidenceSources')}</strong>{sources.map((source, index) => { const item = source as { label?: string; resource?: string }; return <div key={`${item.resource}-${index}`}><span>{index + 1}</span><p><b>{item.label || t('source')}</b><code>{item.resource || t('canonicalApi')}</code></p></div>; })}</div>;
}
