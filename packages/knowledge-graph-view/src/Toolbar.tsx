/**
 * The view's controls: the reviewed folder, search, the 3D/list choice, Before/After (when
 * the host keeps a baseline), and the lenses — a deliberate horizontal scroller (never a
 * wrap that pushes the graph off a phone).
 *
 * The lenses are toggle chips in a `nav` by default. A host whose lenses ARE its panel's
 * views (an embedded report that replaces its own tabs) asks for `lensControl="tabs"`: the
 * same row as a `tablist`, so the panel keeps the tab semantics its users rely on.
 */

import { useState, type ReactNode } from 'react';
import type { KnowledgeGraphLabels } from './labels';
import type { LensDef } from './lenses';
import { cssVar } from './scene/themeColors';
import { chip, input } from './styles';
import type { KnowledgeScopeSummary, LensId } from './types';

export type LensControl = 'chips' | 'tabs';
export type Revision = 'after' | 'before';

export interface ToolbarProps {
    labels: KnowledgeGraphLabels;
    scopes: KnowledgeScopeSummary[];
    rootId: string | null;
    onRoot(rootId: string): void;
    lenses: LensDef[];
    lens: LensId;
    onLens(id: LensId): void;
    onSearch(q: string): void;
    can3D: boolean;
    mode: '3d' | 'list';
    onMode(mode: '3d' | 'list'): void;
    actions?: ReactNode;
    lensControl?: LensControl;
    /** Present when the host keeps a baseline: which graph is drawn, and whether "before" exists. */
    revision?: { value: Revision; hasBefore: boolean; onChange(r: Revision): void };
}

export function Toolbar({ labels, scopes, rootId, onRoot, lenses, lens, onLens, onSearch, can3D, mode, onMode, actions, lensControl = 'chips', revision }: ToolbarProps) {
    const [q, setQ] = useState('');
    const tabs = lensControl === 'tabs';
    const lensRow = { display: 'flex', gap: 6, overflowX: 'auto', scrollSnapType: 'x proximity', paddingBottom: 2 } as const;
    const lensItems = lenses.map((l) => (
        <button
            key={l.id}
            type="button"
            role={tabs ? 'tab' : undefined}
            aria-selected={tabs ? l.id === lens : undefined}
            aria-pressed={tabs ? undefined : l.id === lens}
            title={labels.lensHints[l.id]}
            onClick={() => onLens(l.id)}
            style={{ ...chip(l.id === lens), scrollSnapAlign: 'start' }}
        >
            {labels.lenses[l.id]}
        </button>
    ));
    return (
        <div style={{ display: 'grid', gap: 8, padding: '8px 12px', borderBottom: `1px solid ${cssVar('border')}` }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {scopes.length > 1 && (
                    <select aria-label={labels.scopeLabel} value={rootId ?? ''} onChange={(e) => onRoot(e.target.value)} style={{ ...input, maxWidth: 220 }}>
                        {scopes.map((s) => <option key={s.rootId} value={s.rootId}>{s.title}</option>)}
                    </select>
                )}
                <form role="search" onSubmit={(e) => { e.preventDefault(); onSearch(q); }} style={{ display: 'flex', flex: '1 1 180px', minWidth: 0 }}>
                    <input
                        type="search"
                        aria-label={labels.searchLabel}
                        placeholder={labels.searchPlaceholder}
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        style={{ ...input, flex: 1 }}
                    />
                </form>
                {can3D && (
                    <div role="group" style={{ display: 'flex', gap: 4 }}>
                        <button type="button" aria-pressed={mode === '3d'} style={chip(mode === '3d')} onClick={() => onMode('3d')}>{labels.view3d}</button>
                        <button type="button" aria-pressed={mode === 'list'} style={chip(mode === 'list')} onClick={() => onMode('list')}>{labels.viewList}</button>
                    </div>
                )}
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
            {tabs
                ? <div role="tablist" aria-label={labels.lensesLabel} style={lensRow}>{lensItems}</div>
                : <nav aria-label={labels.lensesLabel} style={lensRow}>{lensItems}</nav>}
        </div>
    );
}

