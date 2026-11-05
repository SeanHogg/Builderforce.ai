/**
 * The spine: where the person is, as a drill path under the reviewed folder
 * (station › file › symbol). Every crumb but the current one steps back up to it.
 */

import type { KnowledgeGraphLabels } from '../labels';
import { cssVar } from '../scene/themeColors';
import type { SpineItem } from './path';

export interface SpineProps {
    items: readonly SpineItem[];
    labels: KnowledgeGraphLabels;
    onPick(item: SpineItem): void;
}

export function Spine({ items, labels, onPick }: SpineProps) {
    return (
        <nav aria-label={labels.surface.spineLabel} data-testid="kg-spine" style={{ minWidth: 0, flex: '0 1 auto' }}>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', alignItems: 'center', gap: 2, overflowX: 'auto' }}>
                {items.map((item, i) => {
                    const current = i === items.length - 1;
                    return (
                        <li key={`${item.kind}:${item.id ?? ''}`} style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 'none' }}>
                            {i > 0 && <span aria-hidden="true" style={{ color: cssVar('muted') }}>›</span>}
                            <button
                                type="button" aria-current={current ? 'location' : undefined} onClick={() => onPick(item)}
                                style={{
                                    minHeight: 40, padding: '0 8px', borderRadius: 8, cursor: 'pointer', font: 'inherit', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap',
                                    fontFamily: item.kind === 'file' || item.kind === 'symbol' ? 'ui-monospace, monospace' : 'inherit',
                                    color: cssVar('text'), background: current ? cssVar('accentSoft') : 'transparent',
                                    border: `1px solid ${current ? cssVar('accent') : 'transparent'}`,
                                }}
                            >
                                {item.label}
                            </button>
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}
