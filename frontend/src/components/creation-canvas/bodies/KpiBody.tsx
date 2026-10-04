import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
// One provenance line and one gate badge, rendered by every body that shows a derived
// number — see the header there for why a truncated number is worse than a blank one.
import { BasisNotice } from '../DerivedProvenance';
import type { CreationBodyProps } from './types';

export function KpiBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.node');
  // The interval renders WITH the value rather than under it: a point estimate and its
  // uncertainty read as one number or the reader takes the first and leaves.
  const low = typeof data.ciLow === 'number' ? data.ciLow : null;
  const high = typeof data.ciHigh === 'number' ? data.ciHigh : null;
  const interval = low != null && high != null ? `${low} – ${high}` : null;
  const sampleSize = typeof data.sampleSize === 'number' ? data.sampleSize : null;
  return (
    <div className={styles.kpis}>
      <div>
        <small>{data.title}</small>
        <strong>{String(data.value ?? '—')}{data.unit ? ` ${String(data.unit)}` : ''}</strong>
        {interval && <em>{t('confidenceInterval', { interval })}</em>}
        <em>{data.trend ? String(data.trend) : data.target != null ? t('targetValue', { value: String(data.target) }) : ''}</em>
        {sampleSize != null && <em>{t('sampleSize', { count: sampleSize })}</em>}
      </div>
      <BasisNotice basis={data.basis} />
    </div>
  );
}
