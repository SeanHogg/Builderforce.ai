/**
 * The ONE sentence about scale: "{nodes} nodes · {edges} edges · {sources} sources", that the
 * graph on screen is the most important part of a large one, and *Show all* on a compact screen.
 * The scene overlay draws it as a card in the scene's bottom-left corner.
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { quietButton } from '../styles';

export interface ScaleLineProps {
    labels: KnowledgeGraphLabels;
    stats: { nodes: number; edges: number; sources: number };
    truncated: boolean;
    compact: boolean;
    showAll: boolean;
    /** Nodes drawn, and nodes in the graph. */
    drawn: number;
    total: number;
    onShowAll(): void;
    /** The station model's cap (`StationModel.capped`): the map shows `shown` of `total` files. */
    capped?: { shown: number; total: number } | undefined;
}

export function ScaleLine({ labels, stats, truncated, compact, showAll, drawn, total, onShowAll, capped }: ScaleLineProps) {
    return (
        <>
            {fillTemplate(labels.statsLine, stats)}
            {capped && <> · <span data-testid="kg-map-capped">{fillTemplate(labels.surface.mapShows, capped)}</span></>}
            {truncated && <> · {compact && !showAll ? fillTemplate(labels.focusedNote, { count: drawn }) : labels.truncatedNote}</>}
            {compact && !showAll && drawn < total && (
                <> <button type="button" style={{ ...quietButton, minHeight: 40 }} onClick={onShowAll}>{labels.showAll}</button></>
            )}
        </>
    );
}
