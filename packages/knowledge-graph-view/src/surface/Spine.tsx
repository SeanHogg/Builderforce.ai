/**
 * The spine: where the person is, as a drill path under the reviewed folder
 * (station › file › symbol). Every crumb but the current one steps back up to it. With
 * several reviewed folders the root crumb is a menu of them (it replaces the old scope select).
 */

import type { CSSProperties } from 'react';
import type { KnowledgeGraphLabels } from '../labels';
import { cssVar } from '../scene/themeColors';
import { MONO } from '../styles';
import type { KnowledgeScopeSummary } from '../types';
import type { SpineItem } from './path';
import { Menu } from './ui';

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
    minHeight: 28, padding: '0 8px', borderRadius: 7, cursor: 'pointer', font: 'inherit', whiteSpace: 'nowrap',
    fontSize: mono ? 11.5 : 12.5, fontWeight: 600, fontFamily: mono ? MONO : 'inherit',
    color: cssVar('text'), background: current ? cssVar('accentSoft') : 'transparent',
    border: `1px solid ${current ? cssVar('accent') : 'transparent'}`,
});

export function Spine({ items, labels, onPick, roots }: SpineProps) {
    // A scrolling list would clip the roots menu's popover, so with several roots the crumbs wrap instead of scroll.
    const menu = roots !== undefined && roots.scopes.length > 1;
    return (
        <nav aria-label={labels.surface.spineLabel} data-testid="kg-spine" style={{ minWidth: 0, flex: '0 1 auto' }}>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', alignItems: 'center', gap: 2, ...(menu ? { flexWrap: 'wrap' } : { overflowX: 'auto' }) }}>
                {items.map((item, i) => {
                    const current = i === items.length - 1;
                    const several = item.kind === 'root' && roots !== undefined && roots.scopes.length > 1;
                    return (
                        <li key={`${item.kind}:${item.id ?? ''}`} style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 'none' }}>
                            {i > 0 && <span aria-hidden="true" style={{ color: cssVar('muted') }}>›</span>}
                            {several ? (
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
                })}
            </ol>
        </nav>
    );
}
