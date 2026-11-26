/**
 * The code pane's source (PRD 43 B1a rule 9, deepest zoom): a file's source, read through the host's `readSource` port
 * (range by symbol span, `codeTargetOf`), filling the code pane (`CodeDock`). Read-only here (editing is the editing
 * PRD's). Monospace and syntax-light (`syntaxLight`, no highlighter dependency), coloured by theme tokens, virtualized
 * past `VIRTUAL_AFTER` rows. "Open at line" hands over to the host's editor (`onOpenSource`); Escape in the lines is Out.
 *
 * The docked pane adds an editor's chrome, all optional: a type rail in the gutter (`rails`), a lens line above each
 * class and method (`lens`, one row tall like every row, so the virtualized panel stays fixed-height and a row index
 * stays an offset: `codeRows`), a sticky header naming the enclosing symbols (`sticky`), and a clicked line read
 * instead of the reading line (`onPickLine` / `cursorLine`).
 *
 * No port (the web has no file contents) or a refused read: the panel shows `path:line`, says the code is not
 * available here, and still offers "Open at line" when the host can open one.
 */

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar, type ThemeTone } from '../../scene/themeColors';
import { CONTROL } from '../../styles';
import { ShapeGlyph } from '../../surface/LegendGlyph';
import { actionGlyph, type ActionGlyphName } from '../../surface/ui/glyphs';
import { TYPE } from '../../surface/ui/type';
import type { SourceLocation, SourceReader, SourceText, SymbolRecord } from '../../types';
import {
    codeRows, drillRefForName, railShape, readingLineAt, scrollTopForLine, syntaxLight, visibleWindow, VIRTUAL_AFTER,
    type CallStep, type CodeTarget, type Lens, type RailKind, type TokenKind,
} from './codeText';
import type { CodeMarks } from './codeDiff';
import { LINK_BUTTON } from './linkButton';
import { visibleLensActions, type LensActionId, type LensCtx } from './lensActions';

export interface CodeLayerProps {
    target: CodeTarget;
    reader?: SourceReader | undefined;
    labels: KnowledgeGraphLabels;
    onOpenSource?: ((location: SourceLocation) => void) | undefined;
    onClose(): void;
    /** Escape in the lines: out of the code level (or the drilled level). */
    onOut?: (() => void) | undefined;
    /** Scroll this source line into view (`scrollTopForLine`: the reading line when following, else the top). Selection and the journey step drive it. */
    scrollLine?: number | undefined;
    /** Loaded symbols: a method name in the text drills to one (`drillRefForName`). */
    records?: readonly SymbolRecord[] | undefined;
    /** A method name in the text was clicked. */
    onDrill?: ((ref: string) => void) | undefined;
    /** The source line on the reading line (`READING_AT` down the panel) whenever it changes; the panel highlights that row. */
    onReadingLine?: ((line: number) => void) | undefined;
    /** The open method's numbered calls (`callStepsOf`): a badge in the gutter on each call's line. */
    steps?: readonly CallStep[] | undefined;
    /** The index into `steps` of the current call (`stepAt`), -1 for none. */
    currentStep?: number | undefined;
    /** The open method's lines; rows outside it are dimmed. */
    span?: { startLine: number; endLine: number } | null | undefined;
    /** A step number was clicked (its index into `steps`); the badges are buttons when given. */
    onStep?: ((index: number) => void) | undefined;
    /** The lines of the symbol hovered on the stage; those rows are tinted. */
    marked?: { startLine: number; endLine: number } | null | undefined;
    /** The source lines on screen whenever they change (after a scroll or a measure). */
    onViewport?: ((first: number, last: number) => void) | undefined;
    /** The text read, once per read. */
    onText?: ((text: SourceText) => void) | undefined;
    /** A row was clicked: read that line (`useCodeReading.pickLine`). */
    onPickLine?: ((line: number) => void) | undefined;
    /** A clicked line: it is the reading row until the code scrolls. */
    cursorLine?: number | null | undefined;
    /** The innermost symbol kind per line (`railKinds`): a type rail before the line number. */
    rails?: ReadonlyMap<number, RailKind> | null | undefined;
    /** The lines of the symbol being read: their rail is the accent. */
    railSpan?: { startLine: number; endLine: number } | null | undefined;
    /** A lens line above each class and method (`lensRows`). */
    lens?: ReadonlyMap<number, Lens> | null | undefined;
    /** A lens link was clicked. */
    onLens?: ((action: LensAction, lens: Lens) => void) | undefined;
    /** The facts, the level you are inside and the handlers that exist (`lensActions`): adds the out / simulate / restructure rows and the gutter's glyphs. */
    lensCtx?: LensCtx | null | undefined;
    /** The enclosing symbols pinned above the code for its top line (`stickyChain`). */
    sticky?: ((firstLine: number) => readonly SymbolRecord[]) | undefined;
    /** A sticky row was clicked: go to its line. */
    onJump?: ((line: number) => void) | undefined;
    /** While comparing (PRD 43 C8): the lines of this version the other lacks, as data; tinted `--kg-diff-added` / `--kg-diff-removed`. */
    marks?: CodeMarks | null | undefined;
    /** Comparing, and the earlier version cannot be read here: today's file is shown, and the pane says so. */
    diffNote?: boolean | undefined;
    /** A restructure: the new modules the marked (removed) definitions move to, named in a note. */
    movedTo?: readonly string[] | undefined;
}

/** A lens link (`LENS_ACTIONS`): a class's references, Show in map; a method's callers, Drill in; and Out, Simulate, Restructure. */
export type LensAction = LensActionId;

/** One code row's height (px), and the rows a virtualized panel renders before it has measured itself. */
export const ROW_PX = 18;
const VIEW_ROWS = 16;
// The mockup's tints: the reading line a faint neutral band, a hovered symbol's lines the stronger accent, the rest of the file dimmed.
const READING_TINT = `color-mix(in srgb, ${cssVar('text')} 5%, transparent)`;
const MARKED_TINT = `color-mix(in srgb, ${cssVar('accent')} 14%, transparent)`;
const OUTSIDE_OPACITY = 0.3;
/** A compare's marked lines: a faint wash and a bar on the edge, so neither tint nor colour alone says it (`data-diff` does too). */
const DIFF_WASH = { added: `color-mix(in srgb, ${cssVar('diffAdded')} 16%, transparent)`, removed: `color-mix(in srgb, ${cssVar('diffRemoved')} 16%, transparent)` } as const;
const DIFF_BAR = { added: cssVar('diffAdded'), removed: cssVar('diffRemoved') } as const;
const RAIL_PX = 3;
/** The gutter's glyph column (a symbol's shape on its first line), and the mark inside it. */
const GLYPH_PX = 14;
const STICKY_SHADOW = '0 2px 6px color-mix(in srgb, currentColor 18%, transparent)';

/** The gutter rail's tone per symbol kind (the rows of the symbol being read take the accent instead). */
export const RAIL_TONE: Readonly<Record<RailKind, ThemeTone>> = { class: 'line3', method: 'nodeSymbol', field: 'nodeEntity' };

const TOKEN_TONE: Readonly<Record<TokenKind, ThemeTone>> = { plain: 'text', comment: 'muted', string: 'line3', number: 'line5', keyword: 'accent' };

/** A method name drills into that symbol (`drillRefForName`); keywords and unknown names stay text. */
function CodeToken({ tok, path, records, onDrill, drillAria }: { tok: { text: string; kind: TokenKind }; path: string; records: readonly SymbolRecord[]; onDrill?: ((ref: string) => void) | undefined; drillAria: string }) {
    const ref = tok.kind === 'plain' && onDrill ? drillRefForName(tok.text, records, path) : null;
    if (!ref || !onDrill) return <span style={tok.kind === 'plain' ? undefined : { color: cssVar(TOKEN_TONE[tok.kind]) }}>{tok.text}</span>;
    return (
        <button type="button" data-code-drill={ref} aria-label={fillTemplate(drillAria, { name: tok.text })} onClick={(e) => { e.stopPropagation(); onDrill(ref); }} style={LINK_BUTTON}>
            {tok.text}
        </button>
    );
}

/** A call's number in the gutter, on the accent; the current call's on the partner amber (as on the stage). A button that goes to the call when `onClick` is given. */
function StepBadge({ n, count, current, aria, onClick }: { n: number; count: number; current: boolean; aria: string; onClick?: (() => void) | undefined }) {
    const style: CSSProperties = { display: 'inline-block', minWidth: '2ch', borderRadius: 8, ...TYPE.meta, fontWeight: 700, lineHeight: `${ROW_PX - 4}px`, background: cssVar(current ? 'partner' : 'accent'), color: cssVar('onAccent') };
    const props = { 'data-code-step': n, 'data-current': current ? '' : undefined, 'aria-label': fillTemplate(aria, { n, count }) };
    if (!onClick) return <span {...props} style={style}>{n}</span>;
    return <button type="button" {...props} onClick={(e) => { e.stopPropagation(); onClick(); }} style={{ ...style, border: 0, padding: 0, font: 'inherit', cursor: 'pointer' }}>{n}</button>;
}

type Read = { state: 'loading' } | { state: 'ready'; text: SourceText } | { state: 'none' };

/** The read of `target`'s lines; `none` with no port, on a refusal or a failure. A newer target drops an older answer. */
function useSourceLines(reader: SourceReader | undefined, target: CodeTarget): Read {
    const [read, setRead] = useState<Read>(reader ? { state: 'loading' } : { state: 'none' });
    useEffect(() => {
        if (!reader) { setRead({ state: 'none' }); return undefined; }
        let live = true;
        setRead({ state: 'loading' });
        reader(target.path, { startLine: target.startLine, endLine: target.endLine }).then(
            (text) => { if (live) setRead(text && text.lines.length > 0 ? { state: 'ready', text } : { state: 'none' }); },
            () => { if (live) setRead({ state: 'none' }); },
        );
        return () => { live = false; };
    }, [reader, target.path, target.startLine, target.endLine]);
    return read;
}

const button: CSSProperties = {
    minHeight: CONTROL, padding: '0 10px', borderRadius: 7, cursor: 'pointer', font: 'inherit', ...TYPE.pill,
    border: `1px solid ${cssVar('accent')}`, background: cssVar('accent'), color: cssVar('onAccent'),
};

/** A lens link: muted, the acting one (Show in map, Drill in) on the accent; plain text when nothing handles it. */
function LensLink({ text, glyph, go = false, onClick }: { text: string; glyph?: ActionGlyphName | undefined; go?: boolean | undefined; onClick?: (() => void) | undefined }) {
    const style: CSSProperties = { color: cssVar(go ? 'accent' : 'muted') };
    const body = <>{glyph && <span aria-hidden="true" style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 4 }}>{actionGlyph(glyph)}</span>}{text}</>;
    if (!onClick) return <span style={style}>{body}</span>;
    return <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} style={{ ...LINK_BUTTON, ...style, textDecoration: 'none' }}>{body}</button>;
}

/** The lens line above a definition: the visible rows of `LENS_ACTIONS`, drawn in order (no branch per action here). */
function LensLine({ lens, labels, ctx, onLens }: { lens: Lens; labels: KnowledgeGraphLabels; ctx: LensCtx | null; onLens?: ((action: LensAction, lens: Lens) => void) | undefined }) {
    const t = labels.surface.code;
    return (
        <>
            {visibleLensActions(lens, ctx).map((row, i) => (
                <Fragment key={row.id}>
                    {i > 0 && ' · '}
                    <LensLink go={row.go} glyph={row.glyph} text={row.label(t, lens, ctx)} onClick={onLens ? () => onLens(row.id, lens) : undefined} />
                </Fragment>
            ))}
        </>
    );
}

export function CodeLayer({
    target, reader, labels, onOpenSource, onClose, onOut, scrollLine, records = [], onDrill, onReadingLine, steps, currentStep = -1, span, onStep, marked,
    onViewport, onText, onPickLine, cursorLine, rails, railSpan, lens, onLens, lensCtx = null, sticky, onJump, marks, diffNote, movedTo,
}: CodeLayerProps) {
    const t = labels.surface.code, card = labels.surface.map.card;
    const linesRef = useRef<HTMLDivElement | null>(null);
    const read = useSourceLines(reader, target);
    const lines = read.state === 'ready' ? read.text.lines : [];
    const first = read.state === 'ready' ? read.text.startLine : target.startLine;
    const tokens = useMemo(() => syntaxLight(lines), [lines]);
    // Source rows with a lens row above each lens line; every row is ROW_PX, so scrolling works in rows and maps to lines.
    const layout = useMemo(() => codeRows(lines.length, first, lens), [lines.length, first, lens]);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewPx, setViewPx] = useState(0);
    useLayoutEffect(() => { setViewPx(linesRef.current?.clientHeight ?? 0); }, [read.state]);
    useEffect(() => { if (read.state === 'ready') onText?.(read.text); }, [read, onText]);
    // Only a following panel has a reading line below the top; the anchored layer keeps scrolling lines to the top.
    const lead = onReadingLine ? viewPx : 0;
    // Selection and the journey step both hand a source line; the panel scrolls so that line is the one on show.
    useEffect(() => {
        if (scrollLine == null) return;
        const top = scrollTopForLine(layout.rowOfLine(scrollLine), 0, ROW_PX, lead);
        setScrollTop(top);
        if (linesRef.current && linesRef.current.scrollTop !== top) linesRef.current.scrollTop = top;
    }, [scrollLine, layout, lead]);
    const reading = layout.lineAtRow(readingLineAt(scrollTop, lead, 0, ROW_PX));
    // Reported when the line moves, not when a handler is new (a re-run would drop a clicked line or a pinned step).
    const reported = useRef<number | null>(null);
    useEffect(() => {
        if (read.state !== 'ready') { reported.current = null; return; }
        if (reported.current === reading) return;
        reported.current = reading;
        onReadingLine?.(reading);
    }, [reading, read.state, onReadingLine]);
    // The first call on a line owns its badge.
    const stepByLine = useMemo(() => {
        const m = new Map<number, number>();
        steps?.forEach((s, i) => { if (!m.has(s.line)) m.set(s.line, i); });
        return m;
    }, [steps]);
    const stepCount = steps?.length ?? 0;
    const total = layout.rows.length;
    const { from, to } = visibleWindow(total, scrollTop, ROW_PX, viewPx > 0 ? Math.ceil(viewPx / ROW_PX) : VIEW_ROWS);
    const virtual = total > VIRTUAL_AFTER;
    // The lines on screen: the rows the panel's height shows (before it has measured, the rows it renders).
    const viewFirst = layout.lineAtRow(Math.floor(scrollTop / ROW_PX));
    const viewLast = layout.lineAtRow(viewPx > 0 ? Math.ceil((scrollTop + viewPx) / ROW_PX) - 1 : to - 1);
    const viewed = useRef('');
    useEffect(() => {
        if (read.state !== 'ready') { viewed.current = ''; return; }
        const key = `${viewFirst}:${viewLast}`;
        if (viewed.current === key) return;
        viewed.current = key;
        onViewport?.(viewFirst, viewLast);
    }, [viewFirst, viewLast, read.state, onViewport]);
    const stuck = useMemo(() => read.state === 'ready' && sticky ? sticky(viewFirst) : [], [read.state, sticky, viewFirst]);
    const last = first + Math.max(lines.length, 1) - 1;
    const openLine = scrollLine ?? target.startLine;
    const where = `${target.path}:${openLine}`;
    const gutter = `${String(last).length + 1}ch`;
    const readRow = cursorLine ?? reading;
    const railOf = (n1: number) => {
        if (!rails) return null;
        const kind = rails.get(n1);
        const on = inSpan(railSpan, n1);
        const tone = on ? cssVar('accent') : kind ? cssVar(RAIL_TONE[kind]) : 'transparent';
        return <span aria-hidden="true" data-rail={kind} data-rail-on={on ? '' : undefined} style={{ flex: `0 0 ${RAIL_PX}px`, background: tone }} />;
    };
    // A symbol's shape on its first line, a warning instead when it carries an anti-pattern; the column exists only with the facts.
    const glyphOf = (n1: number | null) => {
        if (!lensCtx) return null;
        const l = n1 === null ? undefined : lens?.get(n1);
        const warn = l ? lensCtx.facts.antiPatternOf(l.ref) : null;
        return (
            <span data-gutter-glyph={l?.ref ?? ''} style={{ flex: `0 0 ${GLYPH_PX}px`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                {l && (warn ? <span role="img" aria-label={fillTemplate(t.gutterWarn, { name: lensCtx.kindName?.(warn.kind) ?? warn.kind })} data-gutter-warn style={{ display: 'inline-flex', flex: 'none', color: cssVar('violation') }}>{actionGlyph('warning')}</span> : <ShapeGlyph shape={railShape(l.kind)} tone={RAIL_TONE[l.kind]} size={GLYPH_PX - 4} />)}
            </span>
        );
    };
    const numberOf = (n1: number | null) => <span aria-hidden="true" style={{ flex: `0 0 ${gutter}`, textAlign: 'right', paddingRight: 8, color: cssVar('muted') }}>{n1}</span>;
    const textOf = (n1: number, drill: boolean) => (
        <span>{(tokens[n1 - first] ?? []).map((tok, k) => <CodeToken key={k} tok={tok} path={target.path} records={records} onDrill={drill ? onDrill : undefined} drillAria={t.drillAria} />)}</span>
    );
    const stepColumn = (content?: ReactNode) => stepCount > 0 && <span style={{ flex: '0 0 3ch', textAlign: 'center' }}>{content}</span>;
    const placed = (r: number): CSSProperties => virtual ? { position: 'absolute', top: r * ROW_PX, left: 0, right: 0 } : {};
    const rowBox: CSSProperties = { display: 'flex', height: ROW_PX, lineHeight: `${ROW_PX}px`, whiteSpace: 'pre' };

    return (
        <div
            role="region" data-code-layer
            aria-label={fillTemplate(t.aria, { name: target.name, from: target.startLine, to: read.state === 'ready' ? last : target.endLine })}
            style={{
                position: 'relative', width: '100%', flex: '1 1 0', boxSizing: 'border-box',
                display: 'grid', gridTemplateRows: 'auto auto 1fr auto auto', gap: 6, padding: 10, borderRadius: 10, background: cssVar('bg'), color: cssVar('text'),
                border: `1px solid ${cssVar('border')}`, boxShadow: '0 8px 28px color-mix(in srgb, currentColor 18%, transparent)', minHeight: 0,
            }}
        >
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, minWidth: 0 }}>
                <b data-code-where style={{ ...TYPE.monoName, overflowWrap: 'anywhere', minWidth: 0 }}>{where}</b>
                <button type="button" aria-label={card.close} onClick={onClose} style={{ border: 0, background: 'transparent', color: cssVar('muted'), cursor: 'pointer', minHeight: 24, minWidth: 24, padding: 0 }}><span aria-hidden="true" style={{ display: 'inline-flex' }}>{actionGlyph('close')}</span></button>
                {diffNote && <span role="note" data-code-diff-note style={{ flexBasis: '100%', ...TYPE.monoMeta }}>{labels.surface.compare.oldNotAvailable}</span>}
                {movedTo && movedTo.length > 0 && <span role="note" data-code-moved-to style={{ flexBasis: '100%', ...TYPE.monoMeta }}>{fillTemplate(labels.surface.compare.movedOut, { modules: movedTo.join(', ') })}</span>}
                {marks && (marks.added.size > 0 || marks.removed.size > 0) && (
                    <span role="note" data-code-marks style={{ flexBasis: '100%', ...TYPE.monoMeta }}>{fillTemplate(labels.surface.compare.codeMarks, { added: marks.added.size, removed: marks.removed.size })}</span>
                )}
            </div>
            {read.state === 'loading' && <div role="status" style={TYPE.monoMeta}>{t.loading}</div>}
            {read.state === 'none' && <div role="note" data-code-unavailable style={TYPE.monoMeta}>{t.unavailable}</div>}
            {read.state === 'ready' && (
                <div
                    ref={linesRef} data-code-lines tabIndex={0} onScroll={(e) => { setScrollTop(e.currentTarget.scrollTop); setViewPx(e.currentTarget.clientHeight); }}
                    onKeyDown={onOut ? (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onOut(); } } : undefined}
                    style={{ ...TYPE.mono, minHeight: 0, overflow: 'auto', background: cssVar('panel'), borderRadius: 6, padding: '4px 0' }}
                >
                    {/* No height of its own, so the rows below keep their offsets: the header draws over the top rows. */}
                    {stuck.length > 0 && (
                        <div role="group" data-code-sticky aria-label={t.stickyAria} style={{ position: 'sticky', top: 0, zIndex: 1, height: 0, overflow: 'visible' }}>
                            <div style={{ background: cssVar('bg'), boxShadow: STICKY_SHADOW, minWidth: 'max-content' }}>
                                {stuck.map((r) => (
                                    <button
                                        key={r.ref} type="button" data-sticky-line={r.line} onClick={onJump ? () => onJump(r.line) : undefined}
                                        style={{ ...rowBox, width: '100%', border: 0, padding: 0, font: 'inherit', color: 'inherit', background: 'transparent', cursor: onJump ? 'pointer' : 'default', textAlign: 'left' }}
                                    >
                                        {railOf(r.line)}{glyphOf(r.line)}{numberOf(r.line)}{stepColumn()}{textOf(r.line, false)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    <div style={{ position: 'relative', height: virtual ? total * ROW_PX : undefined, minWidth: 'max-content' }}>
                        {layout.rows.slice(from, to).map((row, i) => {
                            const r = from + i;
                            if ('lens' in row) {
                                const at = layout.lineAtRow(r), l = lens?.get(at);
                                if (!l) return null;
                                // The lens sits at the definition's indent, as in an editor.
                                const indent = /^\s*/.exec(lines[at - first] ?? '')?.[0] ?? '';
                                return (
                                    <div key={`lens:${row.lens}`} data-code-lens={row.lens} data-lens-kind={l.kind} style={{ ...rowBox, ...TYPE.meta, lineHeight: `${ROW_PX}px`, ...placed(r), opacity: span && !inSpan(span, at) ? OUTSIDE_OPACITY : undefined }}>
                                        {rails && <span aria-hidden="true" style={{ flex: `0 0 ${RAIL_PX}px` }} />}
                                        {glyphOf(null)}
                                        {numberOf(null)}
                                        {stepColumn()}
                                        <span>{indent}<LensLine lens={l} labels={labels} ctx={lensCtx} onLens={onLens} /></span>
                                    </div>
                                );
                            }
                            const n1 = row.line;
                            const isReading = !!onReadingLine && n1 === readRow;
                            const outside = !!span && !inSpan(span, n1);
                            const isMarked = inSpan(marked, n1);
                            const step = stepByLine.get(n1);
                            const isCall = steps?.[currentStep]?.line === n1;
                            const diff = marks?.added.has(n1) ? 'added' : marks?.removed.has(n1) ? 'removed' : null;
                            return (
                                <div
                                    key={n1} data-code-line={n1} data-reading={isReading ? '' : undefined} data-marked={isMarked ? '' : undefined} data-call-site={isCall ? '' : undefined} data-diff={diff ?? undefined}
                                    onClick={onPickLine ? () => onPickLine(n1) : undefined}
                                    style={{
                                        ...rowBox, ...placed(r),
                                        backgroundColor: isCall ? `color-mix(in srgb, ${cssVar('partner')} 16%, transparent)` : isReading ? READING_TINT : isMarked ? MARKED_TINT : undefined,
                                        // The wash is an image so it shows under the reading and hover tints too.
                                        backgroundImage: diff ? `linear-gradient(${DIFF_WASH[diff]}, ${DIFF_WASH[diff]})` : undefined,
                                        boxShadow: isCall ? `inset 2px 0 0 ${cssVar('partner')}` : diff ? `inset 3px 0 0 ${DIFF_BAR[diff]}` : undefined, opacity: outside ? OUTSIDE_OPACITY : undefined,
                                    }}
                                >
                                    {railOf(n1)}
                                    {glyphOf(n1)}
                                    {numberOf(n1)}
                                    {stepColumn(step != null && <StepBadge n={step + 1} count={stepCount} current={isCall} aria={t.stepAria} onClick={onStep ? () => onStep(step) : undefined} />)}
                                    {textOf(n1, true)}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
            {read.state === 'ready' && read.text.truncated && <div style={TYPE.monoMeta}>{fillTemplate(t.truncated, { count: lines.length })}</div>}
            {onOpenSource && (
                <button type="button" data-action="open-at-line" style={{ ...button, justifySelf: 'start' }} onClick={() => onOpenSource({ path: target.path, startLine: openLine, endLine: last })}>
                    {fillTemplate(card.openAtLine, { line: openLine })}
                </button>
            )}
        </div>
    );
}

/** Whether `line` is inside `span`. */
function inSpan(span: { startLine: number; endLine: number } | null | undefined, line: number): boolean {
    return !!span && line >= span.startLine && line <= span.endLine;
}
