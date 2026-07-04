'use client';

import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import type { ToolResult, ToolMetric } from '@/lib/tools';
import { GaugeChart } from '@/components/charts/GaugeChart';
import { RadarChart } from '@/components/charts/RadarChart';

/**
 * Generic VISUALIZER for any diagnostic tool (calculator / questionnaire / quiz).
 * One layout for the whole suite, so no tool re-implements score/plan display:
 *  - a score DIAL (gauge) + level ladder for banded diagnostics, or a hero figure
 *    for calculators;
 *  - a RADAR profile of the tiered dimensions (≥3), or per-dimension tier bars;
 *  - the prioritized improvement plan.
 * Tool content (metric labels, recommendations) is backend data; only the chrome
 * headings are localized. Used by the public runner, the "from your data" panel,
 * the project score view and the workspace rollup — upgrading it lifts them all.
 */

const TIER_COLOR = ['#ef4444', '#f59e0b', '#eab308', '#3b82f6', '#22c55e'];
const tierColor = (n: number) => TIER_COLOR[Math.max(1, Math.min(5, Math.round(n))) - 1];

const card: CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16,
};

/** Compact 1..5 band ladder — where a score lands, coloured, active segment lit. */
function LevelLadder({ tier }: { tier: number }) {
  return (
    <div style={{ display: 'flex', gap: 4 }} aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          style={{
            flex: 1, height: 8, borderRadius: 4,
            background: n <= tier ? tierColor(tier) : 'var(--border-subtle)',
            opacity: n <= tier ? 1 : 0.5,
          }}
        />
      ))}
    </div>
  );
}

/** One tiered dimension rendered as a filled 0..5 bar (radar fallback / legend). */
function TierRow({ metric }: { metric: ToolMetric }) {
  const tier = metric.tier ?? 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{metric.label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-strong)', whiteSpace: 'nowrap' }}>{metric.value}</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: 'var(--border-subtle)', overflow: 'hidden' }}>
        <div style={{ width: `${(tier / 5) * 100}%`, height: '100%', borderRadius: 4, background: tierColor(tier), transition: 'width .3s' }} />
      </div>
      {metric.hint && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{metric.hint}</span>}
    </div>
  );
}

export function ToolResultView({ result }: { result: ToolResult }) {
  const t = useTranslations('tools');
  const score = result.score;
  const tiered = result.metrics.filter((m) => typeof m.tier === 'number');
  const plain = result.metrics.filter((m) => typeof m.tier !== 'number');
  const band = score != null ? Math.max(1, Math.min(5, Math.round(score))) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Hero: score dial + verdict, or calculator headline ─────────────── */}
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        {score != null ? (
          <GaugeChart
            value={score}
            min={0}
            max={5}
            size={132}
            color={tierColor(score)}
            centerValue={score.toFixed(1)}
            centerLabel={result.scoreLabel ?? t('outOf5')}
            ariaLabel={`${result.headline} — ${score.toFixed(1)} ${t('outOf5')}`}
          />
        ) : (
          <div style={{ minWidth: 120 }}>
            <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.1, color: 'var(--accent)' }}>{result.headline}</div>
          </div>
        )}
        <div style={{ flex: 1, minWidth: 220 }}>
          {score != null && <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-strong)' }}>{result.headline}</div>}
          {result.summary && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{result.summary}</div>}
          {band != null && (
            <div style={{ marginTop: 12 }}>
              <LevelLadder tier={band} />
            </div>
          )}
        </div>
      </div>

      {/* ── Profile: radar of tiered dimensions (≥3), else tier bars ───────── */}
      {tiered.length > 0 && (
        <div style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-strong)', margin: '0 0 2px' }}>{t('profileTitle')}</h3>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 14px' }}>{t('profileSubtitle')}</p>
          {tiered.length >= 3 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18, alignItems: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <RadarChart
                  axes={tiered.map((m) => ({ label: m.label, value: m.tier ?? 0 }))}
                  max={5}
                  color={score != null ? tierColor(score) : TIER_COLOR[3]}
                  ariaLabel={t('radarAria')}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {tiered.map((m) => <TierRow key={m.label} metric={m} />)}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {tiered.map((m) => <TierRow key={m.label} metric={m} />)}
            </div>
          )}
        </div>
      )}

      {/* ── Calculator / non-tiered metrics: KPI stat tiles ───────────────── */}
      {plain.length > 0 && (
        <div style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-strong)', margin: '0 0 12px' }}>{t('breakdown')}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            {plain.map((m) => (
              <div key={m.label} style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '12px 14px', background: 'var(--bg-elevated)' }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{m.label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-strong)' }}>{m.value}</div>
                {m.hint && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{m.hint}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Prioritized improvement plan ──────────────────────────────────── */}
      {result.recommendations.length > 0 && (
        <div style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-strong)', margin: '0 0 4px' }}>{t('planTitle')}</h3>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 12px' }}>{t('planSubtitle')}</p>
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {result.recommendations.map((r, i) => (
              <li key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '12px 14px', background: 'var(--bg-elevated)' }}>
                <span style={{
                  flexShrink: 0, width: 24, height: 24, borderRadius: '50%', background: 'var(--accent)', color: '#fff',
                  fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{i + 1}</span>
                <div>
                  <strong style={{ fontSize: 13, color: 'var(--text-strong)' }}>{r.title}</strong>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>{r.detail}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
