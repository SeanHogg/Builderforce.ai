/**
 * The code level's Sequence layout: the open method's calls as a sequence diagram over the map pane — the method's
 * lifeline first, then one per distinct callee in call order, one arrow per call with its number. The current call is
 * in the call colour; a press on an arrow reads that call (`goStep`). The Flow layout is the stage itself (call arcs and
 * `CallBadges`). The grid is the path strip's (`SEQUENCE_GEOMETRY`); colours are tokens.
 */

import { useMemo } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { SEQUENCE_GEOMETRY } from '../../surface/SequenceDiagram';
import { FONT_MONO, FONT_UI, TYPE } from '../../surface/ui/type';
import type { SymbolRecord } from '../../types';
import type { CallStep } from '../drill/codeText';

const { COL_W, HEAD_H, ROW_H } = SEQUENCE_GEOMETRY;
const NAME_MAX = 18;
const ACTIVATION_W = 8;

export interface CodeSequenceProps {
    /** The open method's name. */
    method: string;
    steps: readonly CallStep[];
    /** The index into `steps` of the current call; -1 for none. */
    current: number;
    byRef: ReadonlyMap<string, SymbolRecord>;
    labels: KnowledgeGraphLabels;
    onStep(index: number): void;
}

const short = (name: string): string => (name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name);
/** The called name of a ref: after `#`, else the ref. */
const calledName = (ref: string): string => ref.slice(ref.lastIndexOf('#') + 1);

export function CodeSequence({ method, steps, current, byRef, labels, onStep }: CodeSequenceProps) {
    const t = labels.surface.code;
    // Lifeline 0 is the method; each distinct callee follows, in the order it is first called.
    const callees = useMemo(() => [...new Set(steps.map((s) => s.to))], [steps]);
    const width = (callees.length + 1) * COL_W;
    const height = HEAD_H + steps.length * ROW_H + 12;
    const x = (i: number) => i * COL_W + COL_W / 2;
    const names = [method, ...callees.map((ref) => byRef.get(ref)?.name ?? calledName(ref))];
    return (
        <div data-code-sequence style={{ position: 'absolute', inset: 0, overflow: 'auto', background: cssVar('bg'), zIndex: 0 }}>
            <svg role="group" aria-label={t.sequence} width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', color: cssVar('text') }}>
                {names.map((name, i) => (
                    <g key={i === 0 ? 'method' : callees[i - 1]} data-lifeline={i === 0 ? 'method' : callees[i - 1]}>
                        <line x1={x(i)} x2={x(i)} y1={HEAD_H} y2={height} stroke={cssVar(i === 0 ? 'accent' : 'edge')} strokeWidth={1} strokeDasharray="4 4" />
                        <rect x={x(i) - COL_W / 2 + 8} y={4} width={COL_W - 16} height={HEAD_H - 10} rx={8} fill={cssVar(i === 0 ? 'accentSoft' : 'panel')} stroke={cssVar(i === 0 ? 'accent' : 'border')} />
                        <text x={x(i)} y={4 + (HEAD_H - 10) / 2 + 4} textAnchor="middle" fontFamily={FONT_UI} fontSize={TYPE.body.fontSize} fill={cssVar('text')}>{short(name)}</text>
                    </g>
                ))}
                {steps.length > 0 && <rect data-activation x={x(0) - ACTIVATION_W / 2} y={HEAD_H} width={ACTIVATION_W} height={height - HEAD_H - 4} fill={cssVar('accentSoft')} stroke={cssVar('accent')} />}
                {steps.map((step, i) => {
                    const to = x(1 + callees.indexOf(step.to));
                    const y = HEAD_H + (i + 1) * ROW_H - 8;
                    const active = i === current;
                    const color = cssVar(active ? 'partner' : 'accent');
                    const n = i + 1;
                    const label = fillTemplate(t.stepAria, { n, count: steps.length });
                    return (
                        <g
                            key={i} role="button" tabIndex={0} data-message={n} data-active={active || undefined} aria-label={label} aria-current={active ? 'step' : undefined}
                            style={{ cursor: 'pointer' }} onClick={() => onStep(i)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStep(i); } }}
                        >
                            <line x1={x(0) + ACTIVATION_W / 2} x2={to - 4} y1={y} y2={y} stroke={color} strokeWidth={active ? 2.5 : 1.5} />
                            <path d={`M ${to - 4} ${y} l -7 -4 v 8 z`} fill={color} />
                            <circle cx={x(0) + ACTIVATION_W / 2 + 14} cy={y - 10} r={8} fill={color} />
                            <text x={x(0) + ACTIVATION_W / 2 + 14} y={y - 7} textAnchor="middle" fontFamily={FONT_MONO} fontSize={TYPE.mono.fontSize} fill={cssVar('onAccent')}>{n}</text>
                            <text x={(x(0) + to) / 2 + 12} y={y - 6} textAnchor="middle" fontFamily={FONT_MONO} fontSize={TYPE.mono.fontSize} fill={color}>{calledName(step.to)}</text>
                        </g>
                    );
                })}
            </svg>
        </div>
    );
}
