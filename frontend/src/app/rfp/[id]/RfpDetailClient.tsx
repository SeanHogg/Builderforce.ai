'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRole, hasMinRole } from '@/lib/rbac';
import {
  rfpApi, type RfpRequestRow, type RfpResponseRow, type RfpResponseBody, type RfpCostModel, type RfpPhase,
} from '@/lib/builderforceApi';

/**
 * RfpDetailClient — the response workspace for one RFP request. Generates a proposal
 * (developer+) and renders it: executive summary, a capability roster grounded in a
 * freshness-gated diagnostics scan, a P&L breakdown, a phase/milestone Gantt, risks,
 * dependencies, portfolio matches, and a co-branded document preview + download.
 * Fully localized + themed (light/dark) + responsive.
 */

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16, marginBottom: 16,
};
const h2: React.CSSProperties = { fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 10px' };
const muted: React.CSSProperties = { color: 'var(--text-muted)', fontSize: 13 };

// Chart series palette — saturated fills readable on both themes (white text on top).
const PHASE_COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#ec4899', '#84cc16'];
const COST_COLORS: Record<string, string> = {
  build: '#6366f1', agentic: '#0ea5e9', marketing: '#14b8a6', contingency: '#f59e0b', margin: '#22c55e',
};

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export default function RfpDetailClient() {
  const t = useTranslations('rfpPage');
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id ?? '');
  const role = useRole();
  const canManage = hasMinRole(role, 'developer');

  const [request, setRequest] = useState<RfpRequestRow | null>(null);
  const [responses, setResponses] = useState<RfpResponseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    rfpApi.getRequest(id)
      .then((r) => { setRequest(r.request); setResponses(r.responses); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      await rfpApi.generate(id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const latest = responses[0] ?? null;
  const body = latest?.body ?? null;

  return (
    <div className="page-inner">
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => router.push('/rfp')} style={{ marginBottom: 14 }}>
        ← {t('backToList')}
      </button>

      {loading && <div style={card}>{t('loading')}</div>}
      {error && <div style={{ ...card, borderColor: 'var(--danger, #e5484d)', color: 'var(--danger, #e5484d)' }}>{error}</div>}

      {!loading && request && (
        <>
          <div style={{ ...card, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div>
              <h1 style={{ fontSize: 'clamp(20px,3vw,26px)', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 6px' }}>{request.title}</h1>
              <p style={muted}>
                {request.requesterOrgName || t('noOrg')} · {request.sourceMode === 'existing_project' ? t('sourceExisting') : t('sourceNew')}
              </p>
            </div>
            <button type="button" className="btn btn-primary" onClick={generate} disabled={generating || !canManage} title={canManage ? undefined : t('needDeveloper')}>
              {generating ? t('generating') : latest ? t('regenerate') : t('generate')}
            </button>
          </div>

          {generating && <div style={{ ...card, ...muted }}>{t('generatingHint')}</div>}

          {!latest && !generating && (
            <div style={{ ...card, ...muted }}>{t('noResponseYet')}</div>
          )}

          {body && latest && (
            <>
              {/* Grounding / freshness */}
              {body.grounding.scanFreshness && (
                <div style={{ ...card, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
                    padding: '3px 9px', borderRadius: 999,
                    background: latest.scanRefreshed ? 'rgba(34,197,94,0.15)' : 'rgba(139,92,246,0.15)',
                    color: latest.scanRefreshed ? '#16a34a' : '#7c3aed',
                    border: `1px solid ${latest.scanRefreshed ? 'rgba(34,197,94,0.3)' : 'rgba(139,92,246,0.3)'}`,
                  }}>
                    {latest.scanRefreshed ? t('scanRefreshed') : t('scanCurrent')}
                  </span>
                  <span style={muted}>
                    {body.grounding.projectName ? t('groundedOn', { project: body.grounding.projectName }) : t('greenfield')}
                    {body.grounding.scanFreshness.ageDays != null && !latest.scanRefreshed
                      ? ` · ${t('scanAge', { days: body.grounding.scanFreshness.ageDays })}` : ''}
                  </span>
                </div>
              )}

              {/* Executive summary */}
              <div style={card}>
                <h2 style={h2}>{t('sec.summary')}</h2>
                <p style={{ color: 'var(--text-primary)', fontSize: 14, lineHeight: 1.6, margin: 0 }}>{body.executiveSummary}</p>
              </div>

              {/* Capability roster */}
              <CapabilitySection body={body} t={t} />

              {/* P&L */}
              <CostSection cost={body.costModel} t={t} />

              {/* Gantt */}
              <GanttSection phases={body.plan.phases} timeline={body.timeline} t={t} />

              {/* Risks + dependencies */}
              <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>
                <RisksSection body={body} t={t} />
                <DependenciesSection body={body} t={t} />
              </div>

              {/* Portfolio matches */}
              {body.portfolioMatches && body.portfolioMatches.length > 0 && (
                <div style={card}>
                  <h2 style={h2}>{t('sec.portfolio')}</h2>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {body.portfolioMatches.map((m) => (
                      <div key={m.projectId} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <span style={{ fontWeight: 700, color: 'var(--accent, #0ea5e9)', minWidth: 44 }}>{Math.round(m.score * 100)}%</span>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{m.name}</span>
                        <span style={muted}>— {m.rationale}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Branded document */}
              <DocumentSection docHtml={latest.docHtml} title={request.title} t={t} />
            </>
          )}
        </>
      )}
    </div>
  );
}

type T = ReturnType<typeof useTranslations>;

function CapabilitySection({ body, t }: { body: RfpResponseBody; t: T }) {
  const r = body.capabilityRoster;
  const empty = r.capabilities.length === 0 && r.valueProps.length === 0 && r.keyComponents.length === 0;
  return (
    <div style={card}>
      <h2 style={h2}>{t('sec.capabilities')}</h2>
      {empty && <p style={muted}>{t('capabilitiesGreenfield')}</p>}
      {r.valueProps.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {r.valueProps.map((v, i) => (
            <span key={i} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 999, padding: '2px 10px', fontSize: 12, color: 'var(--text-secondary)' }}>{v}</span>
          ))}
        </div>
      )}
      {r.keyComponents.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={thCell}>{t('col.component')}</th>
                <th style={thCell}>{t('col.responsibility')}</th>
              </tr>
            </thead>
            <tbody>
              {r.keyComponents.map((k, i) => (
                <tr key={i}>
                  <td style={{ ...tdCell, fontWeight: 600 }}>{k.name}</td>
                  <td style={tdCell}>{k.responsibility}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {r.frameworks.length > 0 && (
        <p style={{ ...muted, marginTop: 10 }}>{t('stack')}: {r.frameworks.join(', ')}</p>
      )}
    </div>
  );
}

function CostSection({ cost, t }: { cost: RfpCostModel; t: T }) {
  const max = Math.max(cost.quotedPriceUsd, 1);
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={h2}>{t('sec.economics')}</h2>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)' }}>{t('quotedPrice')}</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)' }}>{usd(cost.quotedPriceUsd)}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
        {cost.lineItems.map((li, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ minWidth: 160, fontSize: 13, color: 'var(--text-secondary)' }}>{li.label}</span>
            <div style={{ flex: 1, background: 'var(--bg-elevated)', borderRadius: 6, height: 18, overflow: 'hidden', minWidth: 60 }}>
              <div style={{ width: `${Math.max((li.amountUsd / max) * 100, 1)}%`, background: COST_COLORS[li.category] ?? 'var(--accent, #0ea5e9)', height: '100%' }} />
            </div>
            <span style={{ minWidth: 90, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--text-primary)' }}>{usd(li.amountUsd)}</span>
          </div>
        ))}
      </div>
      <p style={{ ...muted, marginTop: 10 }}>
        {t('marginNote', { pct: Math.round(cost.marginPct * 100), weeks: cost.effortWeeks })}
      </p>
    </div>
  );
}

function GanttSection({ phases, timeline, t }: { phases: RfpPhase[]; timeline: RfpResponseBody['timeline']; t: T }) {
  const range = useMemo(() => {
    const starts = phases.map((p) => new Date(p.startDate).getTime());
    const ends = phases.map((p) => new Date(p.endDate).getTime());
    const min = Math.min(...starts, new Date(timeline.startDate).getTime());
    const max = Math.max(...ends, new Date(timeline.endDate).getTime());
    return { min, span: Math.max(max - min, 1) };
  }, [phases, timeline]);

  if (phases.length === 0) return null;
  return (
    <div style={card}>
      <h2 style={h2}>{t('sec.plan')}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {phases.map((p, i) => {
          const left = ((new Date(p.startDate).getTime() - range.min) / range.span) * 100;
          const width = ((new Date(p.endDate).getTime() - new Date(p.startDate).getTime()) / range.span) * 100;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ minWidth: 150, fontSize: 13, color: 'var(--text-secondary)' }}>{p.name}</span>
              <div style={{ flex: 1, position: 'relative', height: 22, background: 'var(--bg-elevated)', borderRadius: 6, minWidth: 80 }}>
                <div
                  title={`${p.startDate} → ${p.endDate}`}
                  style={{ position: 'absolute', left: `${left}%`, width: `${Math.max(width, 2)}%`, top: 3, bottom: 3, background: PHASE_COLORS[i % PHASE_COLORS.length], borderRadius: 4, color: '#fff', fontSize: 10, display: 'flex', alignItems: 'center', paddingLeft: 6, overflow: 'hidden', whiteSpace: 'nowrap' }}
                >
                  {p.milestones[0]?.name ?? ''}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p style={{ ...muted, marginTop: 10 }}>{t('deliveryWindow', { start: timeline.startDate, end: timeline.endDate, weeks: timeline.weeks })}</p>
    </div>
  );
}

function RisksSection({ body, t }: { body: RfpResponseBody; t: T }) {
  const sevColor: Record<string, string> = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' };
  return (
    <div style={card}>
      <h2 style={h2}>{t('sec.risks')}</h2>
      {body.risks.length === 0 ? <p style={muted}>—</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {body.risks.map((r, i) => (
            <div key={i}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: sevColor[r.severity] ?? '#999' }} />
                <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13 }}>{r.title}</span>
                <span style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: 700, color: sevColor[r.severity] ?? '#999' }}>{t(`severity.${r.severity}`)}</span>
              </div>
              <p style={{ ...muted, margin: '2px 0 0 16px' }}>{r.mitigation}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DependenciesSection({ body, t }: { body: RfpResponseBody; t: T }) {
  return (
    <div style={card}>
      <h2 style={h2}>{t('sec.dependencies')}</h2>
      {body.dependencies.length === 0 ? <p style={muted}>—</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {body.dependencies.map((d, i) => (
            <div key={i}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13 }}>{d.title}</span>
                <span style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-muted)' }}>{t(`depType.${d.type}`)}</span>
              </div>
              <p style={{ ...muted, margin: '2px 0 0 0' }}>{d.note}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DocumentSection({ docHtml, title, t }: { docHtml: string | null; title: string; t: T }) {
  const download = () => {
    if (!docHtml) return;
    const blob = new Blob([docHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'rfp'}-proposal.html`;
    a.click();
    URL.revokeObjectURL(url);
  };
  if (!docHtml) return null;
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <h2 style={{ ...h2, margin: 0 }}>{t('sec.document')}</h2>
        <button type="button" className="btn btn-secondary btn-sm" onClick={download}>{t('downloadDoc')}</button>
      </div>
      <iframe title={t('sec.document')} srcDoc={docHtml} style={{ width: '100%', height: 520, border: '1px solid var(--border-subtle)', borderRadius: 8, background: '#fff' }} />
    </div>
  );
}

const thCell: React.CSSProperties = { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontWeight: 700, fontSize: 12 };
const tdCell: React.CSSProperties = { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-primary)', verticalAlign: 'top' };
