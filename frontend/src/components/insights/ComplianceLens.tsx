'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { insightsApi, type ComplianceSummary } from '@/lib/builderforceApi';
import { apiRequestText } from '@/lib/apiClient';
import { downloadText } from '@/lib/download';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmEmpty, PmError, StatCard, StatusPill } from '@/components/pm/pmShared';
import { LocalCollection } from '@/components/pm/LocalCollection';
import type { CollectionDescriptor } from '@/components/collection/descriptor';
import { DaysWindowSelect, KpiGrid } from './LensShell';
import { useInsightFormat } from './format';

const btnStyle: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
  background: 'transparent', color: 'var(--text-primary)', fontWeight: 600, fontSize: 'var(--font-size-small)', cursor: 'pointer',
};

type ToolRow = ComplianceSummary['byTool'][number];
type AgentRow = ComplianceSummary['byAgent'][number];

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
      const csv = await apiRequestText(`/api/exports/sources/insights.evidence-pack?format=csv&days=90`);
      downloadText(csv, `evidence-pack-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
    } finally {
      setExporting(false);
    }
  };

  // Read-only Collection descriptors (entity: null) — audit rows have no bulk API.
  const toolDescriptor = useMemo<CollectionDescriptor<ToolRow>>(() => ({
    entity: null,
    surfaceKey: 'insights.compliance.byTool',
    rowId: (r) => r.toolName,
    label: (r) => r.toolName,
    defaultSort: { key: 'count', dir: 'desc' },
    emptyKey: 'emptyComplianceTools',
    card: (r) => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12 }}>
        <span style={{ fontWeight: 600 }}>{r.toolName}</span>
        <StatusPill value={r.risk === 'sensitive' ? 'blocked' : 'done'} />
        <span className="ui-text-small" style={{ color: 'var(--text-muted)' }}>{t('comp.count')}: {r.count}</span>
      </div>
    ),
    columns: [
      { key: 'tool', header: t('comp.tool'), sortKey: 'tool', compare: (a, b) => a.toolName.localeCompare(b.toolName), cell: (r) => r.toolName },
      { key: 'risk', header: t('comp.risk'), sortKey: 'risk', compare: (a, b) => a.risk.localeCompare(b.risk), cell: (r) => <StatusPill value={r.risk === 'sensitive' ? 'blocked' : 'done'} /> },
      { key: 'count', header: t('comp.count'), sortKey: 'count', compare: (a, b) => a.count - b.count, cell: (r) => r.count, align: 'end' },
    ],
  }), [t]);

  const agentDescriptor = useMemo<CollectionDescriptor<AgentRow>>(() => ({
    entity: null,
    surfaceKey: 'insights.compliance.byAgent',
    rowId: (r) => `${r.agent}|${r.kind}`,
    label: (r) => r.agent,
    defaultSort: { key: 'count', dir: 'desc' },
    emptyKey: 'emptyComplianceAgents',
    card: (r) => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12 }}>
        <span style={{ fontWeight: 600 }}>{r.agent}</span>
        <span className="ui-text-small" style={{ color: 'var(--text-muted)' }}>{r.kind}</span>
        <span className="ui-text-small" style={{ color: 'var(--text-muted)' }}>{t('comp.count')}: {r.count}</span>
      </div>
    ),
    columns: [
      { key: 'agent', header: t('comp.agent'), sortKey: 'agent', compare: (a, b) => a.agent.localeCompare(b.agent), cell: (r) => r.agent },
      { key: 'kind', header: t('comp.kind'), sortKey: 'kind', compare: (a, b) => a.kind.localeCompare(b.kind), cell: (r) => r.kind },
      { key: 'count', header: t('comp.count'), sortKey: 'count', compare: (a, b) => a.count - b.count, cell: (r) => r.count, align: 'end' },
    ],
  }), [t]);

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
        <LocalCollection descriptor={toolDescriptor} rows={data.byTool} searchText={(r) => r.toolName} />
      </PmCard>

      <PmCard title={t('comp.byAgent')}>
        <LocalCollection descriptor={agentDescriptor} rows={data.byAgent} searchText={(r) => `${r.agent} ${r.kind}`} />
      </PmCard>
    </div>
  );
}
