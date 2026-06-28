'use client';

/**
 * DevEx survey visuals — pure SVG / CSS chart primitives for the DevEx results
 * lens (no charting dependency, matching the BurnChart pattern). Each component
 * owns its own i18n via useTranslations('insights') and is theme-aware (CSS vars
 * for chrome; fixed dark text on the soft score tiles, which are always light).
 *
 * Building blocks:  scoreColor, DeltaChip, SentimentBar, ScoreRing
 * Visuals:          DevexIndexCard, TopicTable, SegmentHeatmap,
 *                   ParticipationChart, ParticipationBySegment, PrioritiesSlope,
 *                   BenchmarkModal
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type {
  BenchmarkPercentile, DevexDimension, DevexDimensionScore, DevexDimensionSentiment,
  DevexDimensionTrendPoint, DevexParticipationPoint, DevexSegmentCount, DevexSegmentKind,
  DevexSegmentScoreRow,
} from '@/lib/devexApi';
import { DEVEX_SEGMENT_KINDS } from '@/lib/devexApi';
import { PmCard } from '@/components/pm/pmShared';

// ── Shared helpers ───────────────────────────────────────────────────────────

/** Soft red→amber→green tile colour for a 0..100 score (35→red, 85→green). */
export function scoreColor(score: number): string {
  const t = Math.max(0, Math.min(1, (score - 35) / 50));
  const h = 8 + t * 137;
  const l = 88 - t * 20;
  return `hsl(${h.toFixed(0)}, 55%, ${l.toFixed(0)}%)`;
}

/** Fixed dark ink for the light score tiles (legible in both themes). */
const TILE_INK = '#16241c';

/** Distinct line colours per dimension for the slope chart. */
const DIM_COLORS: Record<DevexDimension, string> = {
  flow: '#dc2626', tooling: '#2563eb', ai_tools: '#7c3aed', deep_work: '#d97706',
  build_test: '#059669', docs: '#db2777', sentiment: '#0891b2',
};

function fmtDelta(n: number): string {
  const r = Math.round(n * 10) / 10;
  const v = Number.isInteger(r) ? String(Math.abs(r)) : Math.abs(r).toFixed(1);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${v}`;
}

/** Compact duration: mm:ss under an hour, then Hh Mm, then Dd Hh. */
export function fmtDuration(sec: number | null): string {
  if (sec == null) return '—';
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  if (sec < 86_400) return `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86_400)}d ${Math.round((sec % 86_400) / 3600)}h`;
}

/**
 * A trend/benchmark delta chip with arrow + colour. `goodIsUp` (default true)
 * colours positive deltas green; null renders a muted dash.
 */
export function DeltaChip({ value, goodIsUp = true, title }: { value: number | null; goodIsUp?: boolean; title?: string }) {
  if (value == null) return <span style={{ color: 'var(--text-muted)' }} title={title}>—</span>;
  const flat = Math.abs(value) < 0.05;
  const good = goodIsUp ? value > 0 : value < 0;
  const color = flat ? 'var(--text-muted)' : good ? '#16a34a' : '#dc2626';
  const arrow = flat ? '→' : value > 0 ? '↗' : '↘';
  return (
    <span style={{ color, fontWeight: 600, fontSize: '0.82rem', whiteSpace: 'nowrap' }} title={title}>
      {fmtDelta(value)} {arrow}
    </span>
  );
}

/** Diverging negative / neutral / positive bar for a dimension's score split. */
export function SentimentBar({ sentiment }: { sentiment: DevexDimensionSentiment }) {
  const total = sentiment.negative + sentiment.neutral + sentiment.positive;
  if (total === 0) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const seg = (n: number, bg: string) =>
    n > 0 ? <div style={{ width: `${(n / total) * 100}%`, background: bg, height: '100%' }} /> : null;
  return (
    <div style={{ display: 'flex', width: 160, height: 12, borderRadius: 4, overflow: 'hidden', background: 'var(--border-subtle)' }}>
      {seg(sentiment.negative, '#d9776b')}
      {seg(sentiment.neutral, '#cbd0d6')}
      {seg(sentiment.positive, '#3f9e6f')}
    </div>
  );
}

/** A donut score ring (0..100) with the score centred. */
export function ScoreRing({ score, size = 84 }: { score: number; size?: number }) {
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const color = scoreColor(score);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${Math.round(score)}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border-subtle)" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${(c * pct).toFixed(1)} ${c.toFixed(1)}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontSize={size * 0.3} fontWeight={700} fill="var(--text-primary)">
        {Math.round(score)}
      </text>
    </svg>
  );
}

// ── DevEx Index card ─────────────────────────────────────────────────────────

export function DevexIndexCard({
  score, trendDelta, benchmarkDelta, percentile,
}: { score: number; trendDelta: number | null; benchmarkDelta: number | null; percentile: BenchmarkPercentile }) {
  const t = useTranslations('insights');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 20 }}>
      <ScoreRing score={score} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>{t('devex.index')}</div>
        <div style={{ display: 'flex', gap: 18, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          <span style={{ display: 'inline-flex', gap: 6 }}>{t('devex.trendLabel')} <DeltaChip value={trendDelta} /></span>
          <span style={{ display: 'inline-flex', gap: 6 }}>{t('devex.benchmark')} <DeltaChip value={benchmarkDelta} title={t('devex.vsBenchmark', { n: percentile })} /></span>
        </div>
      </div>
    </div>
  );
}

// ── Topic table ──────────────────────────────────────────────────────────────

export function TopicTable({ rows, dimLabel }: { rows: DevexDimensionScore[]; dimLabel: (d: DevexDimension) => string }) {
  const t = useTranslations('insights');
  if (rows.length === 0) return <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('devex.noData')}</span>;
  const th: React.CSSProperties = { padding: '10px 12px', fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'left', fontSize: '0.8rem' };
  const td: React.CSSProperties = { padding: '10px 12px', fontSize: '0.86rem' };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <th style={th}>{t('devex.rank')}</th>
            <th style={th}>{t('devex.topic')}</th>
            <th style={th}>{t('devex.score')}</th>
            <th style={th}>{t('devex.trendLabel')}</th>
            <th style={th}>{t('devex.benchmark')}</th>
            <th style={th}>{t('devex.questions')}</th>
            <th style={th}>{t('devex.sentiment')}</th>
            <th style={th}>{t('devex.comments')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.dimension} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <td style={{ ...td, color: 'var(--text-muted)' }}>#{r.rank}</td>
              <td style={{ ...td, fontWeight: 600 }}>{dimLabel(r.dimension)}</td>
              <td style={td}>
                <span style={{ display: 'inline-block', minWidth: 34, textAlign: 'center', padding: '2px 8px', borderRadius: 6, background: scoreColor(r.avgScore), color: TILE_INK, fontWeight: 700 }}>
                  {Math.round(r.avgScore)}
                </span>
              </td>
              <td style={td}><DeltaChip value={r.trendDelta} /></td>
              <td style={td}><DeltaChip value={r.benchmarkDelta} /></td>
              <td style={{ ...td, color: 'var(--text-secondary)' }}>{r.questionCount}</td>
              <td style={td}><SentimentBar sentiment={r.sentiment} /></td>
              <td style={{ ...td, color: 'var(--text-secondary)' }}>{r.commentCount > 0 ? `${r.commentCount} 💬` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Segment heatmap ──────────────────────────────────────────────────────────

function SegmentKindToggle({ value, onChange, available }: { value: DevexSegmentKind; onChange: (k: DevexSegmentKind) => void; available: DevexSegmentKind[] }) {
  const t = useTranslations('insights');
  return (
    <div style={{ display: 'inline-flex', border: '1px solid var(--border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
      {DEVEX_SEGMENT_KINDS.map((k) => {
        const on = k === value;
        const enabled = available.includes(k);
        return (
          <button
            key={k} type="button" disabled={!enabled} onClick={() => onChange(k)}
            style={{
              padding: '6px 14px', border: 'none', cursor: enabled ? 'pointer' : 'not-allowed',
              background: on ? 'var(--accent, #2563eb)' : 'transparent',
              color: on ? '#fff' : enabled ? 'var(--text-primary)' : 'var(--text-muted)',
              fontSize: '0.8rem', fontWeight: 600,
            }}
          >
            {t(`devex.segmentKind.${k}`)}
          </button>
        );
      })}
    </div>
  );
}

export function SegmentHeatmap({
  byKind, everyone, columns, threshold, dimLabel,
}: {
  byKind: Partial<Record<DevexSegmentKind, DevexSegmentScoreRow[]>>;
  everyone: DevexDimensionScore[];
  columns: DevexDimension[];
  threshold: number;
  dimLabel: (d: DevexDimension) => string;
}) {
  const t = useTranslations('insights');
  const available = DEVEX_SEGMENT_KINDS.filter((k) => (byKind[k]?.length ?? 0) > 0);
  const [kind, setKind] = useState<DevexSegmentKind>(available[0] ?? 'group');
  const rows = byKind[kind] ?? [];

  const cell = (score: number | undefined): React.CSSProperties => ({
    padding: '10px 6px', textAlign: 'center', fontSize: '0.82rem', fontWeight: 600,
    color: score == null ? 'var(--text-muted)' : TILE_INK,
    background: score == null ? 'transparent' : scoreColor(score),
    borderRadius: 6,
  });
  const everyoneByDim = new Map(everyone.map((d) => [d.dimension, d.avgScore]));
  const everyoneOverall = everyone.length ? Math.round(everyone.reduce((a, d) => a + d.avgScore, 0) / everyone.length) : 0;

  return (
    <PmCard
      title={t('devex.segmentsTitle')}
      action={available.length > 0 ? <SegmentKindToggle value={kind} onChange={setKind} available={available} /> : undefined}
    >
      {available.length === 0 ? (
        <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('devex.noSegments')}</span>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 4, width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', fontSize: '0.72rem', color: 'var(--text-muted)' }} />
                {columns.map((d) => (
                  <th key={d} style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', fontWeight: 600, padding: '0 4px', whiteSpace: 'nowrap' }}>
                    {dimLabel(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ fontSize: '0.8rem', fontWeight: 700, whiteSpace: 'nowrap', paddingRight: 8 }}>
                  {t('devex.everyone')} <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{everyoneOverall}</span>
                </td>
                {columns.map((d) => {
                  const s = everyoneByDim.get(d);
                  return <td key={d} style={cell(s)}>{s == null ? '—' : Math.round(s)}</td>;
                })}
              </tr>
              {rows.map((seg) => (
                <tr key={seg.label}>
                  <td style={{ fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap', paddingRight: 8 }}>
                    {seg.label} <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{seg.n} 👤</span>
                  </td>
                  {columns.map((d) => {
                    const s = seg.scores[d];
                    return <td key={d} style={cell(s)}>{s == null ? '—' : Math.round(s)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AnonymityNote threshold={threshold} />
    </PmCard>
  );
}

/** Shared anonymity-threshold disclosure used by the heatmap + participation. */
export function AnonymityNote({ threshold }: { threshold: number }) {
  const t = useTranslations('insights');
  return (
    <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 8, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
      <span style={{ fontWeight: 600 }}>🛡 {t('devex.anonymityTitle', { n: threshold })}</span>
      <div style={{ marginTop: 4 }}>{t('devex.anonymityBody', { n: threshold })}</div>
    </div>
  );
}

// ── Participation ────────────────────────────────────────────────────────────

export function ParticipationChart({ timeline }: { timeline: DevexParticipationPoint[] }) {
  const t = useTranslations('insights');
  if (timeline.length < 2) return <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('devex.noParticipation')}</span>;
  const W = 680, H = 220, PAD = 30;
  const max = Math.max(1, timeline[timeline.length - 1]!.cumulative);
  const x = (i: number) => PAD + (i / (timeline.length - 1)) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - (v / max) * (H - 2 * PAD);
  const line = timeline.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.cumulative).toFixed(1)}`).join(' ');
  const area = `${line} L${x(timeline.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={t('devex.participationAria')} style={{ maxWidth: '100%' }}>
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--border-subtle)" />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="var(--border-subtle)" />
      <path d={area} fill="#2563eb22" stroke="none" />
      <path d={line} fill="none" stroke="#2563eb" strokeWidth={2} />
      <text x={PAD} y={PAD - 10} fontSize={11} fill="var(--text-muted)">{max}</text>
      <text x={PAD} y={H - 8} fontSize={10} fill="var(--text-muted)">{timeline[0]!.date.slice(5)}</text>
      <text x={W - PAD} y={H - 8} fontSize={10} fill="var(--text-muted)" textAnchor="end">{timeline[timeline.length - 1]!.date.slice(5)}</text>
    </svg>
  );
}

export function ParticipationBySegment({ bySegment }: { bySegment: Partial<Record<DevexSegmentKind, DevexSegmentCount[]>> }) {
  const t = useTranslations('insights');
  const available = DEVEX_SEGMENT_KINDS.filter((k) => (bySegment[k]?.length ?? 0) > 0);
  const [kind, setKind] = useState<DevexSegmentKind>(available[0] ?? 'group');
  if (available.length === 0) return null;
  const rows = bySegment[kind] ?? [];
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <PmCard title={t('devex.participationBySegment')} action={<SegmentKindToggle value={kind} onChange={setKind} available={available} />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((r) => (
          <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 90, fontSize: '0.8rem', textAlign: 'right', color: 'var(--text-secondary)' }}>{r.label}</span>
            <div style={{ flex: 1, height: 14, background: 'var(--border-subtle)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${(r.count / max) * 100}%`, height: '100%', background: '#2563eb' }} />
            </div>
            <span style={{ width: 32, fontSize: '0.8rem', fontWeight: 600 }}>{r.count}</span>
          </div>
        ))}
      </div>
    </PmCard>
  );
}

// ── Priorities slope chart ───────────────────────────────────────────────────

export function PrioritiesSlope({ points, dimensions, dimLabel }: {
  points: DevexDimensionTrendPoint[];
  dimensions: DevexDimension[];
  dimLabel: (d: DevexDimension) => string;
}) {
  const t = useTranslations('insights');
  if (points.length < 2) return <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('devex.noPriorities')}</span>;
  const W = 720, H = 40 + dimensions.length * 42, PADL = 40, PADR = 190, PADT = 24, PADB = 36;
  const maxRank = dimensions.length;
  const x = (i: number) => PADL + (i / (points.length - 1)) * (W - PADL - PADR);
  const y = (rank: number) => PADT + ((rank - 1) / Math.max(1, maxRank - 1)) * (H - PADT - PADB);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={t('devex.prioritiesAria')} style={{ maxWidth: '100%' }}>
      {/* rank gridlines + labels */}
      {Array.from({ length: maxRank }, (_, i) => i + 1).map((rank) => (
        <g key={rank}>
          <line x1={PADL} y1={y(rank)} x2={W - PADR} y2={y(rank)} stroke="var(--border-subtle)" strokeDasharray="2 4" />
          <text x={PADL - 8} y={y(rank)} fontSize={10} fill="var(--text-muted)" textAnchor="end" dominantBaseline="central">#{rank}</text>
        </g>
      ))}
      {/* one line per dimension across periods */}
      {dimensions.map((d) => {
        const segs = points
          .map((p, i) => ({ i, rank: p.ranks[d] }))
          .filter((s): s is { i: number; rank: number } => s.rank != null);
        if (segs.length < 2) return null;
        const path = segs.map((s, j) => `${j === 0 ? 'M' : 'L'}${x(s.i).toFixed(1)},${y(s.rank).toFixed(1)}`).join(' ');
        const last = segs[segs.length - 1]!;
        const color = DIM_COLORS[d];
        return (
          <g key={d}>
            <path d={path} fill="none" stroke={color} strokeWidth={2} />
            {segs.map((s) => <circle key={s.i} cx={x(s.i)} cy={y(s.rank)} r={3.5} fill={color} />)}
            <text x={W - PADR + 8} y={y(last.rank)} fontSize={11} fill="var(--text-primary)" dominantBaseline="central">{dimLabel(d)}</text>
          </g>
        );
      })}
      {/* period labels */}
      {points.map((p, i) => (
        <text key={p.periodMonth} x={x(i)} y={H - 10} fontSize={10} fill="var(--text-muted)" textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>
          {p.periodMonth}
        </text>
      ))}
    </svg>
  );
}

// ── Benchmark modal ──────────────────────────────────────────────────────────

const PERCENTILES: BenchmarkPercentile[] = [50, 75, 90];

export function BenchmarkModal({
  percentile, companies, onApply, onClose,
}: { percentile: BenchmarkPercentile; companies: number; onApply: (p: BenchmarkPercentile) => void; onClose: () => void }) {
  const t = useTranslations('insights');
  const [sel, setSel] = useState<BenchmarkPercentile>(percentile);
  return (
    <div
      role="dialog" aria-modal="true" aria-label={t('devex.benchmarkModalTitle')}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: 24, width: 'min(560px, 92vw)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700 }}>{t('devex.benchmarkModalTitle')}</h3>
          <button type="button" onClick={onClose} aria-label={t('common.close')} style={{ background: 'transparent', border: 'none', fontSize: '1.3rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>×</button>
        </div>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('devex.percentile')}</div>
        <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', marginTop: 0 }}>{t('devex.percentileQuestion')}</p>
        <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
          {PERCENTILES.map((p) => (
            <button
              key={p} type="button" onClick={() => setSel(p)}
              style={{
                padding: '10px 22px', borderRadius: 10, cursor: 'pointer', fontWeight: 600,
                border: `1.5px solid ${sel === p ? 'var(--accent, #7c3aed)' : 'var(--border-subtle)'}`,
                background: sel === p ? 'color-mix(in srgb, var(--accent, #7c3aed) 12%, transparent)' : 'transparent',
                color: 'var(--text-primary)',
              }}
            >
              {t('devex.percentileOption', { n: p })}
            </button>
          ))}
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t('devex.benchmarkFootnote', { companies })}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}>{t('common.cancel')}</button>
          <button type="button" onClick={() => onApply(sel)} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--accent, #7c3aed)', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>{t('devex.setBenchmark')}</button>
        </div>
      </div>
    </div>
  );
}
