/**
 * The code pane (PRD 43 B1a rule 9): the source of the selected mark's file, or at the code level the open method's,
 * beside the stage — the left of the split layout, or floating over the stage's right edge in a narrow box. Built on
 * `CodeLayer`; what it reads (`reading`, `useCodeReading`) is shared with the map side, so the stage follows its
 * reading line while Follow is on. Selection and the journey step scroll it (`scrollLine`), a crumb jumps to an
 * enclosing symbol, a method name drills (`onDrill` ← `drillRefForName`), the open method's calls are numbered in the
 * gutter, a stage hover tints that symbol's lines, and Escape in the code is Out.
 *
 * An editor's chrome around it: tabs for the method's file and a callee's opened across, a breadcrumb of folders, file
 * and enclosing symbols, an Outline of the file's symbols, and in the code a type rail, lens lines (a class's
 * references and Show in map, a method's callers and Drill in) and a sticky header of the enclosing symbols.
 */

import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { findingTitle } from '../../findingText';
import { pathOf } from '../../graphModel';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { list } from '../../styles';
import { ShapeGlyph } from '../../surface/LegendGlyph';
import { TYPE } from '../../surface/ui/type';
import { fileRefOf } from '../../surface/stations';
import type { SymbolFacts } from '../../surface/symbolFacts';
import type { SourceLocation, SourceReader, SourceReaderAt, SourceText, SymbolRecord } from '../../types';
import { CodeLayer, RAIL_TONE, type LensAction } from '../drill/CodeLayer';
import { LINK_BUTTON } from '../drill/linkButton';
import {
    baseName, callerIndex, codeTargetOf, lensRows, MAX_SPAN, railKindOf, railKinds, railShape, spanInFile, stickyChain, symbolChain,
    type CodeTarget, type Lens,
} from '../drill/codeText';
import type { LensCtx } from '../drill/lensActions';
import { useCodeDiff, type CodeCompare } from '../drill/useCodeDiff';
import type { CodeReading } from '../drill/useCodeReading';
import { toggleButton as toggle } from './cardStyles';

const floating: CSSProperties = {
    position: 'absolute', zIndex: 4, top: 8, right: 8, bottom: 8, width: 'min(420px, calc(100% - 16px))',
    display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0, pointerEvents: 'auto',
};
/** In the code pane: the rest of its column, under the level tree (the pane owns the header, the say box and the border). */
const filling: CSSProperties = { flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column', background: cssVar('bg') };

/** The design's pane column, `minmax(300px, min(36%, 520px))`; boxes up to 900px wide show ONE of the code and the picture. */
const CODE_SHARE = 0.36;
export const SPLIT_MIN_PX = 901;

/** The code pane's width beside the map in a box `width` wide; 0 when the box is too narrow to split (one half at a time). */
export function codePaneWidth(width: number): number {
    return width >= SPLIT_MIN_PX ? Math.round(Math.max(300, Math.min(width * CODE_SHARE, 520))) : 0;
}

const bar: CSSProperties = {
    display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '4px 8px', borderRadius: 8,
    background: cssVar('bg'), color: cssVar('text'), border: `1px solid ${cssVar('border')}`, ...TYPE.meta,
};
const tab: CSSProperties = {
    ...TYPE.meta, padding: '4px 10px', border: 0, borderBottom: '2px solid', borderRadius: '6px 6px 0 0', background: cssVar('bg'),
    font: 'inherit', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
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
    /** A short message on the stage (a lens's references or callers). */
    toast?: ((message: string) => void) | undefined;
    /** Select a mark by its slot key (`node:<ref>`): a lens's Show in map, an outline row. */
    onSelect?: ((key: string) => void) | undefined;
    /** Ring and centre a symbol's mark on the stage without selecting it (the wiring's `followCode`). */
    followCode?: ((ref: string) => void) | undefined;
    /** The files open in the pane: the open method's (`home`) and a callee's opened across; shown as tabs. */
    files?: { home: string; across: string | null } | undefined;
    /** The home tab clicked while a callee's file is on show: back to the method (the wiring's `clearAcross`). */
    onHomeTab?: (() => void) | undefined;
    /** The symbols' facts, computed once by the wiring (`symbolFacts`): the lens's Simulate / Restructure rows and the gutter's glyphs. */
    facts?: SymbolFacts | undefined;
    /** The symbol whose level you are inside: its lens shows Out. */
    inside?: string | null | undefined;
    /** Simulate / Restructure a symbol (by ref). A lens row whose handler is absent is hidden. */
    onSimulate?: ((ref: string) => void) | undefined;
    onRestructure?: ((ref: string) => void) | undefined;
    /** Hide the pane (the dock's control; `usePanelVisibility`'s `code` slot). */
    onHide?: (() => void) | undefined;
    /** A comparison of files is open (PRD 43 C8): the side on show and the revision each side reads; absent ⇒ today's file, unmarked. */
    compare?: CodeCompare | undefined;
    /** `readSourceAt` bound to the root: the earlier side's reader; absent ⇒ the pane says the earlier version is not available. */
    readerAt?: SourceReaderAt | undefined;
}

const OUTLINE_INDENT_PX = 14;
const ICON_PX = 10;

export function CodeDock({
    target, name, reader, labels, records, scrollLine, reading, onDrill, onOpenSource, onClose, onOut, hover = null, pane = false,
    toast, onSelect, followCode, files, onHomeTab, facts, inside = null, onSimulate, onRestructure, onHide, compare, readerAt,
}: CodeDockProps) {
    const t = labels.surface.code;
    const path = target?.path;
    const { chain, fileSymbols, byRef, jumpTo } = reading;
    // While comparing, the pane reads the chosen side and marks the lines the other side lacks; one `onText` feeds both readers of the text.
    const diff = useCodeDiff(compare, reader, readerAt, path);
    const { onText: diffText } = diff, readingText = reading.onText;
    const onText = useCallback((text: SourceText) => { readingText(text); diffText(text); }, [readingText, diffText]);
    const marked = useMemo(() => path ? spanInFile(hover, records, path) : null, [hover, records, path]);
    // The editor chrome needs the text: with no reader the pane only says the code is not available here.
    const lens = useMemo(() => reader ? lensRows(fileSymbols, records, callerIndex(records)) : null, [reader, fileSymbols, records]);
    const rails = useMemo(() => reader ? railKinds(fileSymbols, records) : null, [reader, fileSymbols, records]);
    const readingRef = chain[chain.length - 1]?.ref ?? null;
    const railSpan = useMemo(() => path ? spanInFile(readingRef, records, path) : null, [readingRef, records, path]);
    const sticky = useCallback((line: number) => stickyChain(fileSymbols, byRef, line), [fileSymbols, byRef]);
    const nameOf = useCallback((ref: string) => byRef.get(ref)?.name ?? ref, [byRef]);
    // The new rows exist only with a handler (`has`); the four old links always show.
    const lensCtx = useMemo<LensCtx | null>(() => {
        if (!facts) return null;
        const handled: Partial<Record<LensAction, boolean>> = { out: !!onOut, simulate: !!onSimulate, restructure: !!onRestructure };
        return { facts, inside, has: (id) => handled[id] ?? true, kindName: (kind) => findingTitle({ kind }, labels) };
    }, [facts, inside, onOut, onSimulate, onRestructure, labels]);
    const onLens = useCallback((action: LensAction, l: Lens) => {
        if (action === 'out') onOut?.();
        else if (action === 'simulate') onSimulate?.(l.ref);
        else if (action === 'restructure') onRestructure?.(l.ref);
        else if (action === 'drill') onDrill(l.ref);
        else if (action === 'show') { onSelect?.(`node:${l.ref}`); followCode?.(l.ref); }
        else if (action === 'references') toast?.(fillTemplate(t.referencesToast, { count: l.count, name: nameOf(l.ref) }));
        else {
            const callers = callerIndex(records).get(l.ref) ?? [];
            toast?.(callers.length ? fillTemplate(t.calledBy, { names: callers.map(nameOf).join(', ') }) : fillTemplate(t.lensCallers, { count: 0 }));
        }
    }, [onDrill, onSelect, followCode, toast, t, nameOf, records, onOut, onSimulate, onRestructure]);
    const [outline, setOutline] = useState(false);
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
    const folders = target.path.split('/');
    const file = folders.pop() ?? target.path;
    // The outline marks the symbol being read, else the one the pane opened on.
    const currentRef = readingRef ?? target.ref;
    const tabs = files ? [...new Set([files.home, files.across].filter((p): p is string => !!p))] : [];
    return (
        <aside data-code-dock data-code-pane={pane ? '' : undefined} role="complementary" aria-label={fillTemplate(t.buttonAria, { name: target.name })} style={dock}>
            {tabs.length > 0 && (
                <div role="tablist" aria-label={t.tabsAria} data-code-tabs style={{ display: 'flex', gap: 2, minWidth: 0, overflow: 'hidden' }}>
                    {tabs.map((p) => {
                        const on = p === target.path;
                        const go = !on && p === files?.home ? onHomeTab : undefined;
                        return (
                            <button
                                key={p} type="button" role="tab" aria-selected={on} data-code-tab={p} title={p} onClick={go}
                                style={{ ...tab, borderBottomColor: cssVar(on ? 'accent' : 'border'), color: cssVar(on ? 'text' : 'muted'), cursor: go ? 'pointer' : 'default' }}
                            >
                                {baseName(p)}
                            </button>
                        );
                    })}
                </div>
            )}
            <div style={bar}>
                <nav aria-label={t.crumbsAria} data-code-crumbs style={{ display: 'flex', gap: 4, flexWrap: 'wrap', minWidth: 0, flex: '1 1 auto' }}>
                    {folders.map((f, i) => (
                        <span key={`dir:${i}`} data-crumb-folder style={{ color: cssVar('muted') }}>{f}<span aria-hidden="true"> ›</span></span>
                    ))}
                    <b data-crumb-file>{file}</b>
                    {chain.map((r, i) => (
                        <span key={r.ref}>
                            <span aria-hidden="true">› </span>
                            <button type="button" data-crumb={r.ref} aria-current={i === chain.length - 1 ? 'location' : undefined} onClick={() => jumpTo(r.line)} style={LINK_BUTTON}>{r.name}</button>
                        </span>
                    ))}
                </nav>
                <span data-file-note style={{ color: cssVar('muted'), whiteSpace: 'nowrap', marginInlineStart: 'auto' }}>
                    {target.startLine === target.endLine ? fillTemplate(t.fileLine, { line: target.startLine }) : fillTemplate(t.fileLines, { from: target.startLine, to: target.endLine })}
                </span>
                {fileSymbols.length > 0 && (
                    <button type="button" data-action="outline" aria-expanded={outline} onClick={() => setOutline((o) => !o)} style={{ ...toggle, borderColor: cssVar(outline ? 'accent' : 'border') }}>{t.outline}</button>
                )}
                {onHide && !pane && <button type="button" data-action="dock-hide" aria-label={t.dockHide} title={t.dockHide} onClick={onHide} style={toggle}><span aria-hidden="true">‹</span></button>}
            </div>
            {outline && fileSymbols.length > 0 && (
                <ul aria-label={t.outlineAria} data-code-outline style={{ ...list, ...bar, display: 'grid', gap: 0, maxHeight: '40%', overflow: 'auto', flex: '0 1 auto' }}>
                    {fileSymbols.map((r) => {
                        const kind = railKindOf(r.kind);
                        return (
                            <li key={r.ref}>
                                <button
                                    type="button" data-outline-row={r.ref} aria-current={r.ref === currentRef ? 'true' : undefined}
                                    onClick={() => { onSelect?.(`node:${r.ref}`); jumpTo(r.line); }}
                                    style={{
                                        ...LINK_BUTTON, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
                                        paddingLeft: (symbolChain(r.ref, byRef).length - 1) * OUTLINE_INDENT_PX,
                                        fontWeight: r.ref === currentRef ? 700 : undefined, background: r.ref === currentRef ? cssVar('accentSoft') : 'transparent',
                                    }}
                                >
                                    <ShapeGlyph shape={railShape(kind)} tone={RAIL_TONE[kind]} size={ICON_PX} />
                                    <span>{r.name}</span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
            <CodeLayer
                target={target} reader={diff.reader} labels={labels} records={records} scrollLine={reading.jump ?? scrollLine}
                onDrill={onDrill} onOpenSource={onOpenSource} onClose={onClose} onOut={onOut}
                onReadingLine={reading.onReadingLine} steps={reading.steps} currentStep={reading.current} span={reading.span} onStep={reading.goStep} marked={marked}
                onViewport={reading.onViewport} onText={onText} onPickLine={reading.pickLine} cursorLine={reading.cursor} marks={diff.marks} diffNote={diff.unavailable} movedTo={diff.movedTo}
                rails={rails} railSpan={railSpan} lens={lens} onLens={onLens} lensCtx={lensCtx} sticky={sticky} onJump={jumpTo}
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
