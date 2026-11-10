/**
 * The call-site card (PRD 43 B1a rule 10, Code band): picking a Sequence message (a link whose batch carries
 * `callSites[group]`) shows where the call is made — `path:line` — beside the pick, with "Open at line" through the
 * host's ONE open port (`SceneProps.onOpenSource`, the same `SourceLocation` the findings' evidence opens). No port, no
 * button: the location is still shown. Kept inside the stage box — clamped to its width (it fits a 360 px stage) and
 * flipped above the pick when the box ends below it — themed by tokens, closed by its × or Escape, and closed by the
 * wiring when another placement comes on show or a mark is selected.
 */

import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import type { CallSite } from '@seanhogg/builderforce-memory/knowledge';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { CONTROL } from '../../styles';
import { TYPE } from '../../surface/ui/type';
import type { SourceLocation } from '../../types';

export interface CallSiteCardProps {
    site: CallSite;
    /** Where it was picked, in the stage box (px). */
    at: { x: number; y: number };
    /** The stage box's width, to keep the card inside it. */
    boxWidth: number;
    labels: KnowledgeGraphLabels;
    onOpenSource?: ((location: SourceLocation) => void) | undefined;
    onClose(): void;
}

const WIDTH = 260;
const GAP = 8;

const button: CSSProperties = {
    minHeight: CONTROL, padding: '0 10px', borderRadius: 7, cursor: 'pointer', font: 'inherit', ...TYPE.pill,
    border: `1px solid ${cssVar('accent')}`, background: cssVar('accent'), color: cssVar('onAccent'),
};

/** The card's left edge: beside the pick, never past the stage box (a 360 px stage leaves ≥ 8 px each side). */
export function callSiteLeft(x: number, boxWidth: number, width = Math.min(WIDTH, boxWidth - 2 * GAP)): number {
    return Math.max(GAP, Math.min(x + GAP, boxWidth - width - GAP));
}

/** The card's top edge: below the pick when it fits the box, else flipped above it; never above the box. */
export function callSiteTop(y: number, cardHeight: number, boxHeight: number): number {
    const below = y + GAP;
    if (boxHeight <= 0 || below + cardHeight <= boxHeight - GAP) return Math.max(GAP, below);
    return Math.max(GAP, Math.min(y - GAP - cardHeight, boxHeight - GAP - cardHeight));
}

export function CallSiteCard({ site, at, boxWidth, labels, onOpenSource, onClose }: CallSiteCardProps) {
    const t = labels.surface.map.card;
    const ref = useRef<HTMLDivElement>(null);
    const width = Math.min(WIDTH, Math.max(0, boxWidth - 2 * GAP));
    // Measured once it is laid out: below the pick, or flipped above it when the stage box ends first.
    useLayoutEffect(() => {
        const el = ref.current, box = el?.offsetParent as HTMLElement | null | undefined;
        if (!el) return;
        el.style.top = `${callSiteTop(at.y, el.offsetHeight, box?.clientHeight ?? 0)}px`;
    }, [at.y, site]);
    useEffect(() => {
        ref.current?.focus({ preventScroll: true });
        const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } };
        document.addEventListener('keydown', key);
        return () => document.removeEventListener('keydown', key);
    }, [onClose]);
    const where = `${site.path}:${site.line}`;
    return (
        <div
            ref={ref} role="dialog" aria-label={`${t.callSite} ${where}`} tabIndex={-1} data-call-site
            style={{
                position: 'absolute', zIndex: 3, left: callSiteLeft(at.x, boxWidth, width), top: Math.max(GAP, at.y + GAP), width, boxSizing: 'border-box',
                padding: 10, display: 'grid', gap: 6, borderRadius: 10, background: cssVar('bg'), color: cssVar('text'), border: `1px solid ${cssVar('border')}`,
                boxShadow: '0 8px 28px color-mix(in srgb, currentColor 18%, transparent)',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={TYPE.meta}>{t.callSite}</span>
                <button type="button" aria-label={t.close} onClick={onClose} style={{ border: 0, background: 'transparent', color: cssVar('muted'), cursor: 'pointer', minHeight: 24, minWidth: 24, padding: 0 }}><span aria-hidden="true">×</span></button>
            </div>
            <b data-call-site-where style={{ ...TYPE.monoTitle, overflowWrap: 'anywhere' }}>{where}</b>
            {onOpenSource && (
                <button type="button" data-action="open-at-line" style={button} onClick={() => { onOpenSource({ path: site.path, startLine: site.line, endLine: site.line }); onClose(); }}>
                    {fillTemplate(t.openAtLine, { line: site.line })}
                </button>
            )}
        </div>
    );
}
