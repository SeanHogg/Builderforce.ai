import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { nodeIndex, pathOf } from '../graphModel';
import { fileNodesOf, isArchitectureFile, tailOf } from './outlineGraph';
import type { Station } from './stations';
import { appOfNode, systemName, systemOfNode, systemsOf, type SystemInfo } from './systems';

export type HierarchyView = 'architecture' | 'filesystem' | 'picture';
export interface ArchitectureGroup { id: string; name: string }
type LayerNames = Readonly<Partial<Record<string, string>>>;

export interface CodeFile {
    ref: string;
    name: string;
    path: string;
    isCode: boolean;
    filesystem: ArchitectureGroup[];
    architecture: ArchitectureGroup[];
}

const containsPath = (folder: string, path: string): boolean => !!folder && (path === folder || path.startsWith(`${folder}/`));

/** The index uses file refs as identity, even when two components contain an index.ts or share a route station. */
export function buildCodeHierarchy(graph: KnowledgeGraph, rootTitle: string, layers: LayerNames): ReadonlyMap<string, CodeFile> {
    const index = nodeIndex(graph);
    const systems = systemsOf(graph);
    const systemPaths = systems.map((system) => system.path).sort((a, b) => b.length - a.length);
    const files = new Map<string, CodeFile>();
    for (const file of fileNodesOf(graph)) {
        const path = pathOf(file.ref)?.replaceAll('\\', '/');
        if (!path) continue;
        const folders = path.split('/').filter(Boolean);
        const name = folders.pop();
        if (!name) continue;
        const filesystem = folders.map((folder, i) => ({ id: folders.slice(0, i + 1).join('/'), name: folder }));
        const architecture: ArchitectureGroup[] = [];
        const isCode = isArchitectureFile(file);
        files.set(file.ref, { ref: file.ref, name, path, isCode, filesystem, architecture });
        if (!isCode) continue;
        const system = systemOfNode(file) || systemPaths.find((folder) => containsPath(folder, path)) || '';
        const systemLabel = systemName(systems, system);
        if (systemLabel && systemLabel !== rootTitle) architecture.push({ id: `system:${system}`, name: systemLabel });
        const app = appOfNode(file);
        const appLabel = app ? tailOf(app) : '';
        if (appLabel && appLabel !== systemLabel && appLabel !== rootTitle) architecture.push({ id: `app:${app}`, name: appLabel });
        if (file.area) {
            const declared = index.get(file.area)?.label;
            const area = pathOf(file.area)?.replaceAll('\\', '/');
            if (area && containsPath(area, path)) {
                const base = [app, system].find((folder) => containsPath(folder, area)) ?? '';
                const component = declared || area.slice(base ? base.length + 1 : 0);
                if (component && component !== architecture.at(-1)?.name) architecture.push({ id: `area:${area}`, name: component });
            } else if (declared || area) {
                const name = declared || tailOf(area!);
                if (name !== architecture.at(-1)?.name) architecture.push({ id: `area:${file.area}`, name });
            }
        } else {
            const layer = file.partition ?? 'other';
            const label = layers[layer] ?? layers.other;
            if (label) architecture.push({ id: `layer:${layer}`, name: label });
        }
    }
    return files;
}

/** Ancestors of a canvas station in the picture outline, where station roll-ups are part of the drawing. */
export function architectureGroupsOf(station: Station | undefined | null, systems: readonly SystemInfo[] | undefined, rootTitle: string, layers: LayerNames): ArchitectureGroup[] {
    const groups: ArchitectureGroup[] = [];
    const system = systemName(systems, station?.system);
    if (system && system !== rootTitle) groups.push({ id: `system:${station?.system}`, name: system });
    const app = station?.app?.split('/').at(-1);
    if (app && app !== system && app !== rootTitle && app !== station?.name) {
        groups.push({ id: `app:${station?.app}`, name: app });
    }
    // A graph community's representative filename is a station label. Use its architectural partition as the folder above it.
    if (station?.kind === 'community') {
        const layer = station.layer ?? 'other';
        const name = layers[layer] ?? layers.other;
        if (name) groups.push({ id: `layer:${layer}`, name });
    }
    return groups;
}
