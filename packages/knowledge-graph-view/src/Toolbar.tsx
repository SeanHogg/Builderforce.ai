/**
 * The surface header: the reviewed folder, the spine (where you are), the ask bar (search
 * today; the pinpoint screenshot input joins it), the panel buttons, the overlay menu,
 * Before/After (when the host keeps a baseline) and the host's actions. The cameras, the
 * questions and the lenses are the centre controls (`surface/CameraBar.tsx`).
 */

import { useState, type ReactNode } from 'react';
import type { KnowledgeGraphLabels } from './labels';
import { cssVar } from './scene/themeColors';
import { chip, input } from './styles';
import type { KnowledgeScopeSummary } from './types';

/** `tabs` when the lenses ARE the host panel's views; the same row as a `tablist`. */
export type LensControl = 'chips' | 'tabs';
export type Revision = 'after' | 'before';

export interface ToolbarProps {
    labels: KnowledgeGraphLabels;
    scopes: KnowledgeScopeSummary[];
    rootId: string | null;
    onRoot(rootId: string): void;
    onSearch(q: string): void;
    /** The drill path. */
    spine?: ReactNode;
    /** The panel registry's buttons. */
    panels?: ReactNode;
    /** The overlay popover. */
    overlays?: ReactNode;
    /** The time slider. */
    time?: ReactNode;
    /** Wraps the search form so the pinpoint input catches a paste or a drop anywhere on the ask bar. */
    askWrap?: ((form: ReactNode) => ReactNode) | undefined;
    /** Opens the lines as a sheet where the left panel has collapsed. */
    linesToggle?: ReactNode;
    actions?: ReactNode;
    /** Present when the host keeps a baseline: which graph is drawn, and whether "before" exists. */
    revision?: { value: Revision; hasBefore: boolean; onChange(r: Revision): void };
}

export function Toolbar({ labels, scopes, rootId, onRoot, onSearch, spine, panels, overlays, time, askWrap, linesToggle, actions, revision }: ToolbarProps) {
    const [q, setQ] = useState('');
    const search = (
        <form role="search" onSubmit={(e) => { e.preventDefault(); onSearch(q); }} style={{ display: 'flex', flex: '1 1 180px', minWidth: 0 }}>
            <input
                type="search" aria-label={labels.searchLabel} placeholder={labels.searchPlaceholder} value={q}
                onChange={(e) => setQ(e.target.value)} style={{ ...input, flex: 1 }}
            />
        </form>
    );
    return (
        <div style={{ display: 'grid', gap: 8, padding: '8px 12px', borderBottom: `1px solid ${cssVar('border')}` }}>
            {spine}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {scopes.length > 1 && (
                    <select aria-label={labels.scopeLabel} value={rootId ?? ''} onChange={(e) => onRoot(e.target.value)} style={{ ...input, maxWidth: 220 }}>
                        {scopes.map((s) => <option key={s.rootId} value={s.rootId}>{s.title}</option>)}
                    </select>
                )}
                {linesToggle}
                {(askWrap ?? ((form: ReactNode) => form))(search)}
                {panels}
                {overlays}
                {time}
                {revision && (
                    <div role="group" aria-label={labels.revisionLabel} style={{ display: 'flex', gap: 4 }}>
                        <button type="button" aria-pressed={revision.value === 'before'} disabled={!revision.hasBefore} style={{ ...chip(revision.value === 'before'), ...(revision.hasBefore ? {} : { opacity: 0.5, cursor: 'not-allowed' }) }} onClick={() => revision.onChange('before')}>
                            {labels.compareBefore}
                        </button>
                        <button type="button" aria-pressed={revision.value === 'after'} style={chip(revision.value === 'after')} onClick={() => revision.onChange('after')}>
                            {labels.compareAfter}
                        </button>
                    </div>
                )}
                {actions}
            </div>
        </div>
    );
}
