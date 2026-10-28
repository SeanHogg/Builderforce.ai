/**
 * "How does this reach that" (PRD 38 §3.4), drawn from memory's `traceGraph`.
 *
 * Code: lanes are layers and every message is a reference, so a climbed or skipped layer
 * shows as a coloured arrow. Docs (one plane, no partitions): every DOCUMENT is its own
 * lane, so the trace reads as how one document reaches another. *Copy as Mermaid* exports
 * exactly what is drawn, through memory's `toMermaid`.
 */

import { useMemo, useState } from 'react';
import { toMermaid, traceGraph, UNPARTITIONED_LANE, type KnowledgeGraph, type NodeRef, type Trace } from '@seanhogg/builderforce-memory/knowledge';
import { fillTemplate, type KnowledgeGraphLabels } from './labels';
import { labelFor, nodeIndex } from './graphModel';
import { cssVar } from './scene/themeColors';
import { button, muted } from './styles';

const LANE_W = 150;
const ROW_H = 34;
const HEAD_H = 34;

export interface TracePanelProps {
    graph: KnowledgeGraph;
    from: string;
    labels: KnowledgeGraphLabels;
}

/** The trace as drawn: laned when it spans partitions, per-node otherwise. */
export function drawnTrace(graph: KnowledgeGraph, from: string): { trace: Trace; laned: boolean; laneOf: (ref: string) => string; lanes: string[] } {
    const laned = traceGraph(graph, from as NodeRef);
    // Lanes are LAYERS only where the pack rules who may use whom (edges carry verdicts);
    // folder planes (docs) are not a sequence, so there each document is its own lane.
    const layered = graph.edges.some((e) => e.verdict !== undefined);
    if (layered && laned.lanes.length > 1) {
        return { trace: laned, laned: true, lanes: laned.lanes, laneOf: (r) => laned.laneOf[r] ?? r };
    }
    // Without `laneOf`, `toMermaid` draws one participant per node — the same as the SVG.
    const plain: Trace = { from: laned.from, lanes: laned.lanes, steps: laned.steps, truncated: laned.truncated };
    const lanes = [...new Set([from, ...laned.steps.flatMap((s) => [s.from, s.to])])];
    return { trace: plain, laned: false, lanes, laneOf: (r) => r };
}

export function TracePanel({ graph, from, labels }: TracePanelProps) {
    const index = useMemo(() => nodeIndex(graph), [graph]);
    const { trace, laned, lanes, laneOf } = useMemo(() => drawnTrace(graph, from), [graph, from]);
    const label = (r: string) => labelFor(index, r);
    const mermaid = useMemo(() => toMermaid(trace, (r) => labelFor(index, r)), [trace, index]);
    const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
    const laneName = (lane: string) => (laned ? (lane === UNPARTITIONED_LANE ? labels.partitionNone : lane) : label(lane));

    const onCopy = async () => {
        try {
            await navigator.clipboard.writeText(mermaid);
            setCopy('copied');
        } catch {
            setCopy('failed');
        }
    };

    if (trace.steps.length === 0) return <p style={muted}>{labels.traceEmpty}</p>;

    const width = Math.max(lanes.length * LANE_W, LANE_W);
    const height = HEAD_H + trace.steps.length * ROW_H + 8;
    const x = (lane: string) => lanes.indexOf(lane) * LANE_W + LANE_W / 2;
    const stepTone = (s: Trace['steps'][number]) =>
        s.cycle ? cssVar('cycle') : s.verdict === 'upward' || s.verdict === 'skips' ? cssVar('violation') : cssVar('edge');

    return (
        <section aria-label={labels.traceTitle} style={{ display: 'grid', gap: 10 }}>
            <div style={{ overflowX: 'auto' }}>
                <svg role="img" aria-label={labels.traceTitle} width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ color: cssVar('text') }}>
                    <defs>
                        <marker id="kg-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                            <path d="M0 0 8 4 0 8z" fill="currentColor" />
                        </marker>
                    </defs>
                    {lanes.map((lane) => (
                        <g key={lane}>
                            <text x={x(lane)} y={18} textAnchor="middle" fontSize={11} fontWeight={700} fill={cssVar('text')}>
                                {laneName(lane).slice(0, 22)}
                            </text>
                            <line x1={x(lane)} x2={x(lane)} y1={HEAD_H - 6} y2={height} stroke={cssVar('border')} strokeDasharray="3 4" />
                        </g>
                    ))}
                    {trace.steps.map((s, i) => {
                        const y = HEAD_H + i * ROW_H + ROW_H / 2;
                        const x1 = x(laneOf(s.from)), x2 = x(laneOf(s.to));
                        const tone = stepTone(s);
                        const notes = [s.back ? labels.traceBack : '', s.verdict === 'upward' ? labels.traceUpward : '',
                            s.verdict === 'skips' ? labels.traceSkips : '', s.cycle ? labels.traceCycle : ''].filter(Boolean).join(', ');
                        const text = fillTemplate(labels.traceStep, { from: label(s.from), kind: s.kind, to: label(s.to) });
                        return (
                            <g key={`${s.from}-${s.to}-${i}`} style={{ color: tone }}>
                                <title>{notes ? `${text} (${notes})` : text}</title>
                                {x1 === x2
                                    ? <path d={`M${x1} ${y - 8} h24 v16 h-20`} fill="none" stroke={tone} markerEnd="url(#kg-arrow)" />
                                    : <line x1={x1} x2={x2 + (x2 > x1 ? -4 : 4)} y1={y} y2={y} stroke={tone} strokeWidth={1.5} strokeDasharray={s.back ? '5 4' : undefined} markerEnd="url(#kg-arrow)" />}
                                <text x={(x1 + x2) / 2 + (x1 === x2 ? 30 : 0)} y={y - 4} textAnchor={x1 === x2 ? 'start' : 'middle'} fontSize={10} fill={cssVar('muted')}>
                                    {s.kind}{notes ? ` · ${notes}` : ''}
                                </text>
                            </g>
                        );
                    })}
                </svg>
            </div>
            {trace.truncated && <p style={muted}>{labels.traceTruncated}</p>}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" onClick={() => void onCopy()} style={button}>{labels.copyMermaid}</button>
                {copy === 'copied' && <span role="status" style={muted}>{labels.copied}</span>}
            </div>
            {copy === 'failed' && (
                <>
                    <p role="status" style={muted}>{labels.copyFailed}</p>
                    <textarea readOnly value={mermaid} aria-label={labels.copyMermaid} rows={6} style={{ width: '100%', font: '12px monospace' }} />
                </>
            )}
        </section>
    );
}
