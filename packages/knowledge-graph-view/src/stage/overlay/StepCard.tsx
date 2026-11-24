/**
 * The step card on the map side at the code level (PRD 43 B1a rule 9): the open method's current call — its number of
 * the count and its line, the callee and where it is, same file or another — with Into (when the callee's code is
 * loaded), Previous / Next and Out. With no current call, the method itself, its calls in order, Step through and Out.
 * What it shows is the code pane's (`useCodeReading`), so the card, the gutter and the stage's numbers move together.
 */

import type { CSSProperties } from 'react';
import { pathOf } from '../../graphModel';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { fileRefOf } from '../../surface/stations';
import { TYPE } from '../../surface/ui/type';
import type { SymbolRecord } from '../../types';
import { codeTargetOf, type CodeTarget } from '../drill/codeText';
import type { CodeReading } from '../drill/useCodeReading';

const CARD_PX = 258;

const card = (side: 'left' | 'right'): CSSProperties => ({
    position: 'absolute', zIndex: 3, top: 12, [side]: 12, width: `min(${CARD_PX}px, calc(100% - 24px))`, boxSizing: 'border-box',
    display: 'grid', gap: 6, padding: '10px 12px 12px', borderRadius: 10, pointerEvents: 'auto',
    background: cssVar('panel'), color: cssVar('text'), border: `1px solid ${cssVar('border')}`, boxShadow: '0 12px 28px color-mix(in srgb, currentColor 18%, transparent)',
});
const kicker: CSSProperties = { ...TYPE.sectionHeading, display: 'flex', justifyContent: 'space-between', gap: 8 };
const chip: CSSProperties = { ...TYPE.meta, padding: '2px 8px', borderRadius: 99, border: `1px solid ${cssVar('border')}`, background: cssVar('bg') };
const action = (primary: boolean): CSSProperties => ({
    ...TYPE.pill, padding: '4px 9px', borderRadius: 5, cursor: 'pointer',
    border: `1px solid ${cssVar(primary ? 'accent' : 'border')}`, background: cssVar(primary ? 'accent' : 'bg'), color: cssVar(primary ? 'onAccent' : 'text'),
});

/** The called name of a ref: after `#`, else the ref. */
const calledName = (ref: string): string => ref.slice(ref.lastIndexOf('#') + 1);

export interface StepCardProps {
    /** The method open at the code level. */
    method: CodeTarget;
    reading: CodeReading;
    records: readonly SymbolRecord[];
    labels: KnowledgeGraphLabels;
    /** Into the current callee (`drillTo`: the code level when it has a mark, else its file in the code pane). */
    onDrill(ref: string): void;
    onOut?: (() => void) | undefined;
    /** The corner it sits in: away from a code pane floating over the stage's right edge. */
    side: 'left' | 'right';
}

export function StepCard({ method, reading, records, labels, onDrill, onOut, side }: StepCardProps) {
    const t = labels.surface.code;
    const { steps, current, goStep } = reading;
    const count = steps.length;
    const out = onOut && <button type="button" data-action="out" onClick={onOut} style={action(false)}>{t.out}</button>;
    const step = current >= 0 ? steps[current] : undefined;
    if (!step) {
        return (
            <section data-step-card aria-label={method.name} style={card(side)}>
                <div style={kicker}><span>{t.codeLevel}</span></div>
                <b style={TYPE.monoTitle}>{method.name}</b>
                <span style={TYPE.monoMeta}>{`${method.path}:${method.startLine}–${method.endLine}`}</span>
                {count > 0 && <div><span style={chip}>{fillTemplate(t.callsInOrder, { count })}</span></div>}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {count > 0 && <button type="button" data-action="step-through" onClick={() => goStep(0)} style={action(true)}>{t.stepThrough}</button>}
                    {out}
                </div>
                {count > 0 && <p style={{ ...TYPE.bodyMuted, margin: 0 }}>{t.stepNote}</p>}
            </section>
        );
    }
    const name = calledName(step.to);
    const callee = codeTargetOf(step.to, records);
    const where = callee ? `${callee.path}:${callee.startLine}` : pathOf(fileRefOf(step.to) as Parameters<typeof pathOf>[0]);
    return (
        <section data-step-card role="status" aria-label={fillTemplate(t.step, { n: current + 1, count, name })} style={card(side)}>
            <div style={kicker}>
                <span data-step-of>{fillTemplate(t.stepAria, { n: current + 1, count })}</span>
                <span style={{ ...TYPE.meta, textTransform: 'none', letterSpacing: 0, color: cssVar('accent') }}>{fillTemplate(t.atLine, { line: step.line })}</span>
            </div>
            <b data-step-callee style={TYPE.monoTitle}>{name}</b>
            {where && <span style={{ ...TYPE.monoMeta, overflowWrap: 'anywhere' }}>{`→ ${where}`}</span>}
            <div><span style={chip}>{fileRefOf(step.to) === fileRefOf(method.ref) ? t.sameFile : t.otherFile}</span></div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {callee && <button type="button" data-action="drill-callee" onClick={() => onDrill(step.to)} style={action(true)}>{fillTemplate(t.drillCallee, { name })}</button>}
                <button type="button" data-action="prev-step" aria-label={t.prevStep} onClick={() => goStep(current - 1)} style={action(false)}><span aria-hidden="true">‹</span></button>
                <button type="button" data-action="next-step" onClick={() => goStep(current + 1)} style={action(false)}>{t.nextStep}<span aria-hidden="true"> ›</span></button>
                {out}
            </div>
        </section>
    );
}
