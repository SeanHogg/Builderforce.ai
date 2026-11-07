/**
 * The path's step controls (Reset, ◀ Step, Step ▶, Run to end): ONE component, so the path strip
 * and the Simulate drawer step the same shared index the same way.
 */

import type { ReactNode } from 'react';
import type { KnowledgeGraphLabels } from '../labels';
import { CONTROL } from '../styles';
import { pillStyle } from './ui';

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
}

export function StepControls({ at, last, labels, onStep }: StepControlsProps) {
    const s = labels.surface;
    return (
        <>
            <Action disabled={last <= 0} onClick={() => onStep(0)}>{s.path.reset}</Action>
            <Action disabled={at <= 0} aria-label={s.pathBack} title={s.pathBack} onClick={() => onStep(at - 1)}><span aria-hidden="true">◀ </span>{s.path.step}</Action>
            <Action disabled={at >= last} aria-label={s.pathNext} title={s.pathNext} onClick={() => onStep(at + 1)}>{s.path.step}<span aria-hidden="true"> ▶</span></Action>
            <Action disabled={at >= last} onClick={() => onStep(last)}>{s.path.runToEnd}</Action>
        </>
    );
}
