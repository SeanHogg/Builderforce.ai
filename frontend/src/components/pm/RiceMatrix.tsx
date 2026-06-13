'use client';

import { useMemo } from 'react';
import { scaleLinear } from 'd3-scale';
import { segmentTrackerClient, type TrackerRow } from '@/lib/builderforceApi';
import { usePmScope } from '@/lib/pm/scope';
import { usePmData } from '@/lib/pm/usePmData';
import { PmEmpty, PmError } from './pmShared';

/**
 * RICE prioritisation matrix — a reach × impact scatter where bubble size encodes
 * effort and the fill encodes the computed RICE score. The top-right (high reach,
 * high impact) is "do first". Pure SVG via d3-scale (no chart lib dependency).
 */
const riceClient = segmentTrackerClient('/api/agile/feature-scoring');

const W = 720;
const H = 440;
const M = { top: 20, right: 24, bottom: 48, left: 56 };

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function RiceMatrix() {
  const { projectId } = usePmScope();
  const { data, error } = usePmData<TrackerRow[]>(
    () => riceClient.list(projectId ?? undefined),
    [projectId],
  );

  const points = useMemo(
    () =>
      (data ?? []).map((r) => ({
        id: String(r.id),
        name: typeof r.name === 'string' ? r.name : '(unnamed)',
        reach: num(r.reach),
        impact: num(r.impact),
        effort: Math.max(num(r.effort), 0),
        score: num(r.score),
      })),
    [data],
  );

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message="Loading RICE scores…" />;
  if (!points.length) return <PmEmpty message="No RICE-scored items yet. Score items in the feature-scoring tracker to see prioritisation here." />;

  const maxReach = Math.max(...points.map((p) => p.reach), 1);
  const maxImpact = Math.max(...points.map((p) => p.impact), 1);
  const maxEffort = Math.max(...points.map((p) => p.effort), 1);
  const maxScore = Math.max(...points.map((p) => p.score), 1);

  const x = scaleLinear().domain([0, maxReach]).range([M.left, W - M.right]).nice();
  const y = scaleLinear().domain([0, maxImpact]).range([H - M.bottom, M.top]).nice();
  const r = scaleLinear().domain([0, maxEffort]).range([6, 26]);

  const fill = (score: number) => {
    const t = maxScore ? score / maxScore : 0;
    // low → grey-blue, high → coral
    return `rgb(${Math.round(120 + 135 * t)}, ${Math.round(120 - 40 * t)}, ${Math.round(180 - 120 * t)})`;
  };

  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="RICE matrix: reach versus impact, bubble size is effort">
        {/* axes */}
        <line x1={M.left} y1={H - M.bottom} x2={W - M.right} y2={H - M.bottom} stroke="var(--border-subtle)" />
        <line x1={M.left} y1={M.top} x2={M.left} y2={H - M.bottom} stroke="var(--border-subtle)" />
        {x.ticks(6).map((t) => (
          <g key={`x${t}`}>
            <line x1={x(t)} y1={H - M.bottom} x2={x(t)} y2={H - M.bottom + 5} stroke="var(--text-muted)" />
            <text x={x(t)} y={H - M.bottom + 18} textAnchor="middle" fontSize={11} fill="var(--text-muted)">{t}</text>
          </g>
        ))}
        {y.ticks(6).map((t) => (
          <g key={`y${t}`}>
            <line x1={M.left - 5} y1={y(t)} x2={M.left} y2={y(t)} stroke="var(--text-muted)" />
            <text x={M.left - 8} y={y(t) + 3} textAnchor="end" fontSize={11} fill="var(--text-muted)">{t}</text>
          </g>
        ))}
        <text x={(M.left + W - M.right) / 2} y={H - 8} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--text-secondary)">Reach →</text>
        <text x={-(M.top + H - M.bottom) / 2} y={16} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--text-secondary)" transform="rotate(-90)">Impact →</text>

        {/* bubbles */}
        {points.map((p) => (
          <g key={p.id}>
            <circle cx={x(p.reach)} cy={y(p.impact)} r={r(p.effort)} fill={fill(p.score)} fillOpacity={0.6} stroke={fill(p.score)} strokeWidth={1.5}>
              <title>{`${p.name}\nreach ${p.reach} · impact ${p.impact} · effort ${p.effort} · RICE ${p.score.toFixed(1)}`}</title>
            </circle>
            <text x={x(p.reach)} y={y(p.impact) - r(p.effort) - 3} textAnchor="middle" fontSize={10} fill="var(--text-secondary)">{p.name}</text>
          </g>
        ))}
      </svg>
      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 8 }}>
        Bubble size = effort · color intensity = RICE score · top-right = do first.
      </div>
    </div>
  );
}
