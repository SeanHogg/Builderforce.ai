/**
 * Where a finding was seen, when the host knows it (`KnowledgeGraphSource.evidence`): each
 * item's line ranges and excerpt. A range opens in the host's editor (`onOpenSource`) when
 * it can, else falls back to the host's link, else is plain text — an old revision the host
 * no longer has is never offered as openable.
 */

import type { FindingEvidence, SourceLocation } from './types';
import { cssVar } from './scene/themeColors';
import { list, muted, quietButton } from './styles';

/** `path:start–end` (one line: `path:start`). */
export function locationText(l: Pick<SourceLocation, 'path' | 'startLine' | 'endLine'>): string {
    return `${l.path}:${l.startLine}${l.endLine !== l.startLine ? `–${l.endLine}` : ''}`;
}

export interface EvidenceListProps {
    items: readonly FindingEvidence[];
    onOpenSource?: ((location: SourceLocation) => void) | undefined;
}

export function EvidenceList({ items, onOpenSource }: EvidenceListProps) {
    if (items.length === 0) return null;
    return (
        <ul style={{ ...list, gap: 6 }}>
            {items.map((item, i) => (
                <li key={i} style={{ display: 'grid', gap: 4, minWidth: 0 }}>
                    {item.label && <code style={{ fontSize: 12, color: cssVar('text') }}>{item.label}</code>}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {item.locations.map((l, j) => {
                            const text = locationText(l);
                            if (onOpenSource && l.openable !== false) {
                                return (
                                    <button key={j} type="button" style={{ ...quietButton, fontWeight: 500 }} onClick={() => onOpenSource(l)}>
                                        {text}
                                    </button>
                                );
                            }
                            if (l.href) return <a key={j} href={l.href} target="_blank" rel="noreferrer" style={{ color: cssVar('accent'), fontSize: 12 }}>{text}</a>;
                            return <code key={j} style={muted}>{text}</code>;
                        })}
                    </div>
                    {item.excerpt && (
                        <pre style={{ margin: 0, maxHeight: 180, overflow: 'auto', padding: 8, borderRadius: 8, background: cssVar('bg'), color: cssVar('text'), fontSize: 12 }}>
                            {item.excerpt}
                        </pre>
                    )}
                </li>
            ))}
        </ul>
    );
}
