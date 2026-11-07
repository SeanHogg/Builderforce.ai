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
import { Menu } from './surface/ui';

/** Above the docked panel (`Sheet` is 3). */
export const PICKER_Z = 8;

export interface PartitionPickerProps {
    graph: KnowledgeGraph;
    /** The node's partition; undefined ⇒ none. */
    value: string | undefined;
    labels: KnowledgeGraphLabels;
    /** The file refs of the picked partition. */
    onShow(refs: string[]): void;
}

export function PartitionPicker({ graph, value, labels, onShow }: PartitionPickerProps) {
    const groups = useMemo(() => byPartition(graph.nodes.filter((n) => n.kind === 'file')), [graph.nodes]);
    const name = (p: string | undefined) => p ?? labels.partitionNone;
    return (
        <Menu
            trigger={`${name(value)} ▾`} label={labels.surface.partitionPicker.label} alignStart
            panelStyle={{ zIndex: PICKER_Z, maxHeight: 240, overflowY: 'auto' }}
            items={groups.map((g) => ({ id: g.partition ?? '', label: name(g.partition), sub: String(g.nodes.length), selected: g.partition === value }))}
            onSelect={(id) => onShow(groups.find((g) => (g.partition ?? '') === id)?.nodes.map((n) => n.ref) ?? [])}
        />
    );
}
