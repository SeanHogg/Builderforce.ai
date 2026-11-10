import { describe, expect, it } from 'vitest';
import type { KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { surfaceFixture } from '../testing';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../labels';
import { communityKey } from '../placement';
import { MAX_STATIONS, type Group } from './areaRollup';
import { foldGroups, groupByCommunity, REPO_CONFIG_STATION_ID } from './communityGroups';
import { buildStations } from './stations';

const file = (path: string, extra: Partial<KNode> = {}): KNode =>
    ({ ref: `src:r::${path}`, kind: 'file', label: path, pack: 'code', importance: 0.5, origin: 'extracted', ...extra }) as KNode;
const community = (id: number) => ({ communityId: id, communityConfidence: 0.9 });

describe('stations by community (PRD 38 P1)', () => {
    it('stands a file with no area in its community station, named by the community label; a file with neither stays on its folder', () => {
        const base = surfaceFixture();
        const nodes = base.nodes.map((n) => (n.ref === 'src:sys::cron/job.ts' ? { ...n, badges: { ...n.badges, ...community(9) } } : n));
        const loose = file('misc/z.ts');
        const graph: KnowledgeGraph = { ...base, nodes: [...nodes, { ...loose, ref: 'src:sys::misc/z.ts' as KNode['ref'] }] };
        const model = buildStations(graph);
        const cron = model.byId.get(communityKey(9))!;
        expect(cron).toMatchObject({ kind: 'community', name: 'cron', entry: true, files: 1 });
        expect(model.stationOf.get('src:sys::cron/job.ts')).toBe(communityKey(9));
        expect(model.byId.has('folder:cron')).toBe(false);
        expect(model.byId.get('folder:misc')).toMatchObject({ kind: 'folder', name: 'misc' });
    });

    it('names a community the table has no label for with the host\'s communityFallback, never the folder fallback', () => {
        const nodes = [file('x/a.ts', { badges: community(4) })];
        const graph = {
            scope: { rootId: 'r', packs: ['code'], digest: 'd' }, nodes, edges: [], findings: [],
            stats: { sources: 1, nodes: 1, edges: 0, stale: 0, truncated: false },
            outline: { communities: [] },
        } as unknown as KnowledgeGraph;
        expect(buildStations(graph, { communityFallback: 'Gemeinschaft {n}' }).byId.get(communityKey(4))).toMatchObject({ kind: 'community', name: 'Gemeinschaft 4' });
        expect(buildStations(graph).byId.get(communityKey(4))!.name).toBe(fillTemplate(L.communityFallback, { n: 4 }));
        expect(buildStations(graph).byId.has('folder:x')).toBe(false);
    });

    it('groups by community instead of rolling directories up when the stations exceed the cap and the communities fit', () => {
        const files = Array.from({ length: MAX_STATIONS + 1 }, (_, i) => file(`d${i}/m.ts`, { area: `src:r::d${i}/m` as KNode['ref'], badges: community(i % 3) }));
        const graph: KnowledgeGraph = {
            scope: { rootId: 'r', packs: ['code'], digest: 'd' }, nodes: files, edges: [], findings: [],
            stats: { sources: files.length, nodes: files.length, edges: 0, stale: 0, truncated: false },
        };
        const model = buildStations(graph);
        expect(model.stations.map((s) => s.id).sort()).toEqual([communityKey(0), communityKey(1), communityKey(2)]);
        expect(model.stations.every((s) => s.kind === 'community')).toBe(true);
        expect(model.stations.reduce((n, s) => n + s.files, 0)).toBe(files.length);
    });
});

describe('foldGroups', () => {
    const area = (id: string, ...nodes: KNode[]): [string, Group] => [`src:r::${id}`, { id: `src:r::${id}`, name: id, kind: 'area', nodes }];
    const names = (id: number) => `c${id}`;

    it('regroups by community past the cap; repo config keeps its station', () => {
        const groups = new Map<string, Group>([
            area('a/x1', file('a/x1/f.ts', { badges: community(1) })),
            area('a/x2', file('a/x2/f.ts', { badges: community(1) })),
            area('b/y1', file('b/y1/f.ts', { badges: community(2) })),
            area('b/y2', file('b/y2/f.ts', { badges: community(2) })),
            [REPO_CONFIG_STATION_ID, { id: REPO_CONFIG_STATION_ID, name: 'Repo config', kind: 'folder', nodes: [file('LICENSE', { badges: community(1) })] }],
        ]);
        const out = foldGroups(groups, (id) => id, names, 3);
        expect([...out.keys()].sort()).toEqual([communityKey(1), communityKey(2), REPO_CONFIG_STATION_ID].sort());
        expect(out.get(communityKey(1))).toMatchObject({ name: 'c1', kind: 'community' });
        expect(out.get(communityKey(1))!.nodes).toHaveLength(2);
        expect(out.get(REPO_CONFIG_STATION_ID)!.nodes).toHaveLength(1);
    });

    it('falls back to the directory roll-up when the communities do not fit under the cap', () => {
        const groups = new Map<string, Group>([
            area('a/x1', file('a/x1/f.ts', { badges: community(1) })),
            area('a/x2', file('a/x2/f.ts', { badges: community(2) })),
            area('b/y1', file('b/y1/f.ts', { badges: community(3) })),
            area('b/y2', file('b/y2/f.ts', { badges: community(4) })),
        ]);
        expect(groupByCommunity(groups, names, 3)).toBeNull();
        expect([...foldGroups(groups, (id) => id, names, 3).keys()].sort()).toEqual(['src:r::a', 'src:r::b']);
    });

    it('leaves groups under the cap unchanged, and never groups files that carry no community', () => {
        const groups = new Map<string, Group>([area('a/x1', file('a/x1/f.ts', { badges: community(1) }))]);
        expect(foldGroups(groups, (id) => id, names, 3)).toBe(groups);
        const bare = new Map<string, Group>([area('a/x1', file('a/x1/f.ts')), area('a/x2', file('a/x2/f.ts'))]);
        expect(groupByCommunity(bare, names, 1)).toBeNull();
    });
});
