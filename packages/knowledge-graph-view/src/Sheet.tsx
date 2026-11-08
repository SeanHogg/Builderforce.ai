/**
 * The view's side panels, with SlideOutPanel semantics: non-modal, docked to the edge,
 * the board stays visible and usable behind it, Escape closes it. A host passes its own
 * panel (`renderPanel` — the web passes `SlideOutPanel`); without one this sheet is used.
 * In a compact container it becomes a full-width bottom sheet.
 */

import type { ReactNode } from 'react';
import { cssVar } from './scene/themeColors';
import { heading, muted, quietButton } from './styles';
import type { KnowledgePanelRenderer } from './types';

export interface SheetProps {
    open: boolean;
    title: string;
    closeLabel: string;
    onClose(): void;
    compact: boolean;
    children: ReactNode;
    /** A muted line beside the title (a drawer says what it is for). */
    subtitle?: string | undefined;
    /** The panel owns its scrolling and pinned footer: the body is a flush, non-scrolling column the content fills (the Reviews panel). */
    fill?: boolean | undefined;
    /** The docked width in px (default 380); never wider than the container. */
    width?: number | undefined;
}

export function Sheet({ open, title, closeLabel, onClose, compact, children, subtitle, width = 380, fill = false }: SheetProps) {
    if (!open) return null;
    return (
        <aside
            role="dialog"
            aria-modal="false"
            aria-label={title}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
            style={{
                position: 'absolute', zIndex: 3, display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
                background: cssVar('bg'), color: cssVar('text'), border: `1px solid ${cssVar('border')}`,
                boxShadow: '0 8px 28px color-mix(in srgb, currentColor 18%, transparent)',
                ...(compact
                    ? { left: 0, right: 0, bottom: 0, maxHeight: '70%', borderRadius: '14px 14px 0 0' }
                    : { top: 0, right: 0, bottom: 0, width: `min(${width}px, 100%)`, borderRadius: '12px 0 0 12px' }),
            }}
        >
            <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px 8px 16px', borderBottom: `1px solid ${cssVar('border')}` }}>
                <h2 style={{ ...heading, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {title}
                    {subtitle ? <span style={{ ...muted, fontWeight: 400, marginInlineStart: 10 }}>{subtitle}</span> : null}
                </h2>
                <button type="button" onClick={onClose} aria-label={closeLabel} title={closeLabel} style={{ ...quietButton, padding: 0, borderColor: 'transparent' }}>
                    <span aria-hidden="true">×</span>
                </button>
            </header>
            <div style={fill ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } : { flex: 1, minHeight: 0, overflow: 'auto', padding: 16, display: 'grid', gap: 16, alignContent: 'start' }}>{children}</div>
        </aside>
    );
}

/** The host's panel when it gave one, else {@link Sheet}. */
export function Panel(props: SheetProps & { render?: KnowledgePanelRenderer | undefined }) {
    const { render, ...sheet } = props;
    if (render) {
        // The host's panel has a title only, so the subtitle leads the body.
        const body = sheet.subtitle ? <><p style={{ ...muted, margin: 0 }}>{sheet.subtitle}</p>{sheet.children}</> : sheet.children;
        return <>{render({ open: sheet.open, title: sheet.title, onClose: sheet.onClose, children: body })}</>;
    }
    return <Sheet {...sheet} />;
}
