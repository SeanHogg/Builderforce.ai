/**
 * The Sequence camera (PRD 38, Option B+): a lifeline per stop of the path, a message per hop
 * labelled with the edge kind and its reference count, the step highlighted in step with the
 * path strip. A hop that skips or climbs a layer is drawn in the violation colour; a hop with
 * no reference between its two stops is dashed and says so. *Copy as Mermaid* exports exactly
 * what is drawn.
 */

import { useId, useMemo } from 'react';
import { CopiedNote, CopyFallback, useCopyText } from '../copyText';
import { fillTemplate } from '../labels';
import { edgeKindLabel } from '../names';
import { cssVar, type ThemeTone } from '../scene/themeColors';
import { button, muted } from '../styles';
import type { PathHop } from './path';
import type { SceneProps } from './registry';
import { sequenceOf, toSequenceMermaid } from './sequenceModel';

const COL_W = 150;
const HEAD_H = 40;
const ROW_H = 40;
const ARROW_TONES: readonly ThemeTone[] = ['edge', 'accent', 'violation'];

export function SequenceDiagram({ labels, surface }: SceneProps) {
    const s = labels.surface;
    const { path, step, setStep } = surface;
    // Arrowheads are markers of an explicit token each; the id is per instance, so two diagrams on a page never share one.
    const uid = useId().replace(/:/g, '');
    const seq = useMemo(() => sequenceOf(path), [path]);
    const copier = useCopyText();
    const say = (hop: PathHop) => (hop.count === 0 ? s.noDirectReference : fillTemplate(s.pathHop, { kind: edgeKindLabel(labels, hop.kind), count: hop.count }));
    const mermaid = useMemo(() => toSequenceMermaid(seq, say), [seq, labels]); // eslint-disable-line react-hooks/exhaustive-deps
    if (seq.lifelines.length < 2) return <p style={{ ...muted, padding: 12 }}>{s.sequence.empty}</p>;

    const width = seq.lifelines.length * COL_W;
    const height = HEAD_H + seq.messages.length * ROW_H + 12;
    const x = (i: number) => i * COL_W + COL_W / 2;
    const at = Math.min(Math.max(step, 0), seq.lifelines.length - 1);

    return (
        <div data-testid="kg-sequence" style={{ display: 'grid', gap: 8, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" style={button} onClick={() => void copier.copy(mermaid)}>{labels.copyMermaid}</button>
                <CopiedNote status={copier.status} labels={labels} />
                <span style={muted}>{fillTemplate(s.sequence.description, { stops: seq.lifelines.length, messages: seq.messages.length })}</span>
            </div>
            <CopyFallback status={copier.status} text={mermaid} label={labels.copyMermaid} labels={labels} />
            <div style={{ overflowX: 'auto' }}>
                <svg role="group" aria-label={labels.regionLabel} width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', color: cssVar('text') }}>
                    <defs>
                        {ARROW_TONES.map((tone) => (
                            <marker key={tone} id={`${uid}-${tone}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                                <path d="M 0 0 L 10 5 L 0 10 z" fill={cssVar(tone)} />
                            </marker>
                        ))}
                    </defs>
                    {seq.lifelines.map((stop, i) => (
                        <g
                            key={stop.id} role="button" tabIndex={0} data-lifeline={stop.id} aria-current={i === at ? 'step' : undefined}
                            aria-label={stop.name} style={{ cursor: 'pointer' }} onClick={() => setStep(i)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStep(i); } }}
                        >
                            <line x1={x(i)} x2={x(i)} y1={HEAD_H} y2={height} stroke={cssVar(i === at ? 'accent' : 'edge')} strokeWidth={i === at ? 2.5 : 1} strokeDasharray={i === at ? undefined : '4 4'} />
                            <rect x={x(i) - COL_W / 2 + 8} y={4} width={COL_W - 16} height={HEAD_H - 10} rx={8} fill={i === at ? cssVar('accentSoft') : cssVar('panel')} stroke={cssVar(i === at ? 'accent' : 'border')} />
                            <text x={x(i)} y={4 + (HEAD_H - 10) / 2 + 4} textAnchor="middle" fontSize={12} fontWeight={i === at ? 700 : 500} fill={cssVar('text')}>
                                {stop.name.length > 18 ? `${stop.name.slice(0, 17)}…` : stop.name}
                            </text>
                        </g>
                    ))}
                    {seq.messages.map((m) => {
                        const y = HEAD_H + (m.from + 1) * ROW_H - 8;
                        const bad = m.hop.verdict === 'skips' || m.hop.verdict === 'upward';
                        const none = m.hop.count === 0;
                        const active = m.to === at;
                        const tone: ThemeTone = bad ? 'violation' : active ? 'accent' : 'edge';
                        const color = cssVar(tone);
                        const text = say(m.hop) + (m.hop.verdict === 'skips' ? ` · ${labels.traceSkips}` : m.hop.verdict === 'upward' ? ` · ${labels.traceUpward}` : '');
                        return (
                            <g
                                key={`${m.from}:${m.to}`} data-message={`${m.from}-${m.to}`} data-active={active || undefined} data-direct={none ? 'false' : undefined}
                                aria-label={fillTemplate(s.sequence.messageAria, { from: seq.lifelines[m.from]!.name, to: seq.lifelines[m.to]!.name, label: text })} role="img"
                            >
                                <line
                                    x1={x(m.from)} x2={x(m.to) - 4} y1={y} y2={y} stroke={color} strokeWidth={active ? 2.5 : 1.5}
                                    strokeDasharray={none ? '5 4' : undefined} markerEnd={`url(#${uid}-${tone})`}
                                />
                                <text x={(x(m.from) + x(m.to)) / 2} y={y - 6} textAnchor="middle" fontSize={11} fill={color} fontWeight={active ? 700 : 400}>{text}</text>
                            </g>
                        );
                    })}
                </svg>
            </div>
        </div>
    );
}
