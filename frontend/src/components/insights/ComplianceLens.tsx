'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { insightsApi, type ComplianceSummary } from '@/lib/builderforceApi';
import { apiRequestText } from '@/lib/apiClient';
import { downloadText } from '@/lib/download';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmEmpty, PmError, StatCard, StatusPill } from '@/components/pm/pmShared';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { DaysWindowSelect, KpiGrid } from './LensShell';
import { useInsightFormat } from './format';

const btnStyle: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
  background: 'transparent', color: 'var(--text-primary)', fontWeight: 600, fontSize: 'var(--font-size-small)', cursor: 'pointer',
};

/** LENS #6 — compliance/audit over tool_audit_events + evidence-pack export. */
export function ComplianceLens() {
  const { int } = useInsightFormat();
  const t = useTranslations('insights');
  const [days, setDays] = useState(30);
  const [exporting, setExporting] = useState(false);
  const { data, error } = usePmData<ComplianceSummary>(() => insightsApi.compliance(days), [days]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const csv = await apiRequestText(`/api/insights/compliance/export?format=csv&days=90`);
      downloadText(csv, `evidence-pack-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
    } finally {
      setExporting(false);
    }
  };

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <DaysWindowSelect value={days} onChange={setDays} />
        <button type="button" style={btnStyle} disabled={exporting} onClick={exportCsv}>
          {exporting ? t('comp.exporting') : t('comp.exportCsv')}
        </button>
      </div>
      <KpiGrid>
        <StatCard label={t('comp.totalEvents')} value={int(data.totalEvents)} sub={t('days', { n: data.windowDays })} />
        <StatCard label={t('comp.sensitive')} value={int(data.sensitiveEvents)} sub={t('comp.sensitiveSub')} />
        <StatCard label={t('comp.executions')} value={int(data.distinctExecutions)} sub={t('comp.executionsSub')} />
        <StatCard label={t('comp.agents')} value={int(data.distinctAgents)} sub={t('comp.agentsSub')} />
      </KpiGrid>

      {/* Say which half of the window is still itemised. The numbers above are exact at
          both grains, so this is not a caveat on them — it is the one thing an auditor
          cannot do with the older half, stated where they choose the window. */}
      {data.windowDays > data.rawWithinDays && (
        <p className="ui-text-small" style={{ margin: 0, color: 'var(--text-muted)' }}>
          {t('comp.grainNote', { days: data.rawWithinDays })}
        </p>
      )}

      <PmCard title={t('comp.byTool')}>
        {data.byTool.length === 0 ? (
          <span className="ui-text-small" style={{ color: 'var(--text-muted)' }}>{t('comp.noEvents')}</span>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead><tr style={theadRowStyle}><th style={thStyle}>{t('comp.tool')}</th><th style={thStyle}>{t('comp.risk')}</th><th style={thStyle}>{t('comp.count')}</th></tr></thead>
              <tbody>
                {data.byTool.map((r) => (
                  <tr key={r.toolName} style={trStyle}>
                    <td style={tdStyle}>{r.toolName}</td>
                    <td style={tdStyle}><StatusPill value={r.risk === 'sensitive' ? 'blocked' : 'done'} /></td>
                    <td style={tdMutedStyle}>{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PmCard>

      <PmCard title={t('comp.byAgent')}>
        {data.byAgent.length === 0 ? (
          <span className="ui-text-small" style={{ color: 'var(--text-muted)' }}>{t('comp.noEvents')}</span>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead><tr style={theadRowStyle}><th style={thStyle}>{t('comp.agent')}</th><th style={thStyle}>{t('comp.kind')}</th><th style={thStyle}>{t('comp.count')}</th></tr></thead>
              <tbody>
                {data.byAgent.map((r) => (
                  <tr key={r.agent} style={trStyle}>
                    <td style={tdStyle}>{r.agent}</td>
                    <td style={tdMutedStyle}>{r.kind}</td>
                    <td style={tdMutedStyle}>{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PmCard>
    </div>
  );
}
