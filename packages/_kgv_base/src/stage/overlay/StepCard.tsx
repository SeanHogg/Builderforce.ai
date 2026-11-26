/**
 * The step card on the map side at the code level (PRD 43 B1a rule 9): the open method's current call — its number of
 * the count and its line, the callee and where it is, what the step does (a call, a read, a super call), same file or
 * another, awaited or not — with Into (when the callee's code is loaded, else Open in the host's editor), Previous /
 * Next and Out. With no current call, the method itself, its calls in order and its callers, Step through and Out.
 * What it shows is the code pane's (`useCodeReading`), so the card, the gutter and the stage's numbers move together.
 */

import { useMemo } from 'react';
import { pathOf } from '../../graphModel';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { fileRefOf } from '../../surface/stations';
import { TYPE } from '../../surface/ui/type';
import type { SourceLocation, SymbolRecord } from '../../types';
import { callerIndex, codeTargetOf, isAwaited, type CodeTarget, type StepKind } from '../drill/codeText';
import type { CodeReading } from '../drill/useCodeReading';
import { action, card, chip, chips, kicker } from './cardStyles';

/** The called name of a ref: after `#`, else the ref. */
const calledName = (ref: string): string => ref.slice(ref.lastIndexOf('#') + 1);

/** The label key that names what a step does. */
const KIND_LABEL: Readonly<Record<StepKind, 'kindCalls' | 'kindReads' | 'kindSuper'>> = { calls: 'kindCalls', reads: 'kindReads', extends: 'kindSuper' };

export interface StepCardProps {
    /** The method open at the code level. */
    method: CodeTarget;
    reading: CodeReading;
    records: readonly SymbolRecord[];
    labels: KnowledgeGraphLabels;
    /** Into the current callee (`drillTo`: the code level when it has a mark, else its file in the code pane). */
    onDrill(ref: string): void;
    onOut?: (() => void) | undefined;
    /** The host's editor: a callee whose code is not loaded opens there ("Open"). */
    onOpenSource?: ((location: SourceLocation) => void) | undefined;
    /** The corner it sits in: away from a code pane floating over the stage's right edge. */
    side: 'left' | 'right';
}

export function StepCard({ method, reading, records, labels, onDrill, onOut, onOpenSource, side }: StepCardProps) {
    const t = labels.surface.code;
    const { steps, current, goStep, lineText } = reading;
    const count = steps.length;
    const callers = useMemo(() => callerIndex(records).get(method.ref)?.length ?? 0, [records, method.ref]);
    const out = onOut && <button type="button" data-action="out" onClick={onOut} style={action(false)}>{t.out}</button>;
    const step = current >= 0 ? steps[current] : undefined;
    if (!step) {
        return (
            <section data-step-card aria-label={method.name} style={card(side)}>
                <div style={kicker}><span>{t.codeLevel}</span></div>
                <b style={TYPE.monoTitle}>{method.name}</b>
                <span style={TYPE.monoMeta}>{`${method.path}:${method.startLine}–${method.endLine}`}</span>
                <div style={chips}>
                    {count > 0 && <span style={chip}>{fillTemplate(t.callsInOrder, { count })}</span>}
                    <span data-chip="callers" style={chip}>{fillTemplate(t.callers, { count: callers })}</span>
                </div>
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
    const calleePath = pathOf(fileRefOf(step.to) as Parameters<typeof pathOf>[0]);
    const where = callee ? `${callee.path}:${callee.startLine}` : calleePath;
    // Awaited or not reads the call's own line: known only once the pane has read the text.
    const text = lineText(step.line);
    // Not loaded here: the host's editor opens its file, at its line when a record names one.
    const calleeLine = records.find((r) => r.ref === step.to)?.line ?? 0;
    const open = !callee && onOpenSource && calleePath ? () => onOpenSource({ path: calleePath, startLine: calleeLine > 0 ? calleeLine : 1, endLine: calleeLine > 0 ? calleeLine : 1 }) : undefined;
    return (
        <section data-step-card role="status" aria-label={fillTemplate(t.step, { n: current + 1, count, name })} style={card(side)}>
            <div style={kicker}>
                <span data-step-of>{fillTemplate(t.stepAria, { n: current + 1, count })}</span>
                <span style={{ ...TYPE.meta, textTransform: 'none', letterSpacing: 0, color: cssVar('accent') }}>{fillTemplate(t.atLine, { line: step.line })}</span>
            </div>
            <b data-step-callee style={TYPE.monoTitle}>{name}</b>
            {where && <span style={{ ...TYPE.monoMeta, overflowWrap: 'anywhere' }}>{`→ ${where}`}</span>}
            <div style={chips}>
                <span data-chip="kind" style={chip}>{t[KIND_LABEL[step.kind]]}</span>
                <span data-chip="file" style={chip}>{fileRefOf(step.to) === fileRefOf(method.ref) ? t.sameFile : t.otherFile}</span>
                {text != null && <span data-chip="await" style={chip}>{isAwaited(text) ? t.awaited : t.sync}</span>}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {callee && <button type="button" data-action="drill-callee" onClick={() => onDrill(step.to)} style={action(true)}>{fillTemplate(t.drillCallee, { name })}</button>}
                {open && <button type="button" data-action="open-callee" onClick={open} style={action(true)}>{fillTemplate(t.openCallee, { name })}</button>}
                <button type="button" data-action="prev-step" aria-label={t.prevStep} onClick={() => goStep(current - 1)} style={action(false)}><span aria-hidden="true">‹</span></button>
                <button type="button" data-action="next-step" onClick={() => goStep(current + 1)} style={action(false)}>{t.nextStep}<span aria-hidden="true"> ›</span></button>
                {out}
            </div>
        </section>
    );
}
