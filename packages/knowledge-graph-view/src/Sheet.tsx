/**
 * The view's side panels, with SlideOutPanel semantics: non-modal, docked to the edge,
 * the board stays visible and usable behind it, Escape closes it. A host passes its own
 * panel (`renderPanel` — the web passes `SlideOutPanel`); without one this sheet is used.
 * In a compact container it becomes a full-width bottom sheet.
 */

import type { ReactNode } from 'react';
import { cssVar } from './scene/themeColors';
import { heading, quietButton } from './styles';
import type { KnowledgePanelRenderer } from './types';

export interface SheetProps {
    open: boolean;
    title: string;
    closeLabel: string;
    onClose(): void;
    compact: boolean;
    children: ReactNode;
}

export function Sheet({ open, title, closeLabel, onClose, compact, children }: SheetProps) {
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
                    : { top: 0, right: 0, bottom: 0, width: 'min(380px, 100%)', borderRadius: '12px 0 0 12px' }),
            }}
        >
            <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px 8px 16px', borderBottom: `1px solid ${cssVar('border')}` }}>
                <h2 style={{ ...heading, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h2>
                <button type="button" onClick={onClose} aria-label={closeLabel} title={closeLabel} style={{ ...quietButton, padding: 0, borderColor: 'transparent' }}>
                    <span aria-hidden="true">×</span>
                </button>
            </header>
            <div style={{ overflow: 'auto', padding: 16, display: 'grid', gap: 16, alignContent: 'start' }}>{children}</div>
        </aside>
    );
}

/** The host's panel when it gave one, else {@link Sheet}. */
export function Panel(props: SheetProps & { render?: KnowledgePanelRenderer | undefined }) {
    const { render, ...sheet } = props;
    if (render) return <>{render({ open: sheet.open, title: sheet.title, onClose: sheet.onClose, children: sheet.children })}</>;
    return <Sheet {...sheet} />;
}
