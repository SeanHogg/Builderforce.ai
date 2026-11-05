/**
 * The quiet lines under the camera bar: the review progress, the graph's size (and that it is
 * a focused part of a large one, with *Show all* on a compact screen), and "no hits" for a
 * search that found nothing.
 */

import type { ReactNode } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from './labels';
import { muted, quietButton } from './styles';

export interface SurfaceNotesProps {
    labels: KnowledgeGraphLabels;
    review: ReactNode;
    stats: { nodes: number; edges: number; sources: number };
    truncated: boolean;
    compact: boolean;
    showAll: boolean;
    /** Nodes drawn, and nodes in the graph. */
    drawn: number;
    total: number;
    /** The query that found nothing, or null. */
    noHits: string | null;
    onShowAll(): void;
}

export function SurfaceNotes({ labels, review, stats, truncated, compact, showAll, drawn, total, noHits, onShowAll }: SurfaceNotesProps) {
    return (
        <div style={{ display: 'grid', gap: 8, padding: '0 12px 8px' }}>
            {review}
            <p style={{ ...muted, margin: 0 }}>
                {fillTemplate(labels.statsLine, stats)}
                {truncated && <> · {compact && !showAll ? fillTemplate(labels.focusedNote, { count: drawn }) : labels.truncatedNote}</>}
                {compact && !showAll && drawn < total && (
                    <> <button type="button" style={{ ...quietButton, minHeight: 40 }} onClick={onShowAll}>{labels.showAll}</button></>
                )}
            </p>
            {noHits !== null && <p role="status" style={{ ...muted, margin: 0 }}>{fillTemplate(labels.searchNoHits, { query: noHits })}</p>}
        </div>
    );
}
