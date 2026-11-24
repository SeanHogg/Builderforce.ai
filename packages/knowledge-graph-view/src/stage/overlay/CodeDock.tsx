/**
 * The docked code panel for the selected mark. Built on `CodeLayer`: selection and the journey
 * step scroll it (`scrollLine` → `scrollTopForLine`), and a method name drills (`onDrill` ← `drillRefForName`).
 * The stage follows its reading line (`onFocusSymbol`: the symbol there, or inside the open `method` the current call's
 * callee) while Follow is on; the trail jumps to an enclosing symbol (or, at the code level, back to a drilled method)
 * and Out leaves the code or drilled level. At the code level the calls step (Previous / Next, a step number, "Into"),
 * a stage pick of a callee scrolls to its call, and a stage hover tints that symbol's lines.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { pathOf } from '../../graphModel';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { TYPE } from '../../surface/ui/type';
import { fileRefOf } from '../../surface/stations';
import type { SourceLocation, SourceReader, SymbolRecord } from '../../types';
import { CodeLayer, LINK_BUTTON } from '../drill/CodeLayer';
import { callStepsOf, codeTargetOf, MAX_SPAN, spanInFile, stepAt, stepOfCallee, symbolAtLine, symbolChain, symbolsOfFile, type CodeTarget } from '../drill/codeText';

const dock: CSSProperties = {
    position: 'absolute', zIndex: 4, top: 8, right: 8, bottom: 8, width: 'min(420px, calc(100% - 16px))',
    display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0, pointerEvents: 'auto',
};

const bar: CSSProperties = {
    display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '4px 8px', borderRadius: 8,
    background: cssVar('bg'), color: cssVar('text'), border: `1px solid ${cssVar('border')}`, ...TYPE.meta,
};
const toggle: CSSProperties = { font: 'inherit', padding: '0 8px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${cssVar('border')}`, background: 'transparent', color: 'inherit' };

/** The called name of a ref: after `#`, else the ref. */
const calledName = (ref: string): string => ref.slice(ref.lastIndexOf('#') + 1);

export interface CodeDockProps {
    target: CodeTarget | null;
    /** Shown when the mark has no readable target. */
    name: string;
    reader?: SourceReader | undefined;
    labels: KnowledgeGraphLabels;
    records: readonly SymbolRecord[];
    /** Source line to bring to the top. Selection and the journey step both set it. */
    scrollLine?: number | undefined;
    onDrill(ref: string): void;
    onOpenSource?: ((location: SourceLocation) => void) | undefined;
    onClose(): void;
    /** The symbol on the reading line, or inside `method` the current call's callee (only while Follow is on). */
    onFocusSymbol?: ((ref: string) => void) | undefined;
    /** The method open at the code level: its calls are numbered and the lines outside it dimmed. */
    method?: string | null | undefined;
    /** Leave the code level (or the drilled level); no button when absent. */
    onOut?: (() => void) | undefined;
    /** The methods drilled into at the code level, outermost first; shown as the crumbs instead of the enclosing symbols. */
    trail?: readonly { ref: string; name: string }[] | undefined;
    /** A trail crumb was clicked (its index). */
    onTrail?: ((index: number) => void) | undefined;
    /** The ref picked on the stage at the code level: a callee of `method` scrolls to its call. */
    pick?: string | null | undefined;
    /** The ref hovered on the stage: its lines in this file are tinted. */
    hover?: string | null | undefined;
}

export function CodeDock({ target, name, reader, labels, records, scrollLine, onDrill, onOpenSource, onClose, onFocusSymbol, method = null, onOut, trail, onTrail, pick = null, hover = null }: CodeDockProps) {
    const t = labels.surface.code;
    const path = target?.path;
    const fileSymbols = useMemo(() => path ? symbolsOfFile(records, path) : [], [records, path]);
    const byRef = useMemo(() => new Map(records.map((r) => [r.ref, r])), [records]);
    const steps = useMemo(() => method ? callStepsOf(method, records) : [], [method, records]);
    const span = useMemo(() => method ? codeTargetOf(method, records) : null, [method, records]);
    const [reading, setReading] = useState<number | null>(null);
    const [follow, setFollow] = useState(true);
    // A crumb's line; a new `scrollLine` from selection or the journey takes over again.
    const [jump, setJump] = useState<number | undefined>(undefined);
    useEffect(() => { setJump(undefined); }, [scrollLine]);
    // A step chosen by Previous / Next, its number or a pick: stays current until the reading line leaves its line (two calls on one line).
    const [pinned, setPinned] = useState(-1);
    useEffect(() => { setPinned(-1); }, [method]);
    const current = pinned >= 0 ? pinned : reading == null ? -1 : stepAt(steps, reading, span);
    const chain = useMemo(() => symbolChain(reading == null ? null : symbolAtLine(fileSymbols, reading), byRef), [reading, fileSymbols, byRef]);
    // Only a reading line crossing into another symbol (or call) reaches the stage, not every pixel.
    const last = useRef<string | null>(null);
    useEffect(() => { last.current = null; }, [path, follow]);
    const focus = useCallback((ref: string | null | undefined) => {
        if (!follow || !ref || ref === last.current) return;
        last.current = ref;
        onFocusSymbol?.(ref);
    }, [follow, onFocusSymbol]);
    const onReadingLine = useCallback((line: number) => {
        setReading(line);
        const keep = pinned >= 0 && steps[pinned]?.line === line;
        if (pinned >= 0 && !keep) setPinned(-1);
        const step = keep ? pinned : stepAt(steps, line, span);
        focus(step >= 0 ? steps[step]!.to : symbolAtLine(fileSymbols, line));
    }, [pinned, steps, span, fileSymbols, focus]);
    // Follow turned back on lights the line already being read.
    useEffect(() => { if (follow && reading != null) onReadingLine(reading); }, [follow]); // eslint-disable-line react-hooks/exhaustive-deps
    const goStep = useCallback((i: number) => {
        if (!steps.length) return;
        const k = (i + steps.length) % steps.length;
        setPinned(k);
        setJump(steps[k]!.line);
        focus(steps[k]!.to);
    }, [steps, focus]);
    // A callee picked on the stage: scroll to the call (the open method itself, or one it does not call, does nothing).
    // Keyed on the pick alone: a new method's steps must not re-run the old pick (the wiring clears it only after this effect).
    useEffect(() => { const i = stepOfCallee(steps, pick); if (i >= 0) goStep(i); }, [pick]); // eslint-disable-line react-hooks/exhaustive-deps
    const marked = useMemo(() => path ? spanInFile(hover, records, path) : null, [hover, records, path]);
    const callee = current >= 0 ? steps[current]!.to : null;
    if (!target) {
        return (
            <aside data-code-dock role="complementary" aria-label={fillTemplate(t.buttonAria, { name })} style={{ ...dock, padding: 12, borderRadius: 12, background: cssVar('bg'), color: cssVar('text'), border: `1px solid ${cssVar('border')}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <b>{name || t.button}</b>
                    <button type="button" aria-label={labels.surface.map.card.close} onClick={onClose} style={{ border: 0, background: 'transparent', color: cssVar('muted'), cursor: 'pointer' }}>×</button>
                </div>
                <p role="note" data-code-unavailable style={{ margin: '8px 0 0' }}>{t.unavailable}</p>
            </aside>
        );
    }
    return (
        <aside data-code-dock role="complementary" aria-label={fillTemplate(t.buttonAria, { name: target.name })} style={dock}>
            <div style={bar}>
                <nav aria-label={t.crumbsAria} data-code-crumbs style={{ display: 'flex', gap: 4, flexWrap: 'wrap', minWidth: 0, flex: '1 1 auto' }}>
                    <span>{target.path.slice(target.path.lastIndexOf('/') + 1)}</span>
                    {trail?.length ? trail.map((r, i) => (
                        <span key={r.ref}>
                            <span aria-hidden="true">› </span>
                            <button type="button" data-trail={r.ref} aria-current={i === trail.length - 1 ? 'location' : undefined} onClick={() => onTrail?.(i)} style={LINK_BUTTON}>{r.name}</button>
                        </span>
                    )) : chain.map((r, i) => (
                        <span key={r.ref}>
                            <span aria-hidden="true">› </span>
                            <button type="button" data-crumb={r.ref} aria-current={i === chain.length - 1 ? 'location' : undefined} onClick={() => setJump(r.line)} style={LINK_BUTTON}>{r.name}</button>
                        </span>
                    ))}
                </nav>
                <button type="button" data-action="follow" aria-pressed={follow} onClick={() => setFollow((f) => !f)} style={toggle}>{t.follow}</button>
                {onOut && <button type="button" data-action="out" onClick={onOut} style={toggle}>{t.out}</button>}
                {steps.length > 0 && (
                    <>
                        <button type="button" data-action="prev-step" aria-label={t.prevStep} onClick={() => goStep(current < 0 ? steps.length - 1 : current - 1)} style={toggle}><span aria-hidden="true">‹</span></button>
                        <button type="button" data-action="next-step" aria-label={t.nextStep} onClick={() => goStep(current + 1)} style={toggle}><span aria-hidden="true">›</span></button>
                    </>
                )}
                {callee && codeTargetOf(callee, records) && (
                    <button type="button" data-action="drill-callee" onClick={() => onDrill(callee)} style={toggle}>{fillTemplate(t.drillCallee, { name: calledName(callee) })}</button>
                )}
                {current >= 0 && (
                    <span role="status" data-code-step-status style={{ flexBasis: '100%' }}>
                        {fillTemplate(t.step, { n: current + 1, count: steps.length, name: calledName(steps[current]!.to) })}
                    </span>
                )}
            </div>
            <CodeLayer
                docked slotKey={`node:${target.ref}`} target={target} reader={reader} labels={labels}
                records={records} scrollLine={jump ?? scrollLine} onDrill={onDrill} onOpenSource={onOpenSource} onClose={onClose}
                onReadingLine={onReadingLine} steps={steps} currentStep={current} span={span} onStep={goStep} marked={marked}
            />
        </aside>
    );
}

function readLine(n: object): number {
    if ('line' in n && typeof (n as { line?: unknown }).line === 'number') return (n as { line: number }).line;
    return 0;
}

function isRecord(x: unknown): x is SymbolRecord {
    if (!x || typeof x !== 'object') return false;
    const r = x as SymbolRecord;
    return typeof r.ref === 'string' && typeof r.name === 'string' && typeof r.line === 'number' && r.line > 0;
}

/** Symbols the drill already loaded, else graph nodes that carry a line. */
export function recordsForCode(graph: KnowledgeGraph, drill: object): SymbolRecord[] {
    if ('symbols' in drill && Array.isArray((drill as { symbols?: unknown }).symbols)) {
        const loaded = (drill as { symbols: unknown[] }).symbols.filter(isRecord);
        if (loaded.length > 0) return loaded;
    }
    const out: SymbolRecord[] = [];
    for (const n of graph.nodes) {
        const line = readLine(n);
        if (!(line > 0)) continue;
        if (n.kind !== 'symbol' && n.kind !== 'function' && n.kind !== 'method' && n.kind !== 'class') continue;
        const label = 'label' in n && typeof (n as { label?: unknown }).label === 'string' ? (n as { label: string }).label : n.ref;
        const dot = label.lastIndexOf('.');
        out.push({ ref: n.ref, name: dot >= 0 ? label.slice(dot + 1) : label, kind: n.kind, parent: n.ref, line, exported: false });
    }
    return out;
}

/** The mark's code range: its own record, else the first symbol in its file, else `path:1` when the ref is a file. */
export function targetForMark(ref: string | null, name: string, records: readonly SymbolRecord[]): CodeTarget | null {
    if (!ref) return null;
    const direct = codeTargetOf(ref, records);
    if (direct) return direct;
    const inFile = records.find((r) => r.parent === ref || fileRefOf(r.ref) === ref);
    if (inFile) return codeTargetOf(inFile.ref, records);
    const path = pathOf(ref as Parameters<typeof pathOf>[0]);
    if (!path) return null;
    return { ref, name: name || ref, path, startLine: 1, endLine: MAX_SPAN };
}

/**
 * The code-panel subject for a selected mark. A station key (`st:`) is not itself a symbol: it resolves to the
 * station's first file ref (what `targetForMark` / `focusLine` scroll), and the dock is named with the station.
 * A node key is the ref after `node:`. Anything else is used as-is.
 */
export function codeSubject(key: string | null, station: { name: string; refs: readonly string[] } | null): { ref: string | null; name: string } {
    if (!key) return { ref: null, name: '' };
    if (key.startsWith('node:')) return { ref: key.slice('node:'.length), name: '' };
    if (key.startsWith('st:')) return { ref: station?.refs[0] ?? null, name: station?.name ?? '' };
    return { ref: key, name: '' };
}

/**
 * A journey stop id is a station id, not a symbol. The station's first file is what `focusLine` /
 * `targetForMark` can scroll; a stop that is already a symbol or file ref is used as-is.
 * A station with no files has no source line.
 */
export function codeRefForStop(stopId: string | null, station: { refs: readonly string[] } | null | undefined): string | null {
    if (!stopId) return null;
    if (station) return station.refs[0] ?? null;
    return stopId;
}

/**
 * The source line selection or the journey step should scroll to. Selection wins when both name a line;
 * pass `stopId` alone when the step is what just changed.
 */
export function focusLine(records: readonly SymbolRecord[], ref: string | null, stopId: string | null): number | undefined {
    for (const id of [ref, stopId]) {
        if (!id) continue;
        const hit = records.find((r) => r.ref === id || r.name === id || r.parent === id || fileRefOf(r.ref) === id);
        if (hit && hit.line > 0) return hit.line;
    }
    return undefined;
}
