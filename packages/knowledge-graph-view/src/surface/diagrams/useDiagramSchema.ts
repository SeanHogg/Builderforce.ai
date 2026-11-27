import { useEffect, useMemo, useState } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { pathOf } from '../../graphModel';
import { fileNodesOf } from '../outlineGraph';
import type { SourceReader } from '../../types';
import type { DiagramId } from './catalog';
import { schemaDiagram, type SchemaSource } from './schema';

const schemaViews = new Set<DiagramId>(['erd', 'erdChen', 'erdIdef1x']);
const schemaPath = (path: string) => /\.(?:sql|prisma)$/i.test(path) || /(?:^|\/)(?:schema|schemas)(?:\/|\.)/i.test(path) && /\.[cm]?tsx?$/i.test(path);

export function useDiagramSchema(id: DiagramId | null, graph: KnowledgeGraph, scope: string | null, reader?: SourceReader) {
    const enabled = !!reader && id !== null && schemaViews.has(id);
    const files = useMemo(() => enabled ? fileNodesOf(graph).flatMap((node) => {
        const path = pathOf(node.ref);
        return path && schemaPath(path) ? [{ path, ref: node.ref }] : [];
    }).sort((a, b) => Number(b.path === scope) - Number(a.path === scope)
        || Number(a.path.endsWith('.sql')) - Number(b.path.endsWith('.sql'))).slice(0, 100) : [], [enabled, graph, scope]);
    const [loaded, setLoaded] = useState<{ reader: SourceReader; graph: KnowledgeGraph; sources: SchemaSource[] }>();
    useEffect(() => {
        if (!enabled || !reader || loaded?.reader === reader && loaded.graph === graph) return;
        let stopped = false;
        const collect = async () => {
            const sources: SchemaSource[] = [];
            for (let offset = 0; !stopped && offset < files.length; offset += 6) {
                const batch = await Promise.allSettled(files.slice(offset, offset + 6).map(async (file) => {
                    const data = await reader(file.path, { startLine: 1, endLine: 1600 });
                    return data?.lines.length ? { ...file, text: data.lines.join('\n') } : null;
                }));
                for (const result of batch) if (result.status === 'fulfilled' && result.value) sources.push(result.value);
            }
            if (!stopped) setLoaded({ reader, graph, sources });
        };
        void collect();
        return () => { stopped = true; };
    }, [enabled, files, graph, loaded, reader]);
    return useMemo(() => enabled && loaded?.reader === reader && loaded?.graph === graph ? schemaDiagram(loaded.sources, scope ?? undefined) : null,
        [enabled, loaded, reader, graph, scope]);
}
