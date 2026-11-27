import { buildOutline } from '@seanhogg/builderforce-memory/knowledge';
import type { KNode } from '@seanhogg/builderforce-memory/knowledge';
import { describe, expect, it } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as labels } from '../labels';
import { surfaceFixture } from '../testing';
import { buildCodeHierarchy } from './codeHierarchy';

describe('code hierarchy', () => {
    it('reads component membership from the files, independent of their shared community and graph truncation', () => {
        const base = surfaceFixture();
        const whole = {
            ...base,
            nodes: base.nodes.map((node) => node.kind === 'file'
                ? { ...node, system: 'platform', app: 'platform/backend', badges: { ...node.badges, community: 7 } }
                : node),
        };
        const truncated = {
            ...whole,
            nodes: whole.nodes.filter((node) => node.kind !== 'file'),
            edges: [],
            stats: { ...whole.stats, truncated: true },
            outline: buildOutline(whole),
        };
        const files = buildCodeHierarchy(whole, 'workspace', labels.surface.layers);
        const names = (ref: string) => files.get(ref)?.architecture.map((group) => group.name);
        expect(names('src:sys::api/routes.ts')).toEqual(['platform', 'backend', 'API']);
        expect(names('src:sys::db/repo.ts')).toEqual(['platform', 'backend', 'repositories']);
        expect(files.get('src:sys::db/repo.ts')?.filesystem.map((group) => group.name)).toEqual(['db']);
        expect(buildCodeHierarchy(truncated, 'workspace', labels.surface.layers)).toEqual(files);
    });

    it('nests the component path inside its tagged module when the area has no resident node', () => {
        const graph = surfaceFixture();
        const node = graph.nodes.find(({ kind }) => kind === 'file')!;
        const paths = ['hired.video/api/src/services/seo/sitemapEntries.ts', 'hired.video/api/src/services/distribution/__tests__/schedule-publish-jobs.test.ts'];
        const nodes = paths.map((path) => ({
            ...node, ref: `src:sys::${path}` as KNode['ref'], area: `src:sys::${path.slice(0, path.lastIndexOf('/'))}` as KNode['ref'],
            system: 'hired.video', app: 'hired.video/api',
        }));
        const files = buildCodeHierarchy({ ...graph, nodes }, 'hired', labels.surface.layers);
        const groups = (path: string) => files.get(`src:sys::${path}`)?.architecture.map(({ name }) => name);
        expect(groups(paths[0]!)).toEqual(['hired.video', 'api', 'src', 'services', 'seo']);
        expect(groups(paths[1]!)).toEqual(['hired.video', 'api', 'src', 'services', 'distribution', '__tests__']);
    });
});
