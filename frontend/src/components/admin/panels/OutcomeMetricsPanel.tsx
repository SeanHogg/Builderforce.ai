'use client';

import { useEffect, useMemo, useState } from 'react';
import { adminApi, type AdminOutcomeMetric, type AdminTenant } from '@/lib/adminApi';
import { copyTextToClipboard } from '@/lib/useCopyToClipboard';
import { AdminError, AdminLoading, AdminPanelHeader, fmtNum, useAdminData } from '@/components/admin/adminShared';

function formatMetric(value: number | null, unit: AdminOutcomeMetric['unit']): string {
  if (value == null) return 'Not measured';
  if (unit === 'percent') return `${Math.round(value * 100)}%`;
  if (unit === 'usd') return `$${value.toFixed(2)}`;
  if (unit === 'seconds') return value >= 60 ? `${(value / 60).toFixed(value >= 600 ? 0 : 1)} min` : `${Math.round(value)} sec`;
  if (unit === 'agents') return `${value.toFixed(value % 1 ? 1 : 0)} agent${value === 1 ? '' : 's'}`;
  return value.toFixed(value % 1 ? 1 : 0);
}

function comparison(metric: AdminOutcomeMetric): { label: string; positive: boolean | null } {
  if (metric.current == null || metric.baseline == null) return { label: 'Baseline gathering', positive: null };
  const delta = metric.current - metric.baseline;
  if (Math.abs(delta) < .0001) return { label: 'No change', positive: true };
  const positive = metric.direction === 'higher' ? delta > 0 : delta < 0;
  const magnitude = metric.unit === 'percent' ? `${Math.abs(delta * 100).toFixed(0)} pts` : formatMetric(Math.abs(delta), metric.unit);
  return { label: `${positive ? '↗' : '↘'} ${magnitude} vs prior period`, positive };
}

export default function OutcomeMetricsPanel() {
  const [days, setDays] = useState(30);
  const [tenantId, setTenantId] = useState<number | undefined>();
  const [projectId, setProjectId] = useState<number | undefined>();
  const [tenants, setTenants] = useState<AdminTenant[]>([]);
  const [copyStatus, setCopyStatus] = useState('');
  const { data, loading, error, reload } = useAdminData(
    () => adminApi.outcomeMetrics({ days, tenantId, projectId }),
    [days, tenantId, projectId],
  );

  useEffect(() => {
    void adminApi.tenants().then(setTenants).catch(() => setTenants([]));
  }, []);

  const projectOptions = data?.projects ?? [];
  const peak = Math.max(1, ...(data?.trends.map((point) => Math.max(point.sessions, point.deliveries)) ?? [1]));
  const metricByKey = useMemo(() => new Map(data?.metrics.map((metric) => [metric.key, metric]) ?? []), [data]);
  const headlineKeys = ['deliverableRate', 'timeToArtifact', 'validationRate', 'correlationCoverage'];

  const copyBrief = async () => {
    if (!data || !data.privacy.externalClaimsEligible) return;
    const lines = [
      '# Builderforce value generation',
      '',
      `Period: ${new Date(data.period.start).toLocaleDateString()} – ${new Date(data.period.end).toLocaleDateString()}`,
      `Cohort: ${fmtNum(data.sampleSize)} Creation Sessions · ${fmtNum(data.deliveredSessions)} reached a real deliverable`,
      '',
      ...data.metrics.map((metric) => `- ${metric.label}: ${formatMetric(metric.current, metric.unit)} (prior period: ${formatMetric(metric.baseline, metric.unit)})`),
      '',
      `Generated ${new Date(data.generatedAt).toLocaleString()}. Content-free aggregate; minimum external cohort ${data.privacy.minimumExternalCohort}.`,
    ];
    await copyTextToClipboard(lines.join('\n'));
    setCopyStatus('Value brief copied');
    window.setTimeout(() => setCopyStatus(''), 2_000);
  };

  if (loading && !data) return <AdminLoading />;

  return <div>
    <AdminPanelHeader
      title="Value outcomes"
      subtitle="Idea-to-delivery value across Creation Sessions—not runtime activity or vanity metrics."
      count={data ? `${fmtNum(data.sampleSize)} sessions in the current cohort` : undefined}
      onRefresh={reload}
      actions={<>
        <select className="admin-select" aria-label="Outcome period" value={days} onChange={(event) => setDays(Number(event.target.value))}>
          <option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={180}>Last 180 days</option><option value={365}>Last year</option>
        </select>
        <select className="admin-select" aria-label="Outcome workspace" value={tenantId ?? ''} onChange={(event) => { setTenantId(event.target.value ? Number(event.target.value) : undefined); setProjectId(undefined); }}>
          <option value="">All workspaces</option>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
        </select>
        <select className="admin-select" aria-label="Outcome project" value={projectId ?? ''} onChange={(event) => setProjectId(event.target.value ? Number(event.target.value) : undefined)}>
          <option value="">All projects</option>{projectOptions.map((project) => <option key={project.projectId} value={project.projectId}>{project.projectName} · {project.tenantName}</option>)}
        </select>
      </>}
    />
    <AdminError message={error} />
    {!data ? null : <>
      <section aria-label="Outcome highlights" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12, marginBottom: 18 }}>
        {headlineKeys.map((key) => {
          const metric = metricByKey.get(key); if (!metric) return null;
          const change = comparison(metric);
          return <article key={key} style={{ padding: 16, border: '1px solid var(--border-subtle)', borderRadius: 12, background: 'var(--bg-elevated)' }}>
            <div className="text-muted" style={{ fontSize: 11 }}>{metric.label}</div>
            <strong style={{ display: 'block', margin: '7px 0 5px', fontSize: 25, color: 'var(--text-strong)' }}>{formatMetric(metric.current, metric.unit)}</strong>
            <small style={{ color: change.positive == null ? 'var(--text-muted)' : change.positive ? 'var(--success,#16856f)' : 'var(--danger,#b14f45)' }}>{change.label}</small>
          </article>;
        })}
      </section>

      <section style={{ marginBottom: 18, padding: 16, border: '1px solid var(--border-subtle)', borderRadius: 12, background: 'var(--bg-elevated)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}><div><strong>Value trend</strong><div className="text-muted" style={{ fontSize: 11 }}>Sessions started and successful deliveries by day</div></div><span className="text-muted" style={{ fontSize: 11 }}>{fmtNum(data.deliveredSessions)} delivered</span></div>
        <div aria-label="Daily outcome trend" style={{ height: 120, display: 'flex', alignItems: 'end', gap: 3, overflow: 'hidden' }}>
          {data.trends.map((point) => <div key={point.day} title={`${point.day}: ${point.sessions} sessions, ${point.deliveries} deliveries`} style={{ flex: 1, minWidth: 3, height: '100%', display: 'flex', alignItems: 'end', gap: 1 }}><i style={{ display: 'block', flex: 1, minHeight: 1, height: `${point.sessions / peak * 100}%`, background: '#9db9ee', borderRadius: '3px 3px 0 0' }} /><i style={{ display: 'block', flex: 1, minHeight: point.deliveries ? 2 : 0, height: `${point.deliveries / peak * 100}%`, background: '#16856f', borderRadius: '3px 3px 0 0' }} /></div>)}
        </div>
      </section>

      <section aria-label="All outcome metrics" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: 8, marginBottom: 18 }}>
        {data.metrics.map((metric) => { const change = comparison(metric); return <article key={metric.key} style={{ display: 'grid', gap: 5, padding: '11px 13px', border: '1px solid var(--border-subtle)', borderRadius: 9, background: 'var(--bg-elevated)' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span style={{ fontSize: 12 }}>{metric.label}</span><strong>{formatMetric(metric.current, metric.unit)}</strong></div><small className="text-muted">Prior: {formatMetric(metric.baseline, metric.unit)} · <span style={{ color: change.positive == null ? undefined : change.positive ? 'var(--success,#16856f)' : 'var(--danger,#b14f45)' }}>{change.label}</span></small></article>; })}
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(330px,1fr))', gap: 14, marginBottom: 18 }}>
        <BreakdownTable title="Workspace value" nameLabel="Workspace" rows={data.tenants.map((tenant) => ({ id: tenant.tenantId, name: tenant.tenantName, sessions: tenant.sessions, deliveries: tenant.deliveries }))} />
        <BreakdownTable title="Project value" nameLabel="Project" rows={data.projects.map((project) => ({ id: project.projectId, name: `${project.projectName} · ${project.tenantName}`, sessions: project.sessions, deliveries: project.deliveries }))} />
      </section>

      <section style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, padding: 16, border: `1px solid ${data.privacy.externalClaimsEligible ? '#9bd4c7' : '#e2c984'}`, borderRadius: 12, background: data.privacy.externalClaimsEligible ? 'color-mix(in srgb,#16856f 7%,var(--bg-elevated))' : 'color-mix(in srgb,#c68a16 7%,var(--bg-elevated))' }}>
        <div><strong>Sales-deck proof</strong><p className="text-muted" style={{ margin: '4px 0 0', fontSize: 11 }}>{data.privacy.externalClaimsEligible ? `Eligible: ${data.sampleSize} content-free sessions exceed the ${data.privacy.minimumExternalCohort}-session privacy threshold.` : `Internal preview only: at least ${data.privacy.minimumExternalCohort} sessions are required before using this cohort externally.`}</p></div>
        <button type="button" className="btn-ghost" disabled={!data.privacy.externalClaimsEligible} onClick={() => void copyBrief()}>{copyStatus || 'Copy value brief'}</button>
      </section>
    </>}
  </div>;
}

function BreakdownTable({ title, nameLabel, rows }: { title: string; nameLabel: string; rows: Array<{ id: number; name: string; sessions: number; deliveries: number }> }) {
  return <section><h3 style={{ margin: '0 0 8px', fontSize: 14 }}>{title}</h3><div className="table-wrap"><table className="data-table"><thead><tr><th>{nameLabel}</th><th>Sessions</th><th>Delivered</th><th>Rate</th></tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={row.id}><td>{row.name}</td><td>{fmtNum(row.sessions)}</td><td>{fmtNum(row.deliveries)}</td><td>{row.sessions ? `${Math.round(row.deliveries / row.sessions * 100)}%` : '—'}</td></tr>) : <tr><td colSpan={4} className="text-muted">No outcome data in this cohort.</td></tr>}</tbody></table></div></section>;
}
