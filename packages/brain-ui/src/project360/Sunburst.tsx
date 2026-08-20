import type { Project360Dimension, Project360Pillar } from './types';
// ALL wheel geometry lives in ONE pure module so it can be asserted without a DOM —
// this component owns presentation only and never re-derives a coordinate.
import {
  ARC_PAD_DEG,
  CX,
  CY,
  labelAt,
  padSlice,
  R_CENTER,
  R_INNER_0,
  R_INNER_1,
  R_OUTER_0,
  R_OUTER_1,
  sector,
  slice,
  twoLines,
  VIEWBOX,
} from './sunburstGeometry';

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

export function Sunburst({ pillars, dimensions, overall, selected, onSelect, ariaLabel }: SunburstProps) {
  const nPillars = pillars.length || 1;
  const pillarSpan = 360 / nPillars;

  // Group dimensions by pillar, preserving pillar order, so each pillar's dimensions
  // fan out directly above its inner arc.
  const dimsByPillar = pillars.map((p) => dimensions.filter((d) => d.pillar === p.key));

  return (
    <svg
      className="bf-360-wheel"
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      role="img"
      aria-label={ariaLabel ?? 'Project 360 health wheel'}
    >
      {pillars.map((pillar, pi) => {
        const [pStart, pEnd] = slice(0, 360, pi, nPillars);
        const pMid = (pStart + pEnd) / 2;
        const dims = dimsByPillar[pi];
        const pLabel = labelAt((R_INNER_0 + R_INNER_1) / 2, pMid);
        return (
          <g key={pillar.key}>
            {/* Inner ring — pillar */}
            <path
              d={sector(R_INNER_0, R_INNER_1, ...padSlice(pStart, pEnd, ARC_PAD_DEG))}
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
              const [dStart, dEnd] = slice(pStart, pillarSpan, di, dims.length);
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
                    d={sector(R_OUTER_0, R_OUTER_1, ...padSlice(dStart, dEnd, ARC_PAD_DEG))}
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
