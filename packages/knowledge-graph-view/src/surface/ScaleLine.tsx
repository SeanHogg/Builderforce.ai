/**
 * The ONE sentence about scale: "{nodes} nodes · {edges} edges · {sources} sources" or, for a large
 * graph, "{stations} stations stand for {files} files · showing the {nodes} most important · search
 * reaches all", and *Show all* on a compact screen.
 * The scene overlay draws it as a card in the scene's bottom-left corner.
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { counted } from './plural';
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
    capped?: MapCap | undefined;
    /** Stations on the map and the files they stand for; both present ⇒ a large graph reads as the one scale sentence. */
    stations?: number | undefined;
    files?: number | undefined;
}

/** The map shows `shown` of `total` files. `cut`: the server sent no outline, so these are the cut graph's own files. */
export interface MapCap { shown: number; total: number; cut?: boolean }

export function ScaleLine({ labels, stats, truncated, compact, showAll, drawn, total, onShowAll, capped, stations, files }: ScaleLineProps) {
    const cut = capped?.cut === true;
    const focused = compact && !showAll;
    // A large graph reads as one sentence: the stations stand for the files, only the most important nodes are drawn, search reaches all.
    const summary = (truncated || (capped && !cut)) && stations !== undefined && files !== undefined && !cut
        ? fillTemplate(labels.surface.scaleSummary, {
            stations: counted(labels, 'station', stations, { count: stations.toLocaleString() }),
            files: counted(labels, 'file', capped?.total ?? files, { count: (capped?.total ?? files).toLocaleString() }),
            nodes: drawn.toLocaleString(),
        })
        : null;
    return (
        <>
            {summary ? <span data-testid="kg-map-capped">{summary}</span> : fillTemplate(labels.statsLine, stats)}
            {cut && capped && <> · <span data-testid="kg-map-cut">{fillTemplate(labels.surface.explain.cutNote, { shown: capped.shown.toLocaleString(), files: counted(labels, 'file', capped.total, { count: capped.total.toLocaleString() }) })}</span></>}
            {focused && truncated && <> · {counted(labels, 'topNodes', drawn)}</>}
            {compact && !showAll && drawn < total && (
                <> <button type="button" style={{ ...quietButton, minHeight: 40 }} onClick={onShowAll}>{labels.showAll}</button></>
            )}
        </>
    );
}
