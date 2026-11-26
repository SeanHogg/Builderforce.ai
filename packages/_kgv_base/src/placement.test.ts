import { describe, expect, it } from 'vitest';
import { toMermaid, traceGraph, UNPARTITIONED_LANE, type GraphOutline, type KNode, type KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { byPartition, partitionMatrix } from './graphModel';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from './labels';
import {
    COMMUNITY_KEY_PREFIX, COMMUNITY_PLANE_MAX, communityIdOf, communityIdOfKey, communityKey, communityLabels, comparePlacementKeys, isCommunityKey,
    OTHER_COMMUNITIES_KEY, placementKeyOf, placementLabel, placementRowText, planeKeyOf, relabelTraceLanes, traceLaneLabel,
} from './placement';

const file = (path: string, extra: Partial<KNode> = {}): KNode =>
    ({ ref: `src:r::${path}`, kind: 'file', label: path, pack: 'code', importance: 0.5, origin: 'extracted', ...extra }) as KNode;

const graphOf = (nodes: KNode[], outline?: Partial<GraphOutline>): KnowledgeGraph => ({
    scope: { rootId: 'r', packs: ['code'], digest: 'd' }, nodes, edges: [], findings: [],
    stats: { sources: nodes.length, nodes: nodes.length, edges: 0, stale: 0, truncated: false },
    ...(outline ? { outline: outline as GraphOutline } : {}),
});

describe('placementKeyOf', () => {
    it('a pack partition wins over the community', () => {
        expect(placementKeyOf(file('a.ts', { partition: 'domain', badges: { communityId: 3 } }))).toBe('domain');
    });

    it('falls back to the community when the packs placed nothing', () => {
        const key = placementKeyOf(file('a.ts', { badges: { communityId: 3, communityConfidence: 0.8 } }));
        expect(key).toBe(communityKey(3));
        expect(isCommunityKey(key)).toBe(true);
        expect(communityIdOfKey(key)).toBe(3);
        expect(communityIdOf(file('a.ts', { badges: { communityId: 3 } }))).toBe(3);
        expect(communityIdOf(file('a.ts', { badges: { communityId: '3' } }))).toBeUndefined();
        expect(communityIdOfKey(OTHER_COMMUNITIES_KEY)).toBeUndefined();
    });

    it('is undefined with neither', () => {
        expect(placementKeyOf(file('a.ts'))).toBeUndefined();
        expect(isCommunityKey(undefined)).toBe(false);
        expect(communityIdOfKey('domain')).toBeUndefined();
    });
});

describe('placementLabel', () => {
    const nodes = [
        file('lib/core/a.ts', { badges: { communityId: 0 } }),
        file('lib/core/b.ts', { badges: { communityId: 0 } }),
        file('web/page.tsx', { partition: 'presentation' }),
    ];

    it('names a community by the outline table label (the members\' common directory)', () => {
        const g = graphOf(nodes);
        expect(placementLabel(communityKey(0), g, L)).toBe('lib/core');
        expect(placementLabel('presentation', g, L)).toBe('presentation');
    });

    it('reads the community table once per graph', () => {
        const g = graphOf(nodes);
        expect(communityLabels(g)).toBe(communityLabels(g));
    });

    it('falls back to the localized "Community {n}" when the table has no label, and to "No partition" for none', () => {
        const g = graphOf(nodes, { communities: [] });
        expect(placementLabel(communityKey(7), g, L)).toBe(fillTemplate(L.communityFallback, { n: 7 }));
        expect(placementLabel(undefined, g, L)).toBe(L.partitionNone);
        expect(placementLabel('', g, L)).toBe(L.partitionNone);
    });

    it('maps memory trace lanes: `community N` to its label, the unpartitioned lane to "No partition"', () => {
        const g = graphOf(nodes);
        expect(traceLaneLabel('community 0', g, L)).toBe('lib/core');
        expect(traceLaneLabel(UNPARTITIONED_LANE, g, L)).toBe(L.partitionNone);
        expect(traceLaneLabel('domain', g, L)).toBe('domain');
    });

    it('the Partition row carries a community\'s membership confidence as a percentage', () => {
        const g = graphOf(nodes);
        const placed = file('lib/core/c.ts', { badges: { communityId: 0, communityConfidence: 0.826 } });
        expect(placementRowText(placed, g, L)).toBe(fillTemplate(L.nodeCommunity, { name: 'lib/core', percent: 83 }));
        expect(placementRowText(nodes[2]!, g, L)).toBe('presentation');
        expect(placementRowText(file('x.ts'), g, L)).toBe(L.partitionNone);
    });
});

describe('comparePlacementKeys (the ONE order)', () => {
    it('partitions by name, then communities by numeric id, then none', () => {
        const keys = ['', OTHER_COMMUNITIES_KEY, communityKey(10), 'domain', communityKey(2), 'application'];
        expect([...keys].sort(comparePlacementKeys)).toEqual(['application', 'domain', communityKey(2), communityKey(10), OTHER_COMMUNITIES_KEY, '']);
        expect(comparePlacementKeys(undefined, communityKey(2))).toBeGreaterThan(0);
        expect(comparePlacementKeys(undefined, '')).toBe(0);
    });

    it('orders byPartition: partitions, communities by id, the folded "other communities", then none', () => {
        const c = (path: string, id: number) => file(path, { badges: { communityId: id } });
        const nodes = [
            file('d.ts', { partition: 'domain' }), file('a.ts', { partition: 'application' }),
            c('x/1.ts', 10), c('x/2.ts', 10), c('y/1.ts', 2), c('y/2.ts', 2), c('z/solo.ts', 5), file('loose.ts'),
        ];
        expect(byPartition(nodes).map((p) => p.partition))
            .toEqual(['application', 'domain', communityKey(2), communityKey(10), OTHER_COMMUNITIES_KEY, undefined]);
    });
});

describe('partitionMatrix is SEMANTIC (pack partitions only)', () => {
    it('community-only nodes add no rows, even on an edge carrying a verdict; rows keep the ONE order', () => {
        const ref = (p: string) => `src:r::${p}` as KNode['ref'];
        const nodes = [
            file('d.ts', { partition: 'domain' }), file('a.ts', { partition: 'application' }),
            file('x/c10.ts', { badges: { communityId: 10 } }), file('y/c2.ts', { badges: { communityId: 2 } }),
        ];
        const edges = [
            { from: ref('d.ts'), to: ref('a.ts'), kind: 'references', weight: 1, origin: 'extracted', verdict: 'allowed' },
            { from: ref('d.ts'), to: ref('x/c10.ts'), kind: 'references', weight: 1, origin: 'extracted', verdict: 'allowed' },
            { from: ref('y/c2.ts'), to: ref('a.ts'), kind: 'references', weight: 1, origin: 'extracted', verdict: 'upward' },
        ] as KnowledgeGraph['edges'];
        const m = partitionMatrix({ ...graphOf(nodes), edges });
        expect(m.partitions).toEqual(['application', 'domain']);
        expect([...m.cells.keys()].some((k) => k.includes(COMMUNITY_KEY_PREFIX))).toBe(false);
    });
});

describe('planeKeyOf (bounded planes)', () => {
    it('keeps the largest COMMUNITY_PLANE_MAX communities of 2+ members and folds the other ~200 into ONE key', () => {
        // 200 communities: ids 0..199, community i has (i < 20 ? 30 - i : 1 + (i % 2)) members.
        const nodes: KNode[] = [file('p.ts', { partition: 'domain' })];
        for (let i = 0; i < 200; i++) {
            const size = i < 20 ? 30 - i : 1 + (i % 2);
            for (let j = 0; j < size; j++) nodes.push(file(`c${i}/f${j}.ts`, { badges: { communityId: i } }));
        }
        const keys = new Set(nodes.map((n) => planeKeyOf(n, nodes)));
        const communities = [...keys].filter((k) => isCommunityKey(k) && k !== OTHER_COMMUNITIES_KEY);
        expect(communities.sort(comparePlacementKeys)).toEqual(Array.from({ length: COMMUNITY_PLANE_MAX }, (_, i) => communityKey(i)));
        expect(keys.has(OTHER_COMMUNITIES_KEY)).toBe(true);
        expect(keys.size).toBe(COMMUNITY_PLANE_MAX + 2); // + 'domain' + other
        expect(planeKeyOf(nodes[0]!, nodes)).toBe('domain');
        // A single-member community never keeps its own plane.
        const solo = [file('a/x.ts', { badges: { communityId: 1 } }), file('b/y.ts', { badges: { communityId: 2 } }), file('b/z.ts', { badges: { communityId: 2 } })];
        expect(solo.map((n) => planeKeyOf(n, solo))).toEqual([OTHER_COMMUNITIES_KEY, communityKey(2), communityKey(2)]);
    });

    it('names the folded key with the localized "other communities"', () => {
        expect(placementLabel(OTHER_COMMUNITIES_KEY, graphOf([]), L)).toBe(L.communityOther);
    });
});

describe('relabelTraceLanes', () => {
    const ref = (p: string) => `src:r::${p}` as KNode['ref'];
    const nodes = [
        file('web/page.tsx', { partition: 'presentation' }),
        file('lib/core/b.ts', { badges: { communityId: 0 } }), file('lib/core/c.ts', { badges: { communityId: 0 } }),
    ];
    const edges = [
        { from: ref('web/page.tsx'), to: ref('lib/core/b.ts'), kind: 'references', weight: 1, origin: 'extracted', verdict: 'allowed' },
        { from: ref('lib/core/b.ts'), to: ref('lib/core/c.ts'), kind: 'references', weight: 1, origin: 'extracted' },
    ] as KnowledgeGraph['edges'];
    const g = { ...graphOf(nodes), edges };

    it('renames community lanes in both `lanes` and `laneOf`, so the copied Mermaid names the community like the SVG', () => {
        const raw = traceGraph(g, ref('web/page.tsx'));
        expect(raw.lanes).toContain('community 0');
        const named = relabelTraceLanes(raw, g, L);
        expect(named.lanes).toEqual(raw.lanes.map((l) => (l === 'community 0' ? 'lib/core' : l)));
        expect(named.laneOf[ref('lib/core/c.ts')]).toBe('lib/core');
        const mermaid = toMermaid(named, (r) => r);
        expect(mermaid).toContain('as lib/core');
        expect(mermaid).not.toContain('community 0');
    });

    it('names a community lane with the localized fallback when its label would merge it with another lane', () => {
        const trace = { from: ref('web/page.tsx'), lanes: ['lib/core', 'community 0'], steps: [], truncated: false, laneOf: { [ref('lib/core/b.ts')]: 'community 0' } };
        const named = relabelTraceLanes(trace, g, L);
        const fallback = fillTemplate(L.communityFallback, { n: 0 });
        expect(named.lanes).toEqual(['lib/core', fallback]);
        expect(named.laneOf[ref('lib/core/b.ts')]).toBe(fallback);
    });
});
