'use client';

/**
 * Reusable Ishikawa "fishbone" / 5-Why cause-and-effect diagram — the visual answer
 * to "why did this occur?". The effect (the problem being analysed) sits in the fish
 * HEAD on the right; contributing-cause categories branch off the spine as BONES,
 * each carrying its individual causes as twigs. Pure SVG (matches the hand-rolled
 * chart-primitive convention — no charting lib), theme-driven and responsive.
 *
 * General-purpose: any root-cause analysis (incident RCA, a missed milestone, a
 * quality regression) can render its causal structure here. Presentation-only — the
 * caller supplies already-localized strings, mirroring DonutChart / TrendChart.
 */

import { colorAt } from './chartColors';

export interface FishboneCategory {
  /** The bone label — a cause category (e.g. "Root cause", "People", "Process"). */
  label: string;
  /** Individual causes hanging off this bone (twigs). Capped/truncated for legibility. */
  causes: string[];
}

export interface FishboneChartProps {
  /** The effect under analysis — rendered in the fish head. */
  problem: string;
  /** Cause categories → bones. Up to 6 render; alternate above/below the spine. */
  categories: FishboneCategory[];
  /** Accessible description; falls back to a generated summary. */
  ariaLabel?: string;
}

const VBW = 960;
const VBH = 420;
const SPINE_Y = VBH / 2;
const HEAD_W = 190;
const SPINE_X0 = 44;
const SPINE_X1 = VBW - HEAD_W - 8;
const BONE_RISE = 128;
const MAX_CATS = 6;
const MAX_CAUSES = 4;

function truncate(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export function FishboneChart({ problem, categories, ariaLabel }: FishboneChartProps) {
  const cats = categories.filter((c) => c.label.trim()).slice(0, MAX_CATS);
  const summary =
    ariaLabel ??
    `Fishbone diagram for "${problem}": ${cats.map((c) => `${c.label} (${c.causes.length})`).join(', ')}`;

  // Distribute bone attach-points evenly along the spine, right→left, alternating
  // above / below so the diagram stays balanced regardless of category count.
  const n = Math.max(cats.length, 1);
  const usable = SPINE_X1 - SPINE_X0 - 60;
  const step = usable / (n + 1);

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg
        viewBox={`0 0 ${VBW} ${VBH}`}
        width="100%"
        role="img"
        aria-label={summary}
        style={{ minWidth: 520, display: 'block' }}
      >
        <title>{summary}</title>

        {/* Spine + arrowhead into the head */}
        <line x1={SPINE_X0} y1={SPINE_Y} x2={SPINE_X1} y2={SPINE_Y} stroke="var(--text-secondary)" strokeWidth={2.5} />
        <polygon
          points={`${SPINE_X1},${SPINE_Y - 8} ${SPINE_X1 + 14},${SPINE_Y} ${SPINE_X1},${SPINE_Y + 8}`}
          fill="var(--text-secondary)"
        />

        {/* Fish head — the effect under analysis */}
        <g>
          <rect
            x={VBW - HEAD_W} y={SPINE_Y - 54} width={HEAD_W} height={108} rx={12}
            fill="var(--danger, #dc2626)" fillOpacity={0.14}
            stroke="var(--danger, #dc2626)" strokeWidth={1.5}
          />
          {wrap(problem, 22, 3).map((line, i, arr) => (
            <text
              key={i}
              x={VBW - HEAD_W / 2}
              y={SPINE_Y - (arr.length - 1) * 8 + i * 16}
              textAnchor="middle"
              fontSize={13}
              fontWeight={700}
              fill="var(--text-primary)"
            >
              {line}
            </text>
          ))}
        </g>

        {/* Bones */}
        {cats.map((cat, i) => {
          const color = colorAt(i);
          const attachX = SPINE_X0 + 30 + step * (i + 1);
          const up = i % 2 === 0;
          const tipX = attachX - 96;
          const tipY = SPINE_Y + (up ? -BONE_RISE : BONE_RISE);
          const labelY = up ? tipY - 10 : tipY + 18;
          return (
            <g key={`${cat.label}-${i}`}>
              <line x1={attachX} y1={SPINE_Y} x2={tipX} y2={tipY} stroke={color} strokeWidth={2.5} />
              {/* Category label at the bone tip */}
              <text x={tipX - 4} y={labelY} textAnchor="start" fontSize={13} fontWeight={700} fill={color}>
                {truncate(cat.label, 26)}
              </text>
              {/* Cause twigs, stacked outward from the tip */}
              {cat.causes.slice(0, MAX_CAUSES).map((cause, j) => {
                const cy = up ? labelY - 16 - j * 16 : labelY + 16 + j * 16;
                return (
                  <text key={j} x={tipX + 6} y={cy} textAnchor="start" fontSize={11} fill="var(--text-secondary)">
                    • {truncate(cause, 30)}
                  </text>
                );
              })}
              {cat.causes.length > MAX_CAUSES && (
                <text
                  x={tipX + 6}
                  y={up ? labelY - 16 - MAX_CAUSES * 16 : labelY + 16 + MAX_CAUSES * 16}
                  fontSize={11}
                  fill="var(--text-muted)"
                >
                  +{cat.causes.length - MAX_CAUSES}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Naive greedy word-wrap for SVG text (no measurement) — caps at `maxLines`. */
function wrap(text: string, perLine: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > perLine) {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length >= maxLines) break;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = truncate(lines[maxLines - 1] + '…', perLine);
  }
  return lines.length ? lines : [text];
}
