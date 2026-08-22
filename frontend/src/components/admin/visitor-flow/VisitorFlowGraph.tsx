'use client';

/**
 * The anonymous funnel, drawn.
 *
 * Purely presentational: it takes nodes and edges and renders them. No fetching,
 * no filters, no panel chrome — so the same graph can be dropped into a report,
 * a project surface or a public case study without touching it.
 *
 * WHY A FLOW GRAPH AND NOT A STAGE FUNNEL. A stage funnel (400 saw pricing → 90
 * signed up) hides the only thing worth acting on: WHICH step people arrive from
 * and WHERE they stop. That is an edge property, so the drawing has edges.
 *
 * Encoding, in the order a reader uses it:
 *   • node height   → visitors who reached the step (length on a common baseline)
 *   • edge width    → visitors who moved along that transition
 *   • the red bar inside a node → the share whose visit ENDED there (the leak)
 *   • color + a written kind label → what kind of step it is
 * Color never carries a fact on its own: every node is labelled, and the
 * drop-off is a bar as well as a tint.
 */

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  layoutVisitorFlow,
  type FlowEdgeInput,
  type FlowNodeInput,
  type LaidOutNode,
  type VisitorFlowNodeKind,
} from '@/lib/visitorFlowLayout';

/**
 * Each step kind's ink, as tokens so both themes are covered by construction.
 * The three states (`error`, `exit`, `converted`) wear the reserved status
 * colors — they ARE states — and the two neutral kinds take accent/info, so a
 * status hue is never spent on "just another step".
 */
const KIND_COLOR: Record<VisitorFlowNodeKind, string> = {
  prompt: 'var(--accent)',
  page: 'var(--info)',
  error: 'var(--error)',
  exit: 'var(--warning)',
  converted: 'var(--success)',
};

export interface VisitorFlowGraphProps {
  nodes: FlowNodeInput[];
  edges: FlowEdgeInput[];
  /** Opens one visitor's timeline. Omit to render a non-interactive graph. */
  onSelectNode?: (node: FlowNodeInput) => void;
}

export function VisitorFlowGraph({ nodes, edges, onSelectNode }: VisitorFlowGraphProps) {
  const t = useTranslations('admin.visitorFlow');
  const [hovered, setHovered] = useState<string | null>(null);
  const layout = useMemo(() => layoutVisitorFlow(nodes, edges), [nodes, edges]);

  if (layout.nodes.length === 0) {
    return <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>{t('empty')}</p>;
  }

  const connected = new Set<string>();
  if (hovered) {
    connected.add(hovered);
    for (const edge of layout.edges) {
      if (edge.from === hovered) connected.add(edge.to);
      if (edge.to === hovered) connected.add(edge.from);
    }
  }

  return (
    <div>
      {/* Wide graphs scroll inside their own container — the page never does. */}
      <div style={{ overflowX: 'auto', overflowY: 'hidden', maxWidth: '100%' }}>
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={layout.width}
          height={layout.height}
          role="img"
          aria-label={t('graphLabel')}
          style={{ display: 'block', minWidth: layout.width, maxWidth: 'none' }}
        >
          {/* Edges first, so a node always sits above the lines entering it. */}
          <g fill="none">
            {layout.edges.map((edge) => {
              const dim = hovered !== null && !(edge.from === hovered || edge.to === hovered);
              return (
                <path
                  key={`${edge.from}->${edge.to}`}
                  d={edge.path}
                  stroke="var(--text-muted)"
                  strokeWidth={edge.strokeWidth}
                  strokeLinecap="round"
                  strokeDasharray={edge.backward ? '6 5' : undefined}
                  opacity={dim ? 0.08 : 0.28}
                >
                  <title>{t('edgeTooltip', { visitors: edge.visitors, events: edge.events })}</title>
                </path>
              );
            })}
          </g>

          {layout.nodes.map((node) => (
            <FlowNode
              key={node.id}
              node={node}
              dimmed={hovered !== null && !connected.has(node.id)}
              onHover={setHovered}
              onSelect={onSelectNode}
            />
          ))}
        </svg>
      </div>

      <FlowLegend />
    </div>
  );
}

/**
 * One step. Its own component because a node draws four things (the band, the
 * drop-off bar, the label, the count) and inlining that in the map would make
 * the graph body unreadable.
 */
function FlowNode({
  node,
  dimmed,
  onHover,
  onSelect,
}: {
  node: LaidOutNode;
  dimmed: boolean;
  onHover: (id: string | null) => void;
  onSelect?: (node: LaidOutNode) => void;
}) {
  const t = useTranslations('admin.visitorFlow');
  const color = KIND_COLOR[node.kind];
  const label = node.kind === 'page' || node.kind === 'prompt' ? node.label : t(`kind.${node.kind}`);

  return (
    <g
      opacity={dimmed ? 0.25 : 1}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(node.id)}
      onBlur={() => onHover(null)}
      onClick={onSelect ? () => onSelect(node) : undefined}
      tabIndex={onSelect ? 0 : -1}
      role={onSelect ? 'button' : undefined}
      style={{ cursor: onSelect ? 'pointer' : 'default' }}
    >
      <title>
        {t('nodeTooltip', {
          label,
          visitors: node.visitors,
          events: node.events,
          exitPct: Math.round(node.exitRate * 100),
        })}
      </title>

      <rect
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        rx={6}
        fill="var(--surface-card)"
        stroke={color}
        strokeWidth={1.5}
      />
      {/* The leak, as a length: the share of visitors whose visit ended here.
          Drawn along the bottom edge so it reads against the node's own width. */}
      {node.exitRate > 0 && (
        <rect
          x={node.x}
          y={node.y + node.height - 4}
          width={Math.max(2, node.width * node.exitRate)}
          height={4}
          rx={2}
          fill="var(--warning)"
        />
      )}
      <circle cx={node.x + 12} cy={node.y + 15} r={4} fill={color} />
      <text
        x={node.x + 24}
        y={node.y + 19}
        fill="var(--text-strong)"
        fontSize={12}
        fontWeight={600}
      >
        {truncate(label, 20)}
      </text>
      <text x={node.x + 24} y={node.y + 34} fill="var(--text-muted)" fontSize={11}>
        {t('nodeCount', { visitors: node.visitors, exitPct: Math.round(node.exitRate * 100) })}
      </text>
    </g>
  );
}

/** Identity is never color-alone, so the legend is always present. */
function FlowLegend() {
  const t = useTranslations('admin.visitorFlow');
  const kinds: VisitorFlowNodeKind[] = ['prompt', 'page', 'error', 'exit', 'converted'];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 12, alignItems: 'center' }}>
      {kinds.map((kind) => (
        <span key={kind} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <span
            aria-hidden
            style={{
              width: 10, height: 10, borderRadius: 5, background: KIND_COLOR[kind], flexShrink: 0,
            }}
          />
          <span className="text-muted">{t(`kind.${kind}`)}</span>
        </span>
      ))}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
        <span
          aria-hidden
          style={{ width: 16, height: 4, borderRadius: 2, background: 'var(--warning)', flexShrink: 0 }}
        />
        <span className="text-muted">{t('legendDropOff')}</span>
      </span>
    </div>
  );
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
