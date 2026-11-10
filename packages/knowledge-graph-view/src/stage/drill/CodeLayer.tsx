/**
 * The code band's panel (PRD 43 B1a rule 9, deepest zoom): a method's source, read through the host's `readSource` port
 * (range by symbol span, `codeTargetOf`) and anchored to the method's SLOT with `useSlotAnchor`, so it moves with the
 * zoom and pan with no React commit. Read-only here (editing is the editing PRD's). Monospace and syntax-light
 * (`syntaxLight`, no highlighter dependency), coloured by theme tokens, virtualized past `VIRTUAL_AFTER` lines, and as
 * wide as the stage allows down to a 360 px box. "Open at line" hands over to the host's editor (`onOpenSource`).
 *
 * No port (the web has no file contents) or a refused read: the panel shows `path:line`, says the code is not
 * available here, and still offers "Open at line" when the host can open one.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar, type ThemeTone } from '../../scene/themeColors';
import { CONTROL } from '../../styles';
import { TYPE } from '../../surface/ui/type';
import type { SourceLocation, SourceReader, SourceText } from '../../types';
import { useSlotAnchor } from '../anchor/useSlotAnchor';
import { syntaxLight, visibleWindow, VIRTUAL_AFTER, type CodeTarget, type TokenKind } from './codeText';

export interface CodeLayerProps {
    /** The method's slot key (`node:<ref>`). */
    slotKey: string;
    target: CodeTarget;
    reader?: SourceReader | undefined;
    labels: KnowledgeGraphLabels;
    onOpenSource?: ((location: SourceLocation) => void) | undefined;
    onClose(): void;
}

/** One code row's height (px) and how many rows the panel shows before it scrolls. */
export const ROW_PX = 18;
const VIEW_ROWS = 16;

const TOKEN_TONE: Readonly<Record<TokenKind, ThemeTone>> = { plain: 'text', comment: 'muted', string: 'line3', number: 'line5', keyword: 'accent' };

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

export function CodeLayer({ slotKey, target, reader, labels, onOpenSource, onClose }: CodeLayerProps) {
    const t = labels.surface.code, card = labels.surface.map.card;
    const ref = useRef<HTMLDivElement | null>(null);
    useSlotAnchor(slotKey, ref);
    const read = useSourceLines(reader, target);
    const lines = read.state === 'ready' ? read.text.lines : [];
    const first = read.state === 'ready' ? read.text.startLine : target.startLine;
    const tokens = useMemo(() => syntaxLight(lines), [lines]);
    const [scrollTop, setScrollTop] = useState(0);
    const { from, to } = visibleWindow(lines.length, scrollTop, ROW_PX, VIEW_ROWS);
    const virtual = lines.length > VIRTUAL_AFTER;
    const last = first + Math.max(lines.length, 1) - 1;
    const where = `${target.path}:${target.startLine}`;
    const gutter = `${String(last).length + 1}ch`;

    return (
        <div
            ref={ref as MutableRefObject<HTMLDivElement | null>} role="region" data-code-layer
            aria-label={fillTemplate(t.aria, { name: target.name, from: target.startLine, to: read.state === 'ready' ? last : target.endLine })}
            style={{
                position: 'absolute', left: 0, top: 0, zIndex: 3, width: 'min(560px, calc(100% - 16px))', boxSizing: 'border-box',
                display: 'grid', gap: 6, padding: 10, borderRadius: 10, background: cssVar('bg'), color: cssVar('text'),
                border: `1px solid ${cssVar('border')}`, boxShadow: '0 8px 28px color-mix(in srgb, currentColor 18%, transparent)',
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
                    data-code-lines tabIndex={0} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
                    style={{ ...TYPE.mono, maxHeight: VIEW_ROWS * ROW_PX, overflow: 'auto', background: cssVar('panel'), borderRadius: 6, padding: '4px 0' }}
                >
                    <div style={{ position: 'relative', height: virtual ? lines.length * ROW_PX : undefined, minWidth: 'max-content' }}>
                        {tokens.slice(from, to).map((row, i) => {
                            const n = from + i;
                            return (
                                <div
                                    key={n} data-code-line={first + n}
                                    style={{ display: 'flex', height: ROW_PX, lineHeight: `${ROW_PX}px`, whiteSpace: 'pre', ...(virtual ? { position: 'absolute', top: n * ROW_PX, left: 0, right: 0 } : {}) }}
                                >
                                    <span aria-hidden="true" style={{ flex: `0 0 ${gutter}`, textAlign: 'right', paddingRight: 8, color: cssVar('muted') }}>{first + n}</span>
                                    <span>{row.map((tok, k) => <span key={k} style={tok.kind === 'plain' ? undefined : { color: cssVar(TOKEN_TONE[tok.kind]) }}>{tok.text}</span>)}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
            {read.state === 'ready' && read.text.truncated && <div style={TYPE.monoMeta}>{fillTemplate(t.truncated, { count: lines.length })}</div>}
            {onOpenSource && (
                <button type="button" data-action="open-at-line" style={{ ...button, justifySelf: 'start' }} onClick={() => onOpenSource({ path: target.path, startLine: target.startLine, endLine: last })}>
                    {fillTemplate(card.openAtLine, { line: target.startLine })}
                </button>
            )}
        </div>
    );
}
