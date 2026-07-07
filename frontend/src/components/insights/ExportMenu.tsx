'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { empInsightsApi, downloadExport, type ExportDataset, type ExportFormat } from '@/lib/empInsightsApi';

const DATASETS: ExportDataset[] = ['dora', 'finance', 'allocation', 'benchmarking'];

const btnStyle: React.CSSProperties = {
  padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: '0.82rem', cursor: 'pointer', fontWeight: 600,
};
const selectStyle: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: '0.83rem',
};

/**
 * Export menu (EMP-20) — pick an insight dataset and download it as CSV or a
 * printable HTML table (Excel / print-to-PDF friendly). Drops into the insights
 * hub toolbar (beside the days-window select). Manager-gated by the surface it sits
 * on; the API also enforces the role.
 */
export function ExportMenu({ days = 30 }: { days?: number }) {
  const t = useTranslations('insights.emp');
  const [dataset, setDataset] = useState<ExportDataset>('dora');
  const [busy, setBusy] = useState(false);

  const run = async (format: ExportFormat) => {
    setBusy(true);
    try {
      const text = await empInsightsApi.exportDataset(dataset, format, days);
      downloadExport(text, dataset, format);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Select style={selectStyle} value={dataset} onChange={(e) => setDataset(e.target.value as ExportDataset)} aria-label={t('export.dataset')}>
        {DATASETS.map((d) => <option key={d} value={d}>{t(`export.datasets.${d}`)}</option>)}
      </Select>
      <button type="button" style={{ ...btnStyle, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => run('csv')}>
        {t('export.csv')}
      </button>
      <button type="button" style={{ ...btnStyle, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => run('html')}>
        {t('export.html')}
      </button>
    </div>
  );
}
