/**
 * The Partition row's picker (PRD 41 A9 rule 6): the file's partition as a button that opens a themed popover
 * of the graph's partitions; picking one shows that partition's files. It is the shared `Menu` popover, so it
 * has ONE look: the opaque surface token, a border and a shadow, never transparent text over the panel behind
 * it; it sits above the docked panel (z-index over the sheet's), closes on an outside press and Escape, and
 * is keyboard navigable (arrows, Home, End).
 */

import { useMemo } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { byPartition } from './graphModel';
import type { KnowledgeGraphLabels } from './labels';
import { isCommunityKey, OTHER_COMMUNITIES_KEY, placementLabel } from './placement';
import { Menu } from './surface/ui';

/** Above the docked panel (`Sheet` is 3). */
export const PICKER_Z = 8;

export interface PartitionPickerProps {
    graph: KnowledgeGraph;
    /** The node's placement key (`placementKeyOf`: its partition, else `community:<id>`); undefined ⇒ none. */
    value: string | undefined;
    /** The trigger's text when it should say more than the placement's name (a community's membership confidence). */
    caption?: string | undefined;
    labels: KnowledgeGraphLabels;
    /** The file refs of the picked partition. */
    onShow(refs: string[]): void;
}

export function PartitionPicker({ graph, value, caption, labels, onShow }: PartitionPickerProps) {
    const groups = useMemo(() => byPartition(graph.nodes.filter((n) => n.kind === 'file')), [graph.nodes]);
    const name = (p: string | undefined) => placementLabel(p, graph, labels);
    // A community folded into "other communities" selects that shared item.
    const selected = isCommunityKey(value) && !groups.some((g) => g.partition === value) ? OTHER_COMMUNITIES_KEY : value;
    return (
        <Menu
            trigger={`${caption ?? name(value)} ▾`} label={labels.surface.partitionPicker.label} alignStart
            panelStyle={{ zIndex: PICKER_Z, maxHeight: 240, overflowY: 'auto' }}
            items={groups.map((g) => ({ id: g.partition ?? '', label: name(g.partition), sub: String(g.nodes.length), selected: g.partition === selected }))}
            onSelect={(id) => onShow(groups.find((g) => (g.partition ?? '') === id)?.nodes.map((n) => n.ref) ?? [])}
        />
    );
}
