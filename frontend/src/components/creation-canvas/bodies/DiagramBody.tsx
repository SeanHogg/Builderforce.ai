import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { canvasDiagram } from '@/lib/canvasDocuments';
import { diagramGraphStats, diagramLabelLines, diagramShapePolygon, type DiagramGraph } from '@/lib/diagramGraph';
import { diagramNotation, readDiagramSource } from '@/lib/diagramNotations';
import { MermaidDiagram } from '@/components/MermaidDiagram';
import type { CreationBodyProps } from './types';
import { AuthoredContent } from './shared';

/** Ink that stays readable on a fill the diagram file chose, in either theme. */
function readableInk(fill: string | undefined): string {
  const hex = fill?.trim().replace('#', '');
  if (!hex || (hex.length !== 3 && hex.length !== 6)) return 'var(--canvas-ink)';
  const expanded = hex.length === 3 ? hex.split('').map((character) => character + character).join('') : hex;
  const [red, green, blue] = [0, 2, 4].map((offset) => parseInt(expanded.slice(offset, offset + 2), 16) / 255);
  const luminance = 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
  return luminance > 0.55 ? 'var(--canvas-ink-on-light)' : 'var(--canvas-ink-on-dark)';
}

function DiagramCanvas({ graph, title }: { graph: DiagramGraph; title: string }) {
  const markerId = `arrow-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return <svg
    className={styles.diagramCanvas}
    viewBox={`${graph.x} ${graph.y} ${graph.width} ${graph.height}`}
    preserveAspectRatio="xMidYMid meet"
    role="img"
    aria-label={title}
  >
    <defs>
      <marker id={markerId} markerWidth="10" markerHeight="10" refX="9" refY="3.2" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L9,3.2 L0,6.4 z" fill="currentColor" />
      </marker>
    </defs>
    {graph.edges.map((edge) => <g key={edge.id} style={{ color: edge.stroke ?? 'var(--canvas-muted)' }}>
      <polyline
        points={edge.points.map((point) => `${point.x},${point.y}`).join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
        {...(edge.dashed ? { strokeDasharray: '6 4' } : {})}
        {...(edge.arrow ? { markerEnd: `url(#${markerId})` } : {})}
      />
      {edge.label && <text
        x={(edge.points[0]!.x + edge.points[edge.points.length - 1]!.x) / 2}
        y={(edge.points[0]!.y + edge.points[edge.points.length - 1]!.y) / 2 - 4}
        textAnchor="middle"
        fontSize={11}
        fill="var(--canvas-muted)"
      >{edge.label}</text>}
    </g>)}
    {graph.vertices.map((vertex) => {
      const polygon = diagramShapePolygon(vertex);
      const fill = vertex.fill ?? 'var(--canvas-widget-surface)';
      const stroke = vertex.stroke ?? 'var(--canvas-widget-border)';
      const ink = vertex.fontColor ?? (vertex.fill ? readableInk(vertex.fill) : 'var(--canvas-ink)');
      const lines = diagramLabelLines(vertex.label, vertex.width, vertex.fontSize);
      const shapeProps = { fill: vertex.shape === 'text' ? 'none' : fill, stroke: vertex.shape === 'text' ? 'none' : stroke, strokeWidth: 1.4, ...(vertex.dashed ? { strokeDasharray: '6 4' } : {}) };
      return <g key={vertex.id}>
        {vertex.imageUrl
          ? <image href={vertex.imageUrl} x={vertex.x} y={vertex.y} width={vertex.width} height={vertex.height} preserveAspectRatio="xMidYMid meet" />
          : polygon
          ? <polygon points={polygon} {...shapeProps} />
          : vertex.shape === 'ellipse'
            ? <ellipse cx={vertex.x + vertex.width / 2} cy={vertex.y + vertex.height / 2} rx={vertex.width / 2} ry={vertex.height / 2} {...shapeProps} />
            : vertex.shape === 'cylinder'
              ? <g {...shapeProps}><rect x={vertex.x} y={vertex.y + 8} width={vertex.width} height={Math.max(vertex.height - 16, 1)} /><ellipse cx={vertex.x + vertex.width / 2} cy={vertex.y + 8} rx={vertex.width / 2} ry={8} /><ellipse cx={vertex.x + vertex.width / 2} cy={vertex.y + vertex.height - 8} rx={vertex.width / 2} ry={8} /></g>
              : <rect x={vertex.x} y={vertex.y} width={vertex.width} height={vertex.height} rx={vertex.shape === 'rounded' ? 10 : 0} {...shapeProps} />}
        {!vertex.imageUrl && lines.map((line, index) => <text
          key={`${vertex.id}-${index}`}
          x={vertex.x + vertex.width / 2}
          y={vertex.y + vertex.height / 2 + (index - (lines.length - 1) / 2) * (vertex.fontSize * 1.25) + vertex.fontSize * 0.35}
          textAnchor="middle"
          fontSize={vertex.fontSize}
          fill={ink}
        >{line}</text>)}
      </g>;
    })}
  </svg>;
}

/**
 * A diagram object rendered as a diagram.
 *
 * Every notation but one is drawn from the shared graph — the SAME renderer for
 * a draw.io scene, a Visio import, a BPMN process, a DOT graph and a PlantUML
 * component diagram, because by the time it reaches here they are all the same
 * geometry. Mermaid keeps its own renderer: its output is better than anything
 * derived from a parse of it, and reimplementing it is not the job.
 *
 * No editor embed and no network in either path.
 */
export function DiagramBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.node');
  const diagram = canvasDiagram(data);
  const source = diagram?.source ?? '';
  const format = diagram?.format;
  const notation = diagramNotation(format);
  const [graph, setGraph] = useState<DiagramGraph | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  useEffect(() => {
    if (!format || notation?.renderer !== 'graph') { setGraph(null); setUnreadable(false); return; }
    let cancelled = false;
    void readDiagramSource(format, source).then((parsed) => {
      if (cancelled) return;
      setGraph(parsed);
      setUnreadable(!parsed);
    });
    return () => { cancelled = true; };
  }, [format, notation?.renderer, source]);
  if (!diagram || !notation) return <AuthoredContent data={data} fallback={t('diagramFallback')} />;
  return <div className={styles.diagramBody}>
    <div className={styles.documentMeta}>
      <span>{notation.name}</span>
      {graph && <span>{t('diagramShapes', { count: diagramGraphStats(graph).shapes, connections: diagramGraphStats(graph).connections })}</span>}
    </div>
    <div className={`${styles.diagramSurface} nowheel nodrag`} role="region" aria-label={data.title} tabIndex={0}>
      {notation.renderer === 'mermaid'
        ? <MermaidDiagram code={diagram.source} />
        : graph
          ? <DiagramCanvas graph={graph} title={data.title} />
          : <p className={styles.filePreviewEmpty}>{unreadable ? t('diagramUnreadable') : t('diagramLoading')}</p>}
    </div>
  </div>;
}
