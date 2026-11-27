import { useMemo, useState } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { pathOf } from '../../graphModel';
import type { KnowledgeGraphLabels } from '../../labels';
import { fileNodesOf } from '../../surface/outlineGraph';
import { systemName, systemsOf } from '../../surface/systems';
import type { Station } from '../../surface/stations';
import { cmp } from '../../order';
import type { CodeTreeGroup } from './CodeTree';

export type HierarchyView = 'architecture' | 'filesystem';

export function architectureGroups(graph: KnowledgeGraph, stations: readonly Station[], rootTitle: string): ReadonlyMap<string, readonly CodeTreeGroup[]> {
    const systems = systemsOf(graph);
    return new Map(stations.map((s) => {
        const groups: CodeTreeGroup[] = [];
        const name = systemName(systems, s.system) ?? rootTitle;
        if (name !== rootTitle) groups.push({ id: `system:${s.system}`, name });
        if (s.app && s.app !== s.system && s.app !== s.path) groups.push({ id: `app:${s.app}`, name: s.app.split('/').at(-1) ?? s.app });
        return [s.id, groups];
    }));
}

interface Folder {
    folders: Map<string, Folder>;
    files: { ref: string; name: string; path: string }[];
}

const folder = (): Folder => ({ folders: new Map(), files: [] });

function fileTree(graph: KnowledgeGraph): Folder {
    const root = folder();
    for (const node of fileNodesOf(graph)) {
        const path = pathOf(node.ref);
        if (!path) continue;
        const parts = path.replaceAll('\\', '/').split('/').filter(Boolean);
        const name = parts.pop();
        if (!name) continue;
        let current = root;
        for (const part of parts) current = current.folders.get(part) ?? current.folders.set(part, folder()).get(part)!;
        current.files.push({ ref: node.ref, name, path });
    }
    return root;
}

function TreeFolder({ name, node, selectedPath, onFile }: { name: string; node: Folder; selectedPath: string | null; onFile(ref: string): void }) {
    const [expanded, setExpanded] = useState(selectedPath !== null);
    const [lastPath, setLastPath] = useState(selectedPath);
    if (lastPath !== selectedPath) {
        setLastPath(selectedPath);
        if (selectedPath !== null) setExpanded(true);
    }
    return (
        <details open={expanded} onToggle={(e) => setExpanded(e.currentTarget.open)}>
            <summary className="kg-file-tree__row">{name}</summary>
            {expanded && <div style={{ paddingInlineStart: 14 }}><FolderContents node={node} selectedPath={selectedPath ?? ''} onFile={onFile} /></div>}
        </details>
    );
}

function FolderContents({ node, selectedPath, onFile }: { node: Folder; selectedPath: string; onFile(ref: string): void }) {
    const [head, ...tail] = selectedPath.split('/');
    return <>
        {[...node.folders].sort(([a], [b]) => cmp(a, b)).map(([name, child]) => (
            <TreeFolder key={name} name={name} node={child} selectedPath={head === name ? tail.join('/') : null} onFile={onFile} />
        ))}
        {[...node.files].sort((a, b) => cmp(a.name, b.name)).map(({ ref, name, path }) => (
            <button key={ref} type="button" className="kg-file-tree__row" title={path} aria-current={selectedPath === name ? 'true' : undefined} onClick={() => onFile(ref)}>{name}</button>
        ))}
    </>;
}

export function FilesystemTree({ graph, labels, selected, onFile }: { graph: KnowledgeGraph; labels: KnowledgeGraphLabels; selected: string | null; onFile(ref: string): void }) {
    const tree = useMemo(() => fileTree(graph), [graph]);
    return (
        <div className="kg-file-tree" aria-label={labels.surface.code.filesystem}>
            <FolderContents node={tree} selectedPath={selected ? (pathOf(selected) ?? '').replaceAll('\\', '/') : ''} onFile={onFile} />
        </div>
    );
}
