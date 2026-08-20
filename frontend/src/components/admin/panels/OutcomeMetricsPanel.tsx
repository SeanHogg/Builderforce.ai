'use client';

/**
 * Value outcomes — what the platform actually produced, at platform, workspace
 * or project scope.
 *
 * The panel leads with the NORTH STAR (the share of ideas that reached a proof
 * whose kill condition was graded) and then walks the method: Read → Prove,
 * Build, Measure, and the qualities of the work around them. It deliberately
 * shows no stars, downloads, workflow counts or agent counts — those are
 * operational and acquisition diagnostics, and a value review that opened with
 * one would be measuring popularity.
 *
 * Every label, format and comparison comes from `lib/outcomeMetrics.ts`, shared
 * with the in-canvas session scorecard, so the two cannot disagree about
 * whether a number improved.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi, type AdminOutcomeMetric, type AdminTenant } from '@/lib/adminApi';
import { copyTextToClipboard } from '@/lib/useCopyToClipboard';
import { AdminError, AdminLoading, AdminPanelHeader, fmtNum, useAdminData } from '@/components/admin/adminShared';
import {
  compareOutcomeMetric,
  formatOutcomeMetric,
  groupOutcomeMetrics,
  northStarMetric,
  outcomeFamilyLabel,
  outcomeMetricDefinition,
  outcomeMetricLabel,
  type OutcomeTranslator,
} from '@/lib/outcomeMetrics';
import { useFormat } from "@/i18n/useFormat";

const cardStyle: React.CSSProperties = {
  padding: 16,
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--bg-elevated)',
};

export default function OutcomeMetricsPanel() {
    const fmt = useFormat();
  const t = useTranslations('admin.outcomes');
  const m = useTranslations('outcomeMetrics') as unknown as OutcomeTranslator;
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
  const northStar = useMemo(() => (data ? northStarMetric(data.metrics, data.northStarKey) : null), [data]);
  const groups = useMemo(() => (data ? groupOutcomeMetrics(data.metrics, data.families ?? []) : []), [data]);

  const copyBrief = async () => {
    if (!data || !data.privacy.externalClaimsEligible) return;
    const lines = [
      `# ${t('briefTitle')}`,
      '',
      t('briefPeriod', { start: fmt.date(data.period.start), end: fmt.date(data.period.end) }),
      t('briefCohort', { sessions: fmtNum(data.sampleSize), delivered: fmtNum(data.deliveredSessions), graded: fmtNum(data.gradedSessions ?? 0) }),
      '',
      ...data.metrics.map((metric) =>
        `- ${outcomeMetricLabel(m, metric)}: ${formatOutcomeMetric(m, metric.current, metric.unit)} (${t('briefPrior')}: ${formatOutcomeMetric(m, metric.baseline, metric.unit)})`),
      '',
      t('briefFooter', {
        generated: fmt.dateTime(data.generatedAt),
        cohort: data.privacy.minimumExternalCohort,
        version: data.definitionVersion ?? '—',
      }),
    ];
    await copyTextToClipboard(lines.join('\n'));
    setCopyStatus(t('briefCopied'));
    window.setTimeout(() => setCopyStatus(''), 2_000);
  };

  if (loading && !data) return <AdminLoading />;

  return <div>
    <AdminPanelHeader
      title={t('title')}
      subtitle={t('subtitle')}
      count={data ? t('cohortCount', { count: fmtNum(data.sampleSize) }) : undefined}
      onRefresh={reload}
      actions={<>
        <select className="admin-select" aria-label={t('periodLabel')} value={days} onChange={(event) => setDays(Number(event.target.value))}>
          <option value={30}>{t('period30')}</option><option value={90}>{t('period90')}</option><option value={180}>{t('period180')}</option><option value={365}>{t('period365')}</option>
        </select>
        <select className="admin-select" aria-label={t('workspaceLabel')} value={tenantId ?? ''} onChange={(event) => { setTenantId(event.target.value ? Number(event.target.value) : undefined); setProjectId(undefined); }}>
          <option value="">{t('allWorkspaces')}</option>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
        </select>
        <select className="admin-select" aria-label={t('projectLabel')} value={projectId ?? ''} onChange={(event) => setProjectId(event.target.value ? Number(event.target.value) : undefined)}>
          <option value="">{t('allProjects')}</option>{projectOptions.map((project) => <option key={project.projectId} value={project.projectId}>{project.projectName} · {project.tenantName}</option>)}
        </select>
      </>}
    />
    <AdminError message={error} />
    {!data ? null : <>
      {northStar && <section
        aria-label={t('northStarLabel')}
        style={{ ...cardStyle, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 18, borderColor: 'var(--accent-border, var(--border-strong))' }}
      >
        <div style={{ minWidth: 220, flex: '1 1 260px' }}>
          <div className="text-muted" style={{ fontSize: 'var(--font-size-eyebrow)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{t('northStarLabel')}</div>
          <strong style={{ display: 'block', margin: '6px 0 4px', fontSize: 'var(--font-size-section)', color: 'var(--text-strong)' }}>{outcomeMetricLabel(m, northStar)}</strong>
          <p className="text-muted" style={{ margin: 0, fontSize: 'var(--font-size-eyebrow)', maxWidth: '58ch' }}>{outcomeMetricDefinition(m, northStar)}</p>
        </div>
        <div style={{ textAlign: 'right', minWidth: 140 }}>
          <strong style={{ display: 'block', fontSize: 'clamp(28px, 6vw, 40px)', lineHeight: 1.1, color: 'var(--text-strong)' }}>{formatOutcomeMetric(m, northStar.current, northStar.unit)}</strong>
          <MetricChange metric={northStar} t={m} />
          <small className="text-muted" style={{ display: 'block', marginTop: 4 }}>{t('gradedOf', { graded: fmtNum(data.gradedSessions ?? 0), sessions: fmtNum(data.sampleSize) })}</small>
        </div>
      </section>}

      <section style={{ ...cardStyle, marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 14 }}>
          <div><strong>{t('trendTitle')}</strong><div className="text-muted" style={{ fontSize: 'var(--font-size-eyebrow)' }}>{t('trendHint')}</div></div>
          <span className="text-muted" style={{ fontSize: 'var(--font-size-eyebrow)' }}>{t('trendLegend', { delivered: fmtNum(data.deliveredSessions), graded: fmtNum(data.gradedSessions ?? 0) })}</span>
        </div>
        <div aria-label={t('trendTitle')} style={{ height: 120, display: 'flex', alignItems: 'end', gap: 3, overflowX: 'auto' }}>
          {data.trends.map((point) => <div
            key={point.day}
            title={t('trendPoint', { day: point.day, sessions: point.sessions, deliveries: point.deliveries, graded: point.graded ?? 0 })}
            style={{ flex: 1, minWidth: 3, height: '100%', display: 'flex', alignItems: 'end', gap: 1 }}
          >
            <i style={{ display: 'block', flex: 1, minHeight: 1, height: `${point.sessions / peak * 100}%`, background: 'var(--coral-bright)', borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0' }} />
            <i style={{ display: 'block', flex: 1, minHeight: point.deliveries ? 2 : 0, height: `${point.deliveries / peak * 100}%`, background: 'var(--teal-bright)', borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0' }} />
            <i style={{ display: 'block', flex: 1, minHeight: point.graded ? 2 : 0, height: `${(point.graded ?? 0) / peak * 100}%`, background: 'var(--text-strong)', borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0' }} />
          </div>)}
        </div>
      </section>

      {groups.map((group) => <section key={group.family.key} aria-label={outcomeFamilyLabel(m, group.family)} style={{ marginBottom: 18 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 'var(--font-size-body)', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{outcomeFamilyLabel(m, group.family)}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: 8 }}>
          {group.metrics.map((metric) => <article key={metric.key} style={{ display: 'grid', gap: 5, padding: '11px 13px', border: `1px solid ${metric.northStar ? 'var(--border-strong)' : 'var(--border-subtle)'}`, borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontSize: 'var(--font-size-small)' }} title={outcomeMetricDefinition(m, metric)}>{outcomeMetricLabel(m, metric)}</span>
              <strong>{formatOutcomeMetric(m, metric.current, metric.unit)}</strong>
            </div>
            <small className="text-muted">{t('prior')}: {formatOutcomeMetric(m, metric.baseline, metric.unit)} · <MetricChange metric={metric} t={m} inline /></small>
          </article>)}
        </div>
      </section>)}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(330px,1fr))', gap: 14, marginBottom: 18 }}>
        <BreakdownTable
          title={t('workspaceValue')} nameLabel={t('workspaceColumn')} t={t}
          rows={data.tenants.map((tenant) => ({ id: tenant.tenantId, name: tenant.tenantName, sessions: tenant.sessions, deliveries: tenant.deliveries, graded: tenant.graded ?? 0 }))}
        />
        <BreakdownTable
          title={t('projectValue')} nameLabel={t('projectColumn')} t={t}
          rows={data.projects.map((project) => ({ id: project.projectId, name: `${project.projectName} · ${project.tenantName}`, sessions: project.sessions, deliveries: project.deliveries, graded: project.graded ?? 0 }))}
        />
      </section>

      <section style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, padding: 16, border: `1px solid ${data.privacy.externalClaimsEligible ? 'var(--success-border)' : 'var(--warning-border)'}`, borderRadius: 'var(--radius-lg)', background: data.privacy.externalClaimsEligible ? 'color-mix(in srgb,var(--success) 7%,var(--bg-elevated))' : 'color-mix(in srgb,var(--warning) 7%,var(--bg-elevated))' }}>
        <div style={{ minWidth: 220, flex: '1 1 320px' }}>
          <strong>{t('deckTitle')}</strong>
          <p className="text-muted" style={{ margin: '4px 0 0', fontSize: 'var(--font-size-eyebrow)' }}>
            {data.privacy.externalClaimsEligible
              ? t('deckEligible', { sessions: data.sampleSize, threshold: data.privacy.minimumExternalCohort })
              : t('deckIneligible', { threshold: data.privacy.minimumExternalCohort })}
          </p>
          <p className="text-muted" style={{ margin: '4px 0 0', fontSize: 'var(--font-size-eyebrow)' }}>{t('definitionVersion', { version: data.definitionVersion ?? '—' })}</p>
        </div>
        <button type="button" className="btn-ghost" disabled={!data.privacy.externalClaimsEligible} onClick={() => void copyBrief()}>{copyStatus || t('copyBrief')}</button>
      </section>
    </>}
  </div>;
}

/** Movement against the baseline. Colour follows the metric's own direction —
 *  a falling cost per delivery is good news and is shown as such. */
function MetricChange({ metric, t, inline }: { metric: AdminOutcomeMetric; t: OutcomeTranslator; inline?: boolean }) {
  const change = compareOutcomeMetric(t, metric);
  const color = change.favorable == null ? 'var(--text-muted)' : change.favorable ? 'var(--success)' : 'var(--danger)';
  return inline
    ? <span style={{ color }}>{change.label}</span>
    : <small style={{ display: 'block', color }}>{change.label}</small>;
}

function BreakdownTable({ title, nameLabel, rows, t }: {
  title: string;
  nameLabel: string;
  t: ReturnType<typeof useTranslations>;
  rows: Array<{ id: number; name: string; sessions: number; deliveries: number; graded: number }>;
}) {
  return <section>
    <h3 style={{ margin: '0 0 8px', fontSize: 'var(--font-size-card-title)' }}>{title}</h3>
    <div className="table-wrap">
      <table className="data-table">
        <thead><tr><th>{nameLabel}</th><th>{t('sessionsColumn')}</th><th>{t('deliveredColumn')}</th><th>{t('gradedColumn')}</th><th>{t('gradedRateColumn')}</th></tr></thead>
        <tbody>{rows.length
          ? rows.map((row) => <tr key={row.id}>
            <td>{row.name}</td><td>{fmtNum(row.sessions)}</td><td>{fmtNum(row.deliveries)}</td><td>{fmtNum(row.graded)}</td>
            <td>{row.sessions ? `${Math.round(row.graded / row.sessions * 100)}%` : '—'}</td>
          </tr>)
          : <tr><td colSpan={5} className="text-muted">{t('noData')}</td></tr>}
        </tbody>
      </table>
    </div>
  </section>;
}
