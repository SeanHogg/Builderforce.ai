/**
 * The code pane (PRD 43 B1a rule 9): the source of the selected mark's file, or at the code level the open method's,
 * beside the stage — the left of the split layout, or floating over the stage's right edge in a narrow box. Built on
 * `CodeLayer`; what it reads (`reading`, `useCodeReading`) is shared with the map side, so the stage follows its
 * reading line while Follow is on. Selection and the journey step scroll it (`scrollLine`), a crumb jumps to an
 * enclosing symbol, a method name drills (`onDrill` ← `drillRefForName`), the open method's calls are numbered in the
 * gutter, a stage hover tints that symbol's lines, and Escape in the code is Out.
 */

import { useMemo, type CSSProperties } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { pathOf } from '../../graphModel';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { TYPE } from '../../surface/ui/type';
import { fileRefOf } from '../../surface/stations';
import type { SourceLocation, SourceReader, SymbolRecord } from '../../types';
import { CodeLayer, LINK_BUTTON } from '../drill/CodeLayer';
import { codeTargetOf, MAX_SPAN, spanInFile, type CodeTarget } from '../drill/codeText';
import type { CodeReading } from '../drill/useCodeReading';

const floating: CSSProperties = {
    position: 'absolute', zIndex: 4, top: 8, right: 8, bottom: 8, width: 'min(420px, calc(100% - 16px))',
    display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0, pointerEvents: 'auto',
};
const filling: CSSProperties = { position: 'absolute', inset: 0, padding: 8, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 };

/** The code's share of a split box (the editor : map of 42 : 58), and the narrowest box that splits (both sides stay usable). */
const CODE_SHARE = 0.42;
export const SPLIT_MIN_PX = 840;

/** The code pane's width beside the map in a box `width` wide; 0 when the box is too narrow and the pane floats over the stage instead. */
export function codePaneWidth(width: number): number {
    return width >= SPLIT_MIN_PX ? Math.round(width * CODE_SHARE) : 0;
}

const bar: CSSProperties = {
    display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '4px 8px', borderRadius: 8,
    background: cssVar('bg'), color: cssVar('text'), border: `1px solid ${cssVar('border')}`, ...TYPE.meta,
};

export interface CodeDockProps {
    target: CodeTarget | null;
    /** Shown when the mark has no readable target. */
    name: string;
    reader?: SourceReader | undefined;
    labels: KnowledgeGraphLabels;
    records: readonly SymbolRecord[];
    /** Source line to bring to the reading line. Selection and the journey step both set it; a crumb or a step wins until it changes (`reading.jump`). */
    scrollLine?: number | undefined;
    /** What the pane reads (`useCodeReading`): the crumbs, the numbered calls, the reading line. */
    reading: CodeReading;
    onDrill(ref: string): void;
    onOpenSource?: ((location: SourceLocation) => void) | undefined;
    onClose(): void;
    /** Escape in the code: out of the code level (or the drilled level). */
    onOut?: (() => void) | undefined;
    /** The ref hovered on the stage: its lines in this file are tinted. */
    hover?: string | null | undefined;
    /** Fill the host's code pane (the split layout) instead of floating over the stage's right edge. */
    pane?: boolean;
}

export function CodeDock({ target, name, reader, labels, records, scrollLine, reading, onDrill, onOpenSource, onClose, onOut, hover = null, pane = false }: CodeDockProps) {
    const t = labels.surface.code;
    const path = target?.path;
    const marked = useMemo(() => path ? spanInFile(hover, records, path) : null, [hover, records, path]);
    const dock = pane ? filling : floating;
    if (!target) {
        return (
            <aside data-code-dock role="complementary" aria-label={fillTemplate(t.buttonAria, { name })} style={{ ...dock, padding: 12, borderRadius: pane ? undefined : 12, background: cssVar('bg'), color: cssVar('text'), border: pane ? undefined : `1px solid ${cssVar('border')}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <b>{name || t.button}</b>
                    <button type="button" aria-label={labels.surface.map.card.close} onClick={onClose} style={{ border: 0, background: 'transparent', color: cssVar('muted'), cursor: 'pointer' }}>×</button>
                </div>
                <p role="note" data-code-unavailable style={{ margin: '8px 0 0' }}>{t.unavailable}</p>
            </aside>
        );
    }
    const { chain } = reading;
    return (
        <aside data-code-dock data-code-pane={pane ? '' : undefined} role="complementary" aria-label={fillTemplate(t.buttonAria, { name: target.name })} style={dock}>
            <div style={bar}>
                <nav aria-label={t.crumbsAria} data-code-crumbs style={{ display: 'flex', gap: 4, flexWrap: 'wrap', minWidth: 0, flex: '1 1 auto' }}>
                    <span>{target.path.slice(target.path.lastIndexOf('/') + 1)}</span>
                    {chain.map((r, i) => (
                        <span key={r.ref}>
                            <span aria-hidden="true">› </span>
                            <button type="button" data-crumb={r.ref} aria-current={i === chain.length - 1 ? 'location' : undefined} onClick={() => reading.jumpTo(r.line)} style={LINK_BUTTON}>{r.name}</button>
                        </span>
                    ))}
                </nav>
            </div>
            <CodeLayer
                target={target} reader={reader} labels={labels} records={records} scrollLine={reading.jump ?? scrollLine}
                onDrill={onDrill} onOpenSource={onOpenSource} onClose={onClose} onOut={onOut}
                onReadingLine={reading.onReadingLine} steps={reading.steps} currentStep={reading.current} span={reading.span} onStep={reading.goStep} marked={marked}
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
