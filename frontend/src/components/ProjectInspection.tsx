'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Project } from '@/lib/types';
import { toolsApi } from '@/lib/builderforceApi';
import type { ProjectScore } from '@/lib/tools';
import {
  computeProjectInspection,
  type InspectionDimension,
  type InspectionRecommendation,
} from '@/lib/projectInspection';
import type { HealthTier } from '@/lib/projectHealth';
import { diagnosticScoreColor } from '@/lib/diagnosticScore';
import type { ProjectPanelTab } from './ProjectDetailsPanel';
import { BandedMetricBar, type MetricTier } from './charts/BandedMetricBar';
import { ProjectDiagnosticsStrip } from './ProjectDiagnosticsStrip';

/**
 * Shared "project inspection" visuals — the single source of truth for the PM
 * rating so the card strip and the slide-out report render the SAME grade,
 * dimensions and prescriptive steps from {@link computeProjectInspection}. Two
 * shapes:
 *  - {@link ProjectInspectionGrade}: a compact, clickable grade chip + dimension
 *    strip for the project card (and any dense surface).
 *  - {@link ProjectInspectionReport}: the full, prescriptive breakdown for the
 *    details panel — every dimension benchmarked, plus the "what to target" list
 *    that points each fix at the right place to make it.
 */

/** Best→worst tier order the banded bars are drawn in (matches DORA convention). */
const TIER_ORDER: HealthTier[] = ['healthy', 'watch', 'at_risk', 'critical'];
const TIER_HEX: Record<HealthTier, string> = {
  healthy: '#22c55e',
  watch: '#eab308',
  at_risk: '#f59e0b',
  critical: '#ef4444',
};

/** Index into TIER_ORDER for a dimension's tier (null → no data → all dimmed). */
function activeIndex(tier: HealthTier | null): number | null {
  return tier == null ? null : TIER_ORDER.indexOf(tier);
}

// ---------------------------------------------------------------------------
// Compact: grade chip + dimension strip (project card)
// ---------------------------------------------------------------------------

export interface ProjectInspectionGradeProps {
  project: Project;
  /** Open the full report (the details panel). Makes the strip a button. */
  onOpen?: (project: Project) => void;
}

export function ProjectInspectionGrade({ project, onOpen }: ProjectInspectionGradeProps) {
  const t = useTranslations('projectInspection');
  const insp = computeProjectInspection(project);
  const toFix = insp.recommendations.length;

  const inner = (
    <>
      <div
        aria-hidden
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          width: 40, height: 40, borderRadius: 9, flexShrink: 0,
          background: `${insp.color}22`, border: `1px solid ${insp.color}`,
        }}
      >
        <span style={{ fontSize: 18, fontWeight: 800, lineHeight: 1, color: insp.color }}>{insp.grade}</span>
        <span style={{ fontSize: 8, fontWeight: 700, color: insp.color, opacity: 0.85 }}>{insp.overall}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{t('title')}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t(`tier.${insp.tier}`)}</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {insp.dimensions.map((d) => (
            <span
              key={d.key}
              title={`${t(`dim.${d.key}.label`)}: ${d.score == null ? t('noData') : d.score}`}
              style={{
                flex: 1, height: 6, borderRadius: 999,
                background: d.score == null ? 'var(--border-subtle)' : d.color,
                opacity: d.score == null ? 0.5 : 1,
              }}
            />
          ))}
        </div>
      </div>
      {toFix > 0 && (
        <span
          style={{
            fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)',
            background: 'var(--surface-interactive)', borderRadius: 999, padding: '2px 7px',
            whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          {t('toFix', { count: toFix })}
        </span>
      )}
    </>
  );

  const baseStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 10px', margin: '2px 0',
    background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 10,
    width: '100%', textAlign: 'left',
  };

  if (!onOpen) return <div style={baseStyle}>{inner}</div>;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen(project); }}
      aria-label={t('openReportAria', { grade: insp.grade, score: insp.overall })}
      style={{ ...baseStyle, cursor: 'pointer' }}
    >
      {inner}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Full: prescriptive report (details panel)
// ---------------------------------------------------------------------------

export interface ProjectInspectionReportProps {
  project: Project;
  /** Jump to another panel tab where a fix is made (e.g. 'taskMgmt'). */
  onNavigate?: (tab: ProjectPanelTab) => void;
  /**
   * Act on a "what to target" recommendation. The owning panel decides where the
   * fix is made — switching tabs AND, for details-resident fixes (vision,
   * goals, deadline), opening the edit form and focusing the right field — so a
   * Fix that lands on the tab the report already lives on still does something.
   */
  onTargetRecommendation?: (rec: InspectionRecommendation) => void;
  /**
   * Render the overall grade + verdict block at the top of the report. Default
   * true. The details panel sets this false and renders {@link
   * ProjectInspectionSummary} on its own so the rating sits in the metrics row
   * beside the health gauges — the report below then shows only the per-dimension
   * breakdown and the prescriptive "what to target" list.
   */
  showSummary?: boolean;
}

/**
 * The overall PM grade + plain-language verdict — the "rating" tile. Shared so it
 * can render standalone (in the details-panel metrics row, next to the health
 * gauges) or as the header of {@link ProjectInspectionReport}. Fills its
 * container's height so it lines up with the gauge card beside it.
 */
export function ProjectInspectionSummary({ project }: { project: Project }) {
  const t = useTranslations('projectInspection');
  const insp = computeProjectInspection(project);
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        height: '100%', padding: 16, background: 'var(--bg-base)',
        border: `1px solid ${insp.color}`, borderRadius: 12,
      }}
    >
      <div
        aria-hidden
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          width: 64, height: 64, borderRadius: 12, flexShrink: 0,
          background: `${insp.color}22`, border: `2px solid ${insp.color}`,
        }}
      >
        <span style={{ fontSize: 30, fontWeight: 800, lineHeight: 1, color: insp.color }}>{insp.grade}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: insp.color }}>{t('outOf', { score: insp.overall })}</span>
      </div>
      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
          {t('reportTitle')}
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
          {t(`verdict.${insp.tier}`)}
        </p>
      </div>
    </div>
  );
}

export function ProjectInspectionReport({ project, onNavigate, onTargetRecommendation, showSummary = true }: ProjectInspectionReportProps) {
  const t = useTranslations('projectInspection');
  const insp = computeProjectInspection(project);

  // Saved diagnostic maturity (1–5) for THIS project — a separate, manager-gated
  // rating from the Diagnostics engine. Panel-only (single project, no N+1), and
  // best-effort: a 403 (non-manager) or "no runs yet" just hides the row.
  const [maturity, setMaturity] = useState<ProjectScore | null>(null);
  useEffect(() => {
    let live = true;
    toolsApi.projectScore(project.id)
      .then((s) => { if (live) setMaturity(s); })
      .catch(() => { if (live) setMaturity(null); });
    return () => { live = false; };
  }, [project.id]);
  const maturityScore = maturity?.result.score ?? null;

  const tiers: MetricTier[] = TIER_ORDER.map((tier) => ({
    key: tier, label: t(`tier.${tier}`), color: TIER_HEX[tier],
  }));

  const dimLabel = (d: InspectionDimension) => t(`dim.${d.key}.label`);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Overall grade + plain-language summary. Hidden when the owning surface
          renders ProjectInspectionSummary itself (details panel metrics row). */}
      {showSummary && <ProjectInspectionSummary project={project} />}

      {/* Per-dimension benchmark bars + what each one means */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {insp.dimensions.map((d) => (
          <div key={d.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <BandedMetricBar
              label={dimLabel(d)}
              valueText={d.score == null ? t('noData') : t('scoreOf', { score: d.score })}
              tiers={tiers}
              activeIndex={activeIndex(d.tier)}
              ariaLabel={t('dimAria', { name: dimLabel(d), score: d.score == null ? t('noData') : String(d.score) })}
            />
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              {t(`dim.${d.key}.desc`)}
            </p>
          </div>
        ))}
      </div>

      {/* Saved diagnostic maturity (1–5) — separate from the derived PM rating. */}
      {maturityScore != null && (
        <div
          style={{
            display: 'flex', flexDirection: 'column', gap: 8, padding: 14,
            background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{t('maturity.title')}</span>
            {maturity?.result.scoreLabel && (
              <span style={{
                fontSize: '0.7rem', fontWeight: 700, color: '#fff', background: diagnosticScoreColor(maturityScore),
                padding: '1px 8px', borderRadius: 999,
              }}>
                {maturity.result.scoreLabel}
              </span>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
              {t('maturity.outOf', { score: maturityScore })}
            </span>
          </div>
          <div style={{ height: 8, borderRadius: 999, background: 'var(--border-subtle)', overflow: 'hidden' }}>
            <div style={{ width: `${(maturityScore / 5) * 100}%`, height: '100%', background: diagnosticScoreColor(maturityScore), borderRadius: 999 }} />
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>{t('maturity.subtitle')}</p>
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('diagnostics')}
              style={{ ...recActionStyle, cursor: 'pointer', alignSelf: 'flex-start' }}
            >
              {t('maturity.viewCta')}
            </button>
          )}
        </div>
      )}

      {/* Per-diagnostic breakdown — each diagnostic run against this project (SOC 2
          readiness, Quality, …) as a score gauge + remediation status. Shares the
          projectScore fetch above so there's no extra round-trip; self-hides when
          none have been run. Clicking a gauge jumps to the Diagnostics tab. */}
      {maturity && maturity.diagnostics.length > 0 && (
        <ProjectDiagnosticsStrip
          diagnostics={maturity.diagnostics}
          variant="gauges"
          onOpen={onNavigate ? () => onNavigate('diagnostics') : undefined}
        />
      )}

      {/* Prescriptive "what to target" */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{t('whatToTarget')}</div>
        {insp.recommendations.length === 0 ? (
          <div
            style={{
              fontSize: 13, color: 'var(--text-secondary)', padding: 12,
              background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 10,
            }}
          >
            {t('allClear')}
          </div>
        ) : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {insp.recommendations.map((rec, i) => {
              const isWorkflows = rec.key === 'workflows';
              return (
                <li
                  key={rec.key}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10, padding: 12,
                    background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 10,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      flexShrink: 0, width: 22, height: 22, borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 800, color: '#fff', background: 'var(--coral-bright)',
                    }}
                  >
                    {i + 1}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
                      {t(`rec.${rec.key}.title`, rec.params ?? {})}
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                      {t(`rec.${rec.key}.detail`, rec.params ?? {})}
                    </p>
                  </div>
                  {isWorkflows ? (
                    <a
                      href={`/workflows?project=${project.id}`}
                      onClick={(e) => e.stopPropagation()}
                      style={recActionStyle}
                    >
                      {t('fixCta')}
                    </a>
                  ) : onTargetRecommendation ? (
                    <button
                      type="button"
                      onClick={() => onTargetRecommendation(rec)}
                      style={{ ...recActionStyle, cursor: 'pointer' }}
                    >
                      {t('fixCta')}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

const recActionStyle: React.CSSProperties = {
  flexShrink: 0,
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--coral-bright)',
  background: 'transparent',
  border: '1px solid var(--coral-bright)',
  borderRadius: 8,
  padding: '4px 10px',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
};
