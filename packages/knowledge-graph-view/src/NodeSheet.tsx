/**
 * The selected node's side panel: its details (`NodePanel`) and, on request, what it reaches
 * (`TracePanel`). Docked through the host's panel (or the package's sheet; a bottom sheet when
 * compact). Closed when nothing is selected or the selection is not in the graph.
 */

import type { Finding, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels } from './labels';
import { labelFor } from './graphModel';
import { NodePanel } from './NodePanel';
import type { TowerHighlight } from './surface/towerHighlight';
import { Panel } from './Sheet';
import { TracePanel } from './TracePanel';
import type { KnowledgeConfirm, KnowledgeGraphSource, KnowledgePanelRenderer } from './types';

export interface NodeSheetProps {
    graph: KnowledgeGraph;
    index: ReadonlyMap<string, KNode>;
    selected: string | null;
    tracing: boolean;
    labels: KnowledgeGraphLabels;
    source: KnowledgeGraphSource;
    confirm?: KnowledgeConfirm | undefined;
    renderPanel?: KnowledgePanelRenderer | undefined;
    compact: boolean;
    onClose(): void;
    onTrace(): void;
    onSelect(ref: string): void;
    onChanged(): void;
    onShow?: ((refs: string[]) => void) | undefined;
    onResolve?: ((finding: Finding) => void) | undefined;
    onShowInTower?: ((highlight: TowerHighlight, refs: string[]) => void) | undefined;
}

export function NodeSheet({ graph, index, selected, tracing, labels, source, confirm, renderPanel, compact, onClose, onTrace, onSelect, onChanged, onShow, onResolve, onShowInTower }: NodeSheetProps) {
    return (
        <Panel
            render={renderPanel} open={!!selected && index.has(selected)} compact={compact} closeLabel={labels.close}
            title={selected ? labelFor(index, selected) : labels.nodePanelTitle} onClose={onClose}
        >
            {selected && (
                <>
                    <NodePanel graph={graph} nodeRef={selected} labels={labels} source={source} confirm={confirm} onTrace={onTrace} onSelect={onSelect} onChanged={onChanged} onShow={onShow} onResolve={onResolve} onShowInTower={onShowInTower} />
                    {tracing && <TracePanel graph={graph} from={selected} labels={labels} />}
                </>
            )}
        </Panel>
    );
}
