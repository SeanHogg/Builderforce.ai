/**
 * The path's step controls (Reset, ◀ Step, Step ▶, Run to end): ONE component, so the path strip
 * and the Simulate drawer step the same shared index the same way. "Run to end" also reports the
 * stop it ran from, so the caller can show the most likely walk out of it ({@link LikelyWalk}, PRD 38 P7).
 */

import type { ReactNode } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { muted, CONTROL } from '../styles';
import { pillStyle } from './ui';
import { TYPE } from './ui/type';
import type { WalkHop } from './transitionTable';

const actionStyle = { ...pillStyle(false), height: `calc(${CONTROL} - 4px)`, padding: '0 10px', fontWeight: 600 } as const;

/** A one-shot strip control (Reset, Step, Run to end): a pill that is not a toggle. */
export function Action({ disabled, children, ...rest }: { disabled?: boolean; children: ReactNode; onClick(): void; 'aria-label'?: string; title?: string }) {
    return <button type="button" disabled={disabled} {...rest} style={{ ...actionStyle, ...(disabled ? { opacity: 0.5, cursor: 'default' } : null) }}>{children}</button>;
}

export interface StepControlsProps {
    /** The current step (clamped by the caller) and the last step's index. */
    at: number;
    last: number;
    labels: KnowledgeGraphLabels;
    onStep(n: number): void;
    /** Called with the step "Run to end" was pressed on, before it steps to the end. */
    onRunToEnd?: ((from: number) => void) | undefined;
}

export function StepControls({ at, last, labels, onStep, onRunToEnd }: StepControlsProps) {
    const s = labels.surface;
    return (
        <>
            <Action disabled={last <= 0} onClick={() => onStep(0)}>{s.path.reset}</Action>
            <Action disabled={at <= 0} aria-label={s.pathBack} title={s.pathBack} onClick={() => onStep(at - 1)}><span aria-hidden="true">◀ </span>{s.path.step}</Action>
            <Action disabled={at >= last} aria-label={s.pathNext} title={s.pathNext} onClick={() => onStep(at + 1)}>{s.path.step}<span aria-hidden="true"> ▶</span></Action>
            <Action disabled={at >= last} onClick={() => { onRunToEnd?.(at); onStep(last); }}>{s.path.runToEnd}</Action>
        </>
    );
}

/**
 * The most likely walk out of a station, each hop with its probability. `hops` null ⇒ no transition data: nothing is drawn
 * (never a guess); [] ⇒ the data has no hop out of the station, which is said.
 */
export function LikelyWalk({ from, hops, labels }: { from: string; hops: readonly WalkHop[] | null; labels: KnowledgeGraphLabels }) {
    const t = labels.surface.transition;
    if (hops === null) return null;
    if (hops.length === 0) return <p data-testid="kg-walk-none" style={{ ...muted, ...TYPE.monoMeta, margin: 0 }}>{fillTemplate(t.walkNone, { name: from })}</p>;
    const title = fillTemplate(t.walkTitle, { name: from });
    return (
        <div data-testid="kg-walk" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
            <span style={{ ...muted, ...TYPE.monoMeta }}>{title}</span>
            <ol aria-label={title} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6, minWidth: 0 }}>
                {hops.map((h) => (
                    <li key={`${h.from}>${h.to}`} data-walk-to={h.to} style={{ ...TYPE.monoMeta, overflowWrap: 'anywhere' }}>
                        <span aria-hidden="true">→ </span>{fillTemplate(t.walkHop, { name: h.name, rate: h.rate })}
                    </li>
                ))}
            </ol>
        </div>
    );
}
