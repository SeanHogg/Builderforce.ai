import { colorAt } from './chartColors';
import type { LaneOccupancy, LaneSpan } from '@/lib/laneOccupancy';

/**
 * LifecycleSwimlane — one work item's life, drawn as a FLOW instead of a row.
 *
 * The planning surfaces draw an Epic as a group with its children stacked
 * beneath, so an Epic's progress reads as a flow. A work item that is its own
 * single value unit — no children — got a single bar, and a single bar cannot
 * answer the only question anyone asks about a late ticket: where did the time
 * go. Two eleven-day tickets look identical when one spent ten days in review and
 * the other spent ten days in the backlog, and those are opposite problems.
 *
 * So the item gets a swimlane of its own: one ROW per lane it ever sat in, one
 * BAR per stay, in time order. A lane entered twice shows twice — the second stay
 * marked as rework — because a redo loop that renders as ordinary forward
 * progress is precisely how a redo loop stays invisible.
 *
 * Hand-rolled SVG, matching the DonutChart/Sparkline convention in this folder:
 * no charting dependency, colours from the shared token palette (never a literal
 * hex, which reads in exactly one theme), and a `viewBox` so it scales down to a
 * phone without a horizontal scrollbar.
 */

export interface LifecycleSwimlaneProps {
  occupancy: LaneOccupancy;
  /** Lane key → the label a reader should see (localized by the caller). */
  laneLabel: (lane: string) => string;
  /** Duration in ms → a human string (localized by the caller). */
  formatDuration: (ms: number) => string;
  /** Row height in px. */
  rowHeight?: number;
  ariaLabel?: string;
}

/** Left gutter carrying the lane names, in the same units as the viewBox. */
const LABEL_W = 132;
const TRACK_W = 468;
const TOTAL_W = LABEL_W + TRACK_W;
const PAD_Y = 6;

export function LifecycleSwimlane({
  occupancy,
  laneLabel,
  formatDuration,
  rowHeight = 30,
  ariaLabel,
}: LifecycleSwimlaneProps) {
  const { lanes, spans, start, end, totalByLane } = occupancy;
  if (lanes.length === 0 || spans.length === 0) return null;

  // A ticket created and moved in the same instant would divide by zero; a
  // one-pixel span is the honest picture of "no measurable time passed".
  const window = Math.max(1, end - start);
  const height = lanes.length * rowHeight + PAD_Y * 2;

  const x = (t: number) => LABEL_W + ((t - start) / window) * TRACK_W;
  const rowY = (lane: string) => PAD_Y + lanes.indexOf(lane) * rowHeight;

  return (
    <svg
      viewBox={`0 0 ${TOTAL_W} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={ariaLabel}
      style={{ display: 'block', maxWidth: '100%', overflow: 'visible' }}
    >
      {lanes.map((lane, i) => {
        const y = rowY(lane);
        return (
          <g key={lane}>
            {/* Row banding: an even row gets a wash so a wide, sparse chart still
                tracks left-to-right without a ruler. */}
            {i % 2 === 0 && (
              <rect x={LABEL_W} y={y} width={TRACK_W} height={rowHeight} fill="var(--bg-elevated)" opacity={0.5} />
            )}
            <text
              x={LABEL_W - 8}
              y={y + rowHeight / 2}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={11}
              fill="var(--text-secondary)"
            >
              {laneLabel(lane)}
            </text>
            <text
              x={TOTAL_W}
              y={y + rowHeight / 2}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={10}
              fill="var(--text-muted)"
            >
              {formatDuration(totalByLane[lane] ?? 0)}
            </text>
          </g>
        );
      })}

      {spans.map((span, i) => (
        <SpanBar
          key={`${span.lane}-${span.from}-${i}`}
          span={span}
          index={lanes.indexOf(span.lane)}
          x1={x(span.from)}
          x2={x(span.to)}
          y={rowY(span.lane)}
          rowHeight={rowHeight}
          label={`${laneLabel(span.lane)} · ${formatDuration(Math.max(0, span.to - span.from))}`}
        />
      ))}

      {/* The hops themselves: a hairline from the end of one stay to the start of
          the next, so the eye follows the ticket down and back up the lanes. */}
      {spans.slice(0, -1).map((span, i) => {
        const next = spans[i + 1]!;
        return (
          <line
            key={`hop-${i}`}
            x1={x(span.to)}
            y1={rowY(span.lane) + rowHeight / 2}
            x2={x(next.from)}
            y2={rowY(next.lane) + rowHeight / 2}
            stroke="var(--border-subtle)"
            strokeWidth={1}
            strokeDasharray={next.rework ? '3 2' : undefined}
          />
        );
      })}
    </svg>
  );
}

function SpanBar({
  span, index, x1, x2, y, rowHeight, label,
}: {
  span: LaneSpan; index: number; x1: number; x2: number; y: number; rowHeight: number; label: string;
}) {
  // A stay of a few minutes on a three-week chart rounds to nothing; a floor of
  // 3 units keeps it visible, because "it passed through review in 90 seconds" is
  // itself worth seeing.
  const w = Math.max(3, x2 - x1);
  const h = rowHeight - 10;
  const fill = colorAt(index);
  return (
    <g>
      <rect
        x={x1}
        y={y + 5}
        width={w}
        height={h}
        rx={3}
        fill={fill}
        // Rework is drawn hollow rather than in a second colour: the lane keeps
        // its identity (index → colour) and the SECOND visit still reads as a
        // different kind of event.
        fillOpacity={span.rework ? 0.25 : 0.85}
        stroke={fill}
        strokeWidth={span.rework ? 1.5 : 0}
        strokeDasharray={span.open ? '4 3' : undefined}
      >
        <title>{label}</title>
      </rect>
    </g>
  );
}
