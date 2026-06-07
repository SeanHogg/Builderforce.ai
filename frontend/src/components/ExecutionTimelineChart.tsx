'use client';

/**
 * D3 execution-timeline chart — a zoomable/pannable swimlane Gantt of agent
 * activity. One band per agent; concurrent tool calls / tasks within an agent
 * pack into sub-lanes so nothing overlaps. D3 owns the math (time scale), the
 * bottom time axis, and the zoom/pan behaviour; React owns the SVG so the bars
 * stay declarative. Used by the Observability "Timeline view" and the /timeline
 * page (single source of truth for the visual — see [[view-toggle-convention]]).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { scaleTime } from 'd3-scale';
import { select } from 'd3-selection';
import { axisBottom } from 'd3-axis';
import { zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom';

export interface ExecutionTrack {
  label: string;
  kind: 'tool' | 'workflow-task';
  startMs: number;
  endMs: number;
  status: string;
  detail?: string;
  agentKey: string;
  agentName: string;
}

export interface ExecutionTimelineChartProps {
  tracks: ExecutionTrack[];
  /** Per-agent colour, indexed by the caller's selection order. */
  colorForKey: (key: string) => string;
}

const MARGIN = { top: 12, right: 24, bottom: 28, left: 168 };
const LANE_H = 20;
const LANE_GAP = 4;
const AGENT_GAP = 12;

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed': return 'var(--green, #22c55e)';
    case 'failed': return 'var(--red, #ef4444)';
    case 'running': return 'var(--blue, #3b82f6)';
    default: return 'var(--text-muted)';
  }
}

interface LaidOutTrack extends ExecutionTrack {
  row: number; // global sub-lane row index
}

interface AgentBand {
  agentKey: string;
  agentName: string;
  rowStart: number;
  rowCount: number;
}

/** Greedy interval packing: assign each track the first sub-lane that's free. */
function layout(tracks: ExecutionTrack[]): { laid: LaidOutTrack[]; bands: AgentBand[]; rows: number } {
  // Stable agent order = first appearance.
  const order: string[] = [];
  const byAgent = new Map<string, ExecutionTrack[]>();
  for (const t of tracks) {
    if (!byAgent.has(t.agentKey)) { byAgent.set(t.agentKey, []); order.push(t.agentKey); }
    byAgent.get(t.agentKey)!.push(t);
  }

  const laid: LaidOutTrack[] = [];
  const bands: AgentBand[] = [];
  let row = 0;
  for (const key of order) {
    const group = byAgent.get(key)!.slice().sort((a, b) => a.startMs - b.startMs);
    const laneEnds: number[] = []; // end time per sub-lane
    const rowStart = row;
    for (const t of group) {
      let lane = laneEnds.findIndex((end) => t.startMs >= end);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = Math.max(t.endMs, t.startMs + 1);
      laid.push({ ...t, row: rowStart + lane });
    }
    const rowCount = Math.max(laneEnds.length, 1);
    bands.push({ agentKey: key, agentName: group[0]?.agentName ?? key, rowStart, rowCount });
    row = rowStart + rowCount;
  }
  return { laid, bands, rows: row };
}

export function ExecutionTimelineChart({ tracks, colorForKey }: ExecutionTimelineChartProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const axisRef = useRef<SVGGElement | null>(null);
  const [width, setWidth] = useState(720);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);

  // Responsive width.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { laid, bands, rows } = useMemo(() => layout(tracks), [tracks]);

  const [minMs, maxMs] = useMemo(() => {
    if (tracks.length === 0) return [0, 1];
    let lo = Infinity, hi = -Infinity;
    for (const t of tracks) { lo = Math.min(lo, t.startMs); hi = Math.max(hi, t.endMs, t.startMs + 1); }
    // Pad 2% each side so edge bars aren't flush against the axis.
    const pad = Math.max((hi - lo) * 0.02, 500);
    return [lo - pad, hi + pad];
  }, [tracks]);

  const innerW = Math.max(width - MARGIN.left - MARGIN.right, 10);
  const innerH = rows * (LANE_H + LANE_GAP) + bands.length * AGENT_GAP;
  const height = innerH + MARGIN.top + MARGIN.bottom;

  const baseX = useMemo(
    () => scaleTime().domain([new Date(minMs), new Date(maxMs)]).range([0, innerW]),
    [minMs, maxMs, innerW],
  );
  // Zoom only rescales the time axis (x); lanes (y) are fixed.
  const x = useMemo(() => transform.rescaleX(baseX), [transform, baseX]);

  // Wire d3-zoom onto the svg.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 200])
      .translateExtent([[0, 0], [innerW, 1]])
      .extent([[0, 0], [innerW, 1]])
      .on('zoom', (e) => setTransform(e.transform));
    const sel = select(svg);
    sel.call(behavior);
    return () => { sel.on('.zoom', null); };
  }, [innerW]);

  // Render the bottom time axis with d3-axis whenever the scale changes.
  useEffect(() => {
    if (!axisRef.current) return;
    select(axisRef.current).call(axisBottom(x).ticks(Math.max(2, Math.floor(innerW / 110))));
  }, [x, innerW]);

  const rowY = (band: AgentBand, row: number) =>
    MARGIN.top + row * (LANE_H + LANE_GAP) + bands.indexOf(band) * AGENT_GAP;

  // Quick lookup band for a track row.
  const bandForRow = (row: number) => bands.find((b) => row >= b.rowStart && row < b.rowStart + b.rowCount)!;

  if (tracks.length === 0) return null;

  return (
    <div ref={wrapRef} style={{ width: '100%' }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
        Scroll / pinch to zoom · drag to pan
      </div>
      <svg ref={svgRef} width={width} height={height} style={{ display: 'block', cursor: 'grab', fontFamily: 'var(--font-mono, monospace)' }}>
        {/* Agent swimlane backgrounds + left labels */}
        {bands.map((b) => {
          const y = rowY(b, b.rowStart) - LANE_GAP / 2;
          const h = b.rowCount * (LANE_H + LANE_GAP);
          return (
            <g key={b.agentKey}>
              <rect x={0} y={y} width={width} height={h} fill="var(--bg-base)" opacity={0.4} />
              <rect x={MARGIN.left - 10} y={y + h / 2 - 4} width={8} height={8} rx={2} fill={colorForKey(b.agentKey)} />
              <text x={MARGIN.left - 22} y={y + h / 2 + 4} fontSize={11} fill="var(--text-primary)" textAnchor="end">
                {b.agentName.length > 20 ? b.agentName.slice(0, 19) + '…' : b.agentName}
              </text>
            </g>
          );
        })}

        {/* Plot area clip so zoomed bars don't spill over the label gutter */}
        <defs>
          <clipPath id="exec-timeline-clip">
            <rect x={MARGIN.left} y={0} width={innerW} height={height} />
          </clipPath>
        </defs>

        <g clipPath="url(#exec-timeline-clip)">
          <g transform={`translate(${MARGIN.left},0)`}>
            {laid.map((t, i) => {
              const band = bandForRow(t.row);
              const y = rowY(band, t.row);
              const bx = x(new Date(t.startMs));
              const bw = Math.max(x(new Date(Math.max(t.endMs, t.startMs + 1))) - bx, 3);
              const fill = t.kind === 'tool' ? colorForKey(t.agentKey) : statusColor(t.status);
              return (
                <g key={i}>
                  <rect x={bx} y={y} width={bw} height={LANE_H} rx={3} fill={fill} opacity={0.85}>
                    <title>
                      {t.agentName}: {t.label}
                      {'\n'}
                      {new Date(t.startMs).toLocaleTimeString()} → {new Date(t.endMs).toLocaleTimeString()} ({fmtDuration(Math.max(t.endMs - t.startMs, 0))})
                      {'\n'}status: {t.status}
                      {t.detail ? `\n${t.detail}` : ''}
                    </title>
                  </rect>
                  {bw > 44 && (
                    <text x={bx + 4} y={y + LANE_H / 2 + 4} fontSize={10} fill="#fff" style={{ pointerEvents: 'none' }}>
                      {t.label.length > Math.floor(bw / 6) ? t.label.slice(0, Math.floor(bw / 6)) + '…' : t.label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </g>

        {/* Time axis */}
        <g ref={axisRef} transform={`translate(${MARGIN.left},${MARGIN.top + innerH})`} fontSize={9} color="var(--text-muted)" />
      </svg>
    </div>
  );
}
