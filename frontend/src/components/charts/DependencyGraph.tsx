/**
 * DependencyGraphChart — the directed-graph primitive for `components/charts/`.
 *
 * The chart folder had a donut, a bar, a trend, a gauge, a radar, a sparkline, a
 * fishbone and two stacked bars, and no way to draw a RELATIONSHIP. Anything shaped
 * "what depends on what" (an incident's blast radius, a service topology, a plan's
 * precedence) had to either borrow the PM board's React Flow editor — an interactive
 * canvas, ~200 KB of library, and a whole edit surface nobody asked for on a report —
 * or go undrawn. This is the read-only half: inline SVG, no library, no network, the
 * same prop/aria conventions as its siblings.
 *
 * NOT to be confused with `components/pm/DependencyGraph.tsx`, which is the
 * task-dependency EDITOR (React Flow, inline edge add/delete, 3D view). They now
 * share their maths — `@/lib/graphLayout` owns layering, cycle detection and the
 * back-edge set for both — and differ only in what they render it with.
 *
 * WHY LAYERED AND NOT FORCE-DIRECTED. A force layout is prettier and useless here:
 * it is non-deterministic, so the same incident draws differently on every visit and
 * no two people describing "the node on the left" mean the same node. Layering by
 * causal depth means position CARRIES meaning — leftwards is upstream — and the
 * picture is reproducible.
 */

import { colorAt } from './chartColors';
import { truncate, wrapSvgText } from './svgText';
import { edgeKey, layoutDag } from '@/lib/graphLayout';

/** What a node is. Drives its accent only — position always comes from the layout. */
export type DependencyGraphNodeKind = 'incident' | 'system' | 'monitor' | 'ticket' | 'default';

export interface DependencyGraphNode {
  id: string;
  label: string;
  kind?: DependencyGraphNodeKind;
  /** Free-form state word rendered under the label (`sev1`, `breached`, `done`, …). */
  status?: string;
  /** The subject of the graph — drawn emphasised. At most one is meaningful. */
  focus?: boolean;
}

export interface DependencyGraphEdge {
  from: string;
  to: string;
  label?: string;
}

export interface DependencyGraphProps {
  nodes: DependencyGraphNode[];
  edges: DependencyGraphEdge[];
  /** Accessible description; falls back to a generated summary. */
  ariaLabel?: string;
  /** Label for the dashed back-edge treatment, already localized. */
  backEdgeLabel?: string;
}

/**
 * Accent per kind, from the shared categorical palette — never a literal, so each
 * one is the right shade for the theme it is printed on (see chartColors).
 */
const KIND_COLOR: Record<DependencyGraphNodeKind, string> = {
  incident: colorAt(4), // red
  system: colorAt(1),   // brand blue
  monitor: colorAt(5),  // teal
  ticket: colorAt(0),   // violet
  default: colorAt(7),
};

const NODE_W = 168;
const NODE_H = 56;
const COL_GAP = 76;
const ROW_GAP = 20;
const PAD = 14;
/** Below this the SVG scrolls inside its own box rather than shrinking to unreadable. */
const MIN_SVG_W = 320;

const colX = (layer: number) => PAD + layer * (NODE_W + COL_GAP);
const rowY = (row: number) => PAD + row * (NODE_H + ROW_GAP);

export function DependencyGraphChart({ nodes, edges, ariaLabel, backEdgeLabel }: DependencyGraphProps) {
  const layout = layoutDag(nodes, edges);
  const width = Math.max(MIN_SVG_W, PAD * 2 + Math.max(layout.layerCount, 1) * NODE_W + Math.max(layout.layerCount - 1, 0) * COL_GAP);
  const height = PAD * 2 + Math.max(layout.maxRows, 1) * NODE_H + Math.max(layout.maxRows - 1, 0) * ROW_GAP;

  const summary =
    ariaLabel ??
    `Dependency graph: ${nodes.length} node(s), ${edges.length} relationship(s). ${nodes
      .map((n) => n.label)
      .slice(0, 8)
      .join(', ')}`;

  // Vertically centre each layer so a one-node column sits beside the middle of a
  // four-node one instead of pinned to the top — the arrows then read as flow.
  const centreOffset = (layer: number) => {
    const rows = layout.rowsPerLayer[layer] ?? 0;
    return (Math.max(layout.maxRows, 1) - rows) * (NODE_H + ROW_GAP) / 2;
  };
  const boxOf = (id: string) => {
    const at = layout.byId.get(id);
    if (!at) return null;
    return { x: colX(at.layer), y: rowY(at.row) + centreOffset(at.layer), w: NODE_W, h: NODE_H };
  };

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label={summary}
        style={{ minWidth: Math.min(width, MIN_SVG_W), display: 'block' }}
      >
        <title>{summary}</title>
        <defs>
          {/* Two markers: the normal flow arrow and the back-edge arrow. A single
              marker cannot change colour with the path that uses it. */}
          <marker id="dg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-secondary)" />
          </marker>
          <marker id="dg-arrow-back" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--danger)" />
          </marker>
        </defs>

        {/* Edges first so nodes paint over the arrow tails. */}
        {edges.map((e, i) => {
          const a = boxOf(e.from);
          const b = boxOf(e.to);
          if (!a || !b) return null;
          const back = layout.backEdges.has(edgeKey(e.from, e.to));
          // Forward edges leave the right face and enter the left one. A back edge
          // is drawn from the LEFT face bowing outwards, so an arrow that returns
          // upstream looks like one instead of like a normal edge in reverse.
          const x1 = back ? a.x : a.x + a.w;
          const x2 = back ? b.x + b.w : b.x;
          const y1 = a.y + a.h / 2;
          const y2 = b.y + b.h / 2;
          const bow = back ? -Math.max(28, Math.abs(x2 - x1) / 3) : (x2 - x1) / 2;
          const d = back
            ? `M ${x1} ${y1} C ${x1 + bow} ${y1 - 26}, ${x2 - bow} ${y2 - 26}, ${x2} ${y2}`
            : `M ${x1} ${y1} C ${x1 + bow} ${y1}, ${x2 - bow} ${y2}, ${x2} ${y2}`;
          const label = back ? (backEdgeLabel ?? e.label) : e.label;
          return (
            <g key={`${e.from}->${e.to}-${i}`}>
              <path
                d={d}
                fill="none"
                stroke={back ? 'var(--danger)' : 'var(--border-strong)'}
                strokeWidth={back ? 2 : 1.6}
                strokeDasharray={back ? '5 4' : undefined}
                markerEnd={`url(#${back ? 'dg-arrow-back' : 'dg-arrow'})`}
              />
              {label && (
                <text
                  x={(x1 + x2) / 2}
                  y={(y1 + y2) / 2 - (back ? 20 : 6)}
                  textAnchor="middle"
                  fontSize={10}
                  fill={back ? 'var(--danger)' : 'var(--text-muted)'}
                >
                  {truncate(label, 18)}
                </text>
              )}
            </g>
          );
        })}

        {/* Nodes */}
        {nodes.map((n) => {
          const box = boxOf(n.id);
          if (!box) return null;
          const color = KIND_COLOR[n.kind ?? 'default'] ?? KIND_COLOR.default;
          const lines = wrapSvgText(n.label, 22, n.status ? 2 : 3);
          const top = box.y + box.h / 2 - (lines.length - 1) * 7 - (n.status ? 6 : 0);
          return (
            <g key={n.id}>
              <rect
                x={box.x} y={box.y} width={box.w} height={box.h} rx={10}
                fill={color} fillOpacity={n.focus ? 0.22 : 0.1}
                stroke={color} strokeWidth={n.focus ? 2.5 : 1.5}
              />
              {lines.map((line, i) => (
                <text
                  key={i}
                  x={box.x + box.w / 2}
                  y={top + i * 14}
                  textAnchor="middle"
                  fontSize={11.5}
                  fontWeight={n.focus ? 700 : 600}
                  fill="var(--text-primary)"
                >
                  {line}
                </text>
              ))}
              {n.status && (
                <text
                  x={box.x + box.w / 2}
                  y={box.y + box.h - 9}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--text-secondary)"
                >
                  {truncate(n.status, 20)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
