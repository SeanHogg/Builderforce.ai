/**
 * The spine: where the person is, as a drill path under the reviewed folder
 * (station › file › symbol). Every crumb but the current one steps back up to it. With
 * several reviewed folders the root crumb is a menu of them (it replaces the old scope select).
 */

import type { CSSProperties } from 'react';
import type { KnowledgeGraphLabels } from '../labels';
import { cssVar } from '../scene/themeColors';
import { CONTROL } from '../styles';
import type { KnowledgeScopeSummary } from '../types';
import type { SpineItem } from './path';
import { Menu } from './ui';
import { TYPE } from './ui/type';

export interface SpineRoots {
    scopes: readonly KnowledgeScopeSummary[];
    rootId: string | null;
    onRoot(rootId: string): void;
}

export interface SpineProps {
    items: readonly SpineItem[];
    labels: KnowledgeGraphLabels;
    onPick(item: SpineItem): void;
    /** The reviewed folders; more than one ⇒ the root crumb opens a menu of them. */
    roots?: SpineRoots | undefined;
}

const crumb = (current: boolean, mono: boolean): CSSProperties => ({
    minHeight: CONTROL, padding: '0 8px', borderRadius: 7, cursor: 'pointer', font: 'inherit', whiteSpace: 'nowrap',
    ...(mono ? TYPE.monoName : TYPE.pill),
    color: cssVar('text'), background: current ? cssVar('accentSoft') : 'transparent',
    border: `1px solid ${current ? cssVar('accent') : 'transparent'}`,
});

export function Spine({ items, labels, onPick, roots }: SpineProps) {
    // One line that shrinks (min-width 0): the crumbs scroll sideways. The root crumb, which may be a menu whose popover a
    // scroller would clip, sits OUTSIDE the scrolling list; the crumbs after it scroll.
    const several = roots !== undefined && roots.scopes.length > 1;
    const li = (item: SpineItem, i: number) => {
        const current = i === items.length - 1;
        const menu = several && item.kind === 'root';
        return (
            <li key={`${item.kind}:${item.id ?? ''}`} style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 'none' }}>
                {i > 0 && <span aria-hidden="true" style={{ color: cssVar('muted') }}>›</span>}
                {menu ? (
                    <Menu
                        trigger={`${item.label} ▾`} label={labels.surface.header.rootsLabel} alignStart active={current}
                        items={roots.scopes.map((s) => ({ id: s.rootId, label: s.title, selected: s.rootId === roots.rootId }))}
                        onSelect={(id) => { if (id === roots.rootId) onPick(item); else roots.onRoot(id); }}
                    />
                ) : (
                    <button type="button" aria-current={current ? 'location' : undefined} onClick={() => onPick(item)} style={crumb(current, item.kind === 'file' || item.kind === 'symbol')}>
                        {item.label}
                    </button>
                )}
            </li>
        );
    };
    const list: CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 };
    const head = several && items[0]?.kind === 'root';
    return (
        <nav aria-label={labels.surface.spineLabel} data-testid="kg-spine" style={{ minWidth: 0, flex: '0 1 auto', display: 'flex', alignItems: 'center' }}>
            {head && <ol style={{ ...list, flex: 'none' }}>{li(items[0]!, 0)}</ol>}
            <ol style={{ ...list, overflowX: 'auto', scrollbarWidth: 'none' }}>{items.map((item, i) => (head && i === 0 ? null : li(item, i)))}</ol>
        </nav>
    );
}
