/**
 * Quality-trend and finding-routing sections of the Agentic QA tab.
 *
 * Split out of `QaContent.tsx` when it crossed the 800-line ceiling. These two
 * belong together and apart from the rest: everything else on the tab is about
 * RUNNING the tester (targets, credentials, flows, explorations), while these are
 * about what the results MEAN over time — which defects escaped to production,
 * which model or agent produced the code they escaped from, and whether a new
 * finding should open a ticket by itself. They read their data as props and own
 * no fetching, so the parent stays the single place the tab talks to the API.
 *
 * No `'use client'` directive of its own: it is imported only from
 * `QaContent.tsx`, which declares the boundary, and a module inside an existing
 * client boundary inherits it. The directive marks WHERE server rendering stops,
 * not every file on the client side of it.
 */

import type React from 'react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import type { QaModelQuality, QaQualityTrend, QaRoutingSettings } from '@/lib/qa/api';
import { updateRouting } from '@/lib/qa/api';
import { Empty, SEVERITY_COLOR, Section, Table, Td, btnStyle, inputStyle } from './QaPrimitives';

// ── Quality trend (escaped defects + producing model/agent) ──────────────────

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function QualityTrendSection({ trend }: { trend: QaQualityTrend | null }) {
  const t = useTranslations('qa');
  if (!trend) {
    return (
      <Section title={t('qualityTrendTitle')}>
        <Empty>{t('qualityTrendEmpty')}</Empty>
      </Section>
    );
  }
  const peakFindings = Math.max(1, ...trend.daily.map((d) => d.findings + d.ciFailures));
  return (
    <Section title={t('qualityTrendTitleWindow', { days: trend.windowDays })}>
      {/* Headline metrics */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Metric label={t('metricQualityScore')} value={trend.qualityScore != null ? pct(trend.qualityScore) : '—'}
          hint={t('metricQualityScoreHint')} color={trend.qualityScore != null && trend.qualityScore < 0.5 ? 'var(--error)' : 'var(--success)'} />
        <Metric label={t('metricEscapedDefects')} value={String(trend.findings.total)} hint={t('metricOpenHint', { count: trend.findings.open })}
          color={trend.findings.open > 0 ? 'var(--amber-bright)' : 'var(--text-primary)'} />
        <Metric label={t('metricCiFailureRate')} value={trend.ci.builds > 0 ? pct(trend.ci.failureRate) : '—'}
          hint={t('metricBuildsHint', { failures: trend.ci.failures, builds: trend.ci.builds })} color={trend.ci.failureRate > 0.2 ? 'var(--error)' : 'var(--text-primary)'} />
        <Metric label={t('metricAutoRouted')} value={String(trend.findings.autoRouted)} hint={t('metricAutoRoutedHint')} />
      </div>

      {/* Severity breakdown */}
      {trend.findings.total > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {SEVERITY_ORDER.filter((s) => trend.findings.bySeverity[s]).map((s) => (
            <span key={s} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', color: SEVERITY_COLOR[s] ?? 'var(--text-secondary)', fontWeight: 700 }}>
              {s}: {trend.findings.bySeverity[s]}
            </span>
          ))}
        </div>
      )}

      {/* Daily defect series (findings + CI failures, stacked bars) */}
      {trend.daily.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{t('defectsPerDay')}</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 64 }}>
            {trend.daily.map((d) => (
              <div key={d.date} title={t('dailyBarTitle', { date: d.date, findings: d.findings, ciFailures: d.ciFailures })}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', minWidth: 4 }}>
                <span style={{ display: 'block', height: `${(d.ciFailures / peakFindings) * 100}%`, background: 'var(--error)', borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0'}} />
                <span style={{ display: 'block', height: `${(d.findings / peakFindings) * 100}%`, background: 'var(--amber-bright)' }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Which model / agent produced the defects */}
      <ProducerTable title={t('byModel')} rows={trend.byModel} />
      <ProducerTable title={t('byAgent')} rows={trend.byAgent} />
      {(trend.byModel.length > 0 || trend.byAgent.length > 0) && (
        <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
          {t('producerFootnote', {
            unattributed: trend.findings.escapedUnattributed > 0
              ? t('producerFootnoteUnattributed', { count: trend.findings.escapedUnattributed })
              : '',
          })}
        </p>
      )}
    </Section>
  );
}

function Metric({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: string }) {
  return (
    <div style={{ padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-deep)', minWidth: 130 }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? 'var(--text-primary)', lineHeight: 1.3 }}>{value}</div>
      {hint && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{hint}</div>}
    </div>
  );
}

function ProducerTable({ title, rows }: { title: string; rows: QaModelQuality[] }) {
  const t = useTranslations('qa');
  if (rows.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '10px 0 4px' }}>{t('producerCaption', { title })}</div>
      <Table head={[t('colProducer'), t('colRuns'), t('colAvgScore'), t('colMerged'), t('colCiGreen'), t('colCaught'), t('colEscaped')]}>
        {rows.map((r) => (
          <tr key={r.key}>
            <Td><code style={{ fontSize: 11 }}>{r.key}</code></Td>
            <Td>{r.runs}</Td>
            <Td><span style={{ color: r.avgScore < 0.5 ? 'var(--error)' : 'var(--text-secondary)', fontWeight: 700 }}>{pct(r.avgScore)}</span></Td>
            <Td>{pct(r.mergedRate)}</Td>
            <Td><span style={{ color: r.ciGreenRate < 0.6 ? 'var(--amber-bright)' : 'var(--text-secondary)' }}>{pct(r.ciGreenRate)}</span></Td>
            <Td><span style={{ color: r.defects > 0 ? 'var(--amber-bright)' : 'var(--text-secondary)', fontWeight: 700 }}>{r.defects}</span></Td>
            <Td><span style={{ color: r.escapedDefects > 0 ? 'var(--error)' : 'var(--text-secondary)', fontWeight: 700 }}>{r.escapedDefects}</span></Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

// ── Auto-routing policy (findings → fix agent) ───────────────────────────────

export function RoutingSection({ projectId, settings, busy, onRun }: {
  projectId: number; settings: QaRoutingSettings | null; busy: string | null;
  onRun: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const t = useTranslations('qa');
  const current: QaRoutingSettings = settings ?? { enabled: false, minSeverity: 'high', targetLaneKey: null, maxPerBatch: 5 };
  const [draft, setDraft] = useState<QaRoutingSettings>(current);

  // Keep the editor in sync when the loaded settings change (project switch / reload).
  useEffect(() => { setDraft(current); }, [settings, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = JSON.stringify(draft) !== JSON.stringify(current);

  return (
    <Section title={t('routingTitle')}>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
        {t('routingBlurb')}
      </p>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
          {t('enabled')}
        </label>
        <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('minSeverity')}</label>
        <Select style={inputStyle} value={draft.minSeverity} onChange={(e) => setDraft({ ...draft, minSeverity: e.target.value })}>
          {SEVERITY_ORDER.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('laneLabel')}</label>
        <input style={inputStyle} placeholder={t('placeholderAutoDetect')} value={draft.targetLaneKey ?? ''}
          onChange={(e) => setDraft({ ...draft, targetLaneKey: e.target.value || null })} />
        <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('maxPerRun')}</label>
        <input type="number" min={1} max={50} value={draft.maxPerBatch} style={{ ...inputStyle, minWidth: 64, width: 64 }}
          onChange={(e) => setDraft({ ...draft, maxPerBatch: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} />
        <button type="button" style={btnStyle(busy != null || !dirty)} disabled={busy != null || !dirty}
          onClick={() => onRun('routing-save', () => updateRouting(projectId, draft))}>
          {busy === 'routing-save' ? t('saving') : t('save')}
        </button>
      </div>
    </Section>
  );
}

