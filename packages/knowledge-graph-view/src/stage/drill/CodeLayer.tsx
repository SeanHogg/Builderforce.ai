/**
 * The code pane's source (PRD 43 B1a rule 9, deepest zoom): a file's source, read through the host's `readSource` port
 * (range by symbol span, `codeTargetOf`), filling the code pane (`CodeDock`). Read-only here (editing is the editing
 * PRD's). Monospace and syntax-light (`syntaxLight`, no highlighter dependency), coloured by theme tokens, virtualized
 * past `VIRTUAL_AFTER` lines. "Open at line" hands over to the host's editor (`onOpenSource`); Escape in the lines is Out.
 *
 * No port (the web has no file contents) or a refused read: the panel shows `path:line`, says the code is not
 * available here, and still offers "Open at line" when the host can open one.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar, type ThemeTone } from '../../scene/themeColors';
import { CONTROL } from '../../styles';
import { TYPE } from '../../surface/ui/type';
import type { SourceLocation, SourceReader, SourceText, SymbolRecord } from '../../types';
import { drillRefForName, readingLineAt, scrollTopForLine, syntaxLight, visibleWindow, VIRTUAL_AFTER, type CallStep, type CodeTarget, type TokenKind } from './codeText';

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
}

/** One code row's height (px), and the rows a virtualized panel renders before it has measured itself. */
export const ROW_PX = 18;
const VIEW_ROWS = 16;

/** A name in running text that acts (a drillable method, a trail crumb): underlined, otherwise the text. */
export const LINK_BUTTON: CSSProperties = { border: 0, padding: 0, font: 'inherit', color: 'inherit', background: 'transparent', cursor: 'pointer', textDecoration: 'underline' };

const TOKEN_TONE: Readonly<Record<TokenKind, ThemeTone>> = { plain: 'text', comment: 'muted', string: 'line3', number: 'line5', keyword: 'accent' };

/** A method name drills into that symbol (`drillRefForName`); keywords and unknown names stay text. */
function CodeToken({ tok, path, records, onDrill, drillAria }: { tok: { text: string; kind: TokenKind }; path: string; records: readonly SymbolRecord[]; onDrill?: ((ref: string) => void) | undefined; drillAria: string }) {
    const ref = tok.kind === 'plain' && onDrill ? drillRefForName(tok.text, records, path) : null;
    if (!ref || !onDrill) return <span style={tok.kind === 'plain' ? undefined : { color: cssVar(TOKEN_TONE[tok.kind]) }}>{tok.text}</span>;
    return (
        <button type="button" data-code-drill={ref} aria-label={fillTemplate(drillAria, { name: tok.text })} onClick={() => onDrill(ref)} style={LINK_BUTTON}>
            {tok.text}
        </button>
    );
}

/** A call's number in the gutter, on the accent; the current call's on the partner amber (as on the stage). A button that goes to the call when `onClick` is given. */
function StepBadge({ n, count, current, aria, onClick }: { n: number; count: number; current: boolean; aria: string; onClick?: (() => void) | undefined }) {
    const style: CSSProperties = { display: 'inline-block', minWidth: '2ch', borderRadius: 8, ...TYPE.meta, fontWeight: 700, lineHeight: `${ROW_PX - 4}px`, background: cssVar(current ? 'partner' : 'accent'), color: cssVar('onAccent') };
    const props = { 'data-code-step': n, 'data-current': current ? '' : undefined, 'aria-label': fillTemplate(aria, { n, count }) };
    if (!onClick) return <span {...props} style={style}>{n}</span>;
    return <button type="button" {...props} onClick={onClick} style={{ ...style, border: 0, padding: 0, font: 'inherit', cursor: 'pointer' }}>{n}</button>;
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

export function CodeLayer({ target, reader, labels, onOpenSource, onClose, onOut, scrollLine, records = [], onDrill, onReadingLine, steps, currentStep = -1, span, onStep, marked }: CodeLayerProps) {
    const t = labels.surface.code, card = labels.surface.map.card;
    const linesRef = useRef<HTMLDivElement | null>(null);
    const read = useSourceLines(reader, target);
    const lines = read.state === 'ready' ? read.text.lines : [];
    const first = read.state === 'ready' ? read.text.startLine : target.startLine;
    const tokens = useMemo(() => syntaxLight(lines), [lines]);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewPx, setViewPx] = useState(0);
    useLayoutEffect(() => { setViewPx(linesRef.current?.clientHeight ?? 0); }, [read.state]);
    // Only a following panel has a reading line below the top; the anchored layer keeps scrolling lines to the top.
    const lead = onReadingLine ? viewPx : 0;
    // Selection and the journey step both hand a source line; the panel scrolls so that line is the one on show.
    useEffect(() => {
        if (scrollLine == null) return;
        const top = scrollTopForLine(scrollLine, first, ROW_PX, lead);
        setScrollTop(top);
        if (linesRef.current && linesRef.current.scrollTop !== top) linesRef.current.scrollTop = top;
    }, [scrollLine, first, lead]);
    const reading = readingLineAt(scrollTop, lead, first, ROW_PX);
    useEffect(() => { if (read.state === 'ready') onReadingLine?.(reading); }, [reading, read.state, onReadingLine]);
    // The first call on a line owns its badge.
    const stepByLine = useMemo(() => {
        const m = new Map<number, number>();
        steps?.forEach((s, i) => { if (!m.has(s.line)) m.set(s.line, i); });
        return m;
    }, [steps]);
    const stepCount = steps?.length ?? 0;
    const { from, to } = visibleWindow(lines.length, scrollTop, ROW_PX, viewPx > 0 ? Math.ceil(viewPx / ROW_PX) : VIEW_ROWS);
    const virtual = lines.length > VIRTUAL_AFTER;
    const last = first + Math.max(lines.length, 1) - 1;
    const openLine = scrollLine ?? target.startLine;
    const where = `${target.path}:${openLine}`;
    const gutter = `${String(last).length + 1}ch`;

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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minWidth: 0 }}>
                <b data-code-where style={{ ...TYPE.monoName, overflowWrap: 'anywhere', minWidth: 0 }}>{where}</b>
                <button type="button" aria-label={card.close} onClick={onClose} style={{ border: 0, background: 'transparent', color: cssVar('muted'), cursor: 'pointer', minHeight: 24, minWidth: 24, padding: 0 }}><span aria-hidden="true">×</span></button>
            </div>
            {read.state === 'loading' && <div role="status" style={TYPE.monoMeta}>{t.loading}</div>}
            {read.state === 'none' && <div role="note" data-code-unavailable style={TYPE.monoMeta}>{t.unavailable}</div>}
            {read.state === 'ready' && (
                <div
                    ref={linesRef} data-code-lines tabIndex={0} onScroll={(e) => { setScrollTop(e.currentTarget.scrollTop); setViewPx(e.currentTarget.clientHeight); }}
                    onKeyDown={onOut ? (e) => { if (e.key === 'Escape') { e.stopPropagation(); onOut(); } } : undefined}
                    style={{ ...TYPE.mono, minHeight: 0, overflow: 'auto', background: cssVar('panel'), borderRadius: 6, padding: '4px 0' }}
                >
                    <div style={{ position: 'relative', height: virtual ? lines.length * ROW_PX : undefined, minWidth: 'max-content' }}>
                        {tokens.slice(from, to).map((row, i) => {
                            const n = from + i, n1 = first + n;
                            const isReading = !!onReadingLine && n1 === reading;
                            const outside = !!span && (n1 < span.startLine || n1 > span.endLine);
                            const isMarked = !!marked && n1 >= marked.startLine && n1 <= marked.endLine;
                            const step = stepByLine.get(n1);
                            const isCall = steps?.[currentStep]?.line === n1;
                            return (
                                <div
                                    key={n} data-code-line={n1} data-reading={isReading ? '' : undefined} data-marked={isMarked ? '' : undefined} data-call-site={isCall ? '' : undefined}
                                    style={{
                                        display: 'flex', height: ROW_PX, lineHeight: `${ROW_PX}px`, whiteSpace: 'pre', ...(virtual ? { position: 'absolute', top: n * ROW_PX, left: 0, right: 0 } : {}),
                                        background: isCall ? `color-mix(in srgb, ${cssVar('partner')} 16%, transparent)` : isReading ? `color-mix(in srgb, ${cssVar('accent')} 14%, transparent)` : isMarked ? `color-mix(in srgb, ${cssVar('accent')} 7%, transparent)` : undefined,
                                        boxShadow: isCall ? `inset 2px 0 0 ${cssVar('partner')}` : undefined, opacity: outside ? 0.45 : undefined,
                                    }}
                                >
                                    <span aria-hidden="true" style={{ flex: `0 0 ${gutter}`, textAlign: 'right', paddingRight: 8, color: cssVar('muted') }}>{n1}</span>
                                    {stepCount > 0 && (
                                        <span style={{ flex: '0 0 3ch', textAlign: 'center' }}>
                                            {step != null && <StepBadge n={step + 1} count={stepCount} current={isCall} aria={t.stepAria} onClick={onStep ? () => onStep(step) : undefined} />}
                                        </span>
                                    )}
                                    <span>{row.map((tok, k) => <CodeToken key={k} tok={tok} path={target.path} records={records} onDrill={onDrill} drillAria={t.drillAria} />)}</span>
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
