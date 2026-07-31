import type { Project360Dimension, Project360Pillar } from './types';

/**
 * The Project 360 wheel — a two-ring sunburst. Inner ring = the four pillars,
 * outer ring = their eight dimensions (two per pillar, aligned above it), each
 * arc coloured by its health tier. The centre shows the overall score. Presentational
 * only: it takes the model + a selection callback and draws SVG (no chart library),
 * themed via `--bf-*` variables + the tier colours the API already resolved.
 */

export interface SunburstProps {
  pillars: Project360Pillar[];
  dimensions: Project360Dimension[];
  overall: { score: number; color: string };
  selected?: string | null;
  onSelect?: (dimensionKey: string | null) => void;
  ariaLabel?: string;
}

const CX = 160;
const CY = 160;
const R_CENTER = 46;
const R_INNER_0 = 48; // pillar ring
const R_INNER_1 = 96;
const R_OUTER_0 = 100; // dimension ring
const R_OUTER_1 = 150;

function polar(r: number, angleDeg: number): [number, number] {
  const a = ((angleDeg - 90) * Math.PI) / 180; // 0° at top, clockwise
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

/** Annular sector path from `startDeg`→`endDeg` (clockwise) between two radii. */
function sector(rInner: number, rOuter: number, startDeg: number, endDeg: number): string {
  const large = endDeg - startDeg > 180 ? 1 : 0;
  const [ox0, oy0] = polar(rOuter, startDeg);
  const [ox1, oy1] = polar(rOuter, endDeg);
  const [ix1, iy1] = polar(rInner, endDeg);
  const [ix0, iy0] = polar(rInner, startDeg);
  return [
    `M${ox0.toFixed(2)},${oy0.toFixed(2)}`,
    `A${rOuter},${rOuter} 0 ${large} 1 ${ox1.toFixed(2)},${oy1.toFixed(2)}`,
    `L${ix1.toFixed(2)},${iy1.toFixed(2)}`,
    `A${rInner},${rInner} 0 ${large} 0 ${ix0.toFixed(2)},${iy0.toFixed(2)}`,
    'Z',
  ].join(' ');
}

function labelAt(r: number, angleDeg: number): { x: number; y: number } {
  const [x, y] = polar(r, angleDeg);
  return { x, y };
}

/** Split a label onto two lines if it is long, so it fits inside a 45° arc. */
function twoLines(label: string): string[] {
  if (label.length <= 9) return [label];
  const mid = label.indexOf(' ', Math.floor(label.length / 2) - 3);
  if (mid > 0) return [label.slice(0, mid), label.slice(mid + 1)];
  return [label];
}

export function Sunburst({ pillars, dimensions, overall, selected, onSelect, ariaLabel }: SunburstProps) {
  const nPillars = pillars.length || 1;
  const pillarSpan = 360 / nPillars;

  // Group dimensions by pillar, preserving pillar order, so each pillar's dimensions
  // fan out directly above its inner arc.
  const dimsByPillar = pillars.map((p) => dimensions.filter((d) => d.pillar === p.key));

  return (
    <svg
      className="bf-360-wheel"
      viewBox="0 0 320 320"
      role="img"
      aria-label={ariaLabel ?? 'Project 360 health wheel'}
    >
      {pillars.map((pillar, pi) => {
        const pStart = pi * pillarSpan;
        const pEnd = pStart + pillarSpan;
        const pMid = (pStart + pEnd) / 2;
        const dims = dimsByPillar[pi];
        const dimSpan = pillarSpan / (dims.length || 1);
        const pLabel = labelAt((R_INNER_0 + R_INNER_1) / 2, pMid);
        return (
          <g key={pillar.key}>
            {/* Inner ring — pillar */}
            <path
              d={sector(R_INNER_0, R_INNER_1, pStart + 0.6, pEnd - 0.6)}
              fill={pillar.color}
              fillOpacity={0.9}
              className="bf-360-arc bf-360-arc--pillar"
            />
            <text
              x={pLabel.x}
              y={pLabel.y}
              className="bf-360-arc-label bf-360-arc-label--pillar"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {pillar.label}
            </text>

            {/* Outer ring — dimensions */}
            {dims.map((dim, di) => {
              const dStart = pStart + di * dimSpan;
              const dEnd = dStart + dimSpan;
              const dMid = (dStart + dEnd) / 2;
              const isSel = selected === dim.key;
              const lab = labelAt((R_OUTER_0 + R_OUTER_1) / 2, dMid);
              const lines = twoLines(dim.label);
              return (
                <g
                  key={dim.key}
                  className="bf-360-arc-group"
                  onClick={() => onSelect?.(isSel ? null : dim.key)}
                  role="button"
                  aria-pressed={isSel}
                  aria-label={`${dim.label}: ${dim.score} of 100`}
                >
                  <path
                    d={sector(R_OUTER_0, R_OUTER_1, dStart + 0.6, dEnd - 0.6)}
                    fill={dim.color}
                    fillOpacity={isSel ? 1 : 0.82}
                    className={`bf-360-arc bf-360-arc--dim${isSel ? ' is-selected' : ''}`}
                  />
                  <text
                    x={lab.x}
                    y={lab.y}
                    className="bf-360-arc-label"
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    {lines.map((ln, li) => (
                      <tspan key={li} x={lab.x} dy={li === 0 ? (lines.length > 1 ? '-0.5em' : '0') : '1em'}>
                        {ln}
                      </tspan>
                    ))}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}

      {/* Centre — overall score */}
      <circle cx={CX} cy={CY} r={R_CENTER} className="bf-360-center" onClick={() => onSelect?.(null)} role="button" aria-label="Clear selection" />
      <circle cx={CX} cy={CY} r={R_CENTER} fill="none" stroke={overall.color} strokeWidth={3} className="bf-360-center-ring" />
      <text x={CX} y={CY - 8} className="bf-360-center-score" textAnchor="middle" dominantBaseline="central" fill={overall.color}>
        {overall.score}
      </text>
      <text x={CX} y={CY + 14} className="bf-360-center-label" textAnchor="middle" dominantBaseline="central">
        HEALTH
      </text>
    </svg>
  );
}
