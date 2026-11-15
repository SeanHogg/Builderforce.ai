'use client';

/**
 * PROJECT ANALYTICS — the single consolidated Analytics surface (consolidate
 * Analytics with Diagnostics: the tab stays "Analytics", the diagnostics
 * capabilities are retained on the same page).
 *
 * One panel composes the four signals that used to live in separate places:
 *   1. Health pulse    — overall grade + progress + the highest-impact gaps as
 *                        actionable insights (Project 360, gaps as insights).
 *   2. Dimensions      — the five 0–100 dimension bars in one compact strip.
 *   3. What changed    — the project's run deltas (health measured per run).
 *   4. What it cost    — the project spend widget.
 *   5. Diagnostics     — the project's per-diagnostic latest scores + findings,
 *                        with Run / Results, plus a link into the full hub.
 *
 * Every leaf is the SAME component / API client another surface renders, so
 * this page is composition, not reinvention: health → Project360, run deltas →
 * ProjectRunDeltas, cost → ProjectSpendWidget, diagnostics → toolsApi.projectScore.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Project360 } from '@seanhogg/builderforce-brain-ui';
import { toolsApi } from '@/lib/builderforceApi';
import { getProject360 } from '@/lib/project360Api';
import type { ProjectDiagnostic } from '@/lib/tools';
import { useFormat } from '@/i18n/useFormat';
import { ProjectHealthPanel } from './ProjectHealthPanel';
import { ProjectSpendWidget } from './ProjectSpendWidget';
import { ProjectRunDeltas } from '@/components/runDelta/ProjectRunDeltas';

const card: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};

const SEV_ORDER = { high: 0, medium: 1, low: 2 } as const;

export function ProjectAnalyticsPanel({ projectId }: { projectId: number }) {
  const t = useTranslations('projectAnalytics');
  const fmt = useFormat();
  const [health, setHealth] = useState<Project360 | null>(null);
  const [diagnostics, setDiagnostics] = useState<ProjectDiagnostic[]>([]);
  const [diagLoading, setDiagLoading] = useState(true);

  const loadHealth = useCallback(async () => {
    try {
      setHealth(await getProject360(projectId));
    } catch {
      setHealth(null); // health is best-effort here; the dedicated panel surfaces faults
    }
  }, [projectId]);

  const loadDiagnostics = useCallback(async () => {
    setDiagLoading(true);
    try {
      const score = await toolsApi.projectScore(projectId);
      setDiagnostics(score.diagnostics ?? []);
    } catch {
      setDiagnostics([]); // diagnostics are optional; a failure hides the strip, not the page
    } finally {
      setDiagLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadHealth();
    void loadDiagnostics();
  }, [loadHealth, loadDiagnostics]);

  // The insights strip shows the highest-severity gaps as one-line actions.
  const insights = (health?.gaps ?? [])
    .slice()
    .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity])
    .slice(0, 4);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16 }}>
      {/* Health pulse + insights — the headline a reader came for. */}
      {health?.hasData && (
        <section style={card} aria-label={t('pulse')}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 24,
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
              <div>
                <div
                  style={{
                    fontSize: 'var(--font-size-section)',
                    fontWeight: 700,
                    color: health.overall.color,
                    lineHeight: 1,
                  }}
                >
                  {health.overall.score}
                  <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>/100</span>
                </div>
                <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>
                  {t('overall')}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 'var(--font-size-section)', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {health.overall.progressPct}%
                </div>
                <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>
                  {t('progress')}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>
              {t('updated', { time: fmt.dateTime(health.generatedAt) })}
            </div>
          </div>

          {insights.length > 0 && (
            <ul style={{ listStyle: 'none', margin: '14px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {insights.map((g) => (
                <li
                  key={g.id}
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'baseline',
                    fontSize: 'var(--font-size-small)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      flexShrink: 0,
                      alignSelf: 'center',
                      background:
                        g.severity === 'high'
                          ? 'var(--status-bad, #e5484d)'
                          : g.severity === 'medium'
                            ? 'var(--status-warn, #f5a524)'
                            : 'var(--status-good, #30a46c)',
                    }}
                  />
                  <span style={{ minWidth: 0 }}>
                    <b style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{g.title}</b>
                    {g.detail ? ` — ${g.detail}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Dimensions — five 0–100 bars in one strip. */}
      {health?.hasData && health.dimensions.length > 0 && (
        <section style={card} aria-label={t('dimensions')}>
          <h2 style={{ fontSize: 'var(--font-size-small)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            {t('dimensions')}
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '10px 20px',
              marginTop: 12,
            }}
          >
            {health.dimensions.map((d) => (
              <div key={d.key}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 'var(--font-size-eyebrow)',
                    color: 'var(--text-muted)',
                    marginBottom: 4,
                  }}
                >
                  <span style={{ color: 'var(--text-primary)' }}>{d.label}</span>
                  <span>
                    {d.score}
                    <span style={{ color: 'var(--text-muted)' }}>/100</span>
                  </span>
                </div>
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: 'var(--surface-interactive, var(--border-subtle))',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ height: '100%', width: `${d.score}%`, background: d.color, borderRadius: 3 }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Diagnostics scoreboard — per-diagnostic latest score + findings, retained here. */}
      <section style={card} aria-label={t('diagnostics')}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h2 style={{ fontSize: 'var(--font-size-small)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            {t('diagnostics')}
          </h2>
          <Link
            href="/tools"
            style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--accent)', textDecoration: 'none' }}
          >
            {t('openHub')} →
          </Link>
        </div>

        {diagLoading ? (
          <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: '12px 0 0' }}>
            {t('loading')}
          </p>
        ) : diagnostics.length === 0 ? (
          <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: '12px 0 0' }}>
            {t('noDiagnostics')}
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {diagnostics.map((d) => (
              <li
                key={d.toolId}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 10,
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderTop: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
                  <span aria-hidden style={{ fontSize: 'var(--font-size-body)' }}>
                    {d.icon}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {d.name}
                    </div>
                    <div
                      style={{
                        fontSize: 'var(--font-size-eyebrow)',
                        color: 'var(--text-muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {d.headline}
                      {d.gapCount > 0 ? ` · ${t('gaps', { count: d.gapCount })}` : ''}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 'var(--font-size-small)', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {d.score != null ? d.score : '—'}
                      {d.score != null && (
                        <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>/100</span>
                      )}
                    </div>
                    <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>
                      {d.scoreLabel ?? (d.createdAt ? fmt.dateTime(d.createdAt) : '')}
                    </div>
                  </div>
                  <Link
                    href={`/tools?tool=${encodeURIComponent(d.toolId)}`}
                    style={{
                      fontSize: 'var(--font-size-eyebrow)',
                      color: 'var(--accent)',
                      textDecoration: 'none',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {d.score != null ? t('results') : t('run')} →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* What the project's agent runs changed, over time (health per run). */}
      <ProjectRunDeltas projectId={projectId} />

      {/* Cost — "is this healthy" and "what is it costing" are the same question. */}
      <ProjectSpendWidget projectId={projectId} />

      {/* The full, interactive health wheel + workforce (retained below the fold). */}
      <ProjectHealthPanel projectId={projectId} />
    </div>
  );
}
