// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { surfaceFixture } from '../testing';
import { communityKey } from '../placement';
import { useSurface } from './useSurface';

const graph = surfaceFixture();
const repo = 'src:sys::db/repo.ts';

describe('useSurface options', () => {
    it('opens on the requested question (the host\'s initial lens), else Where', () => {
        expect(renderHook(() => useSurface(graph, null, { question: 'copied' })).result.current.question).toBe('copied');
        expect(renderHook(() => useSurface(graph, null)).result.current.question).toBe('where');
    });

    it('lights the stations of the focused refs whatever the question', () => {
        const focus = [repo];
        const { result } = renderHook(() => useSurface(graph, null, { focus }));
        const names = [...(result.current.lit ?? [])].map((id) => result.current.stations.byId.get(id)!.name);
        expect(names).toEqual(['repositories']);
    });

    it('a changed set (the time slider) marks the stations of those refs', () => {
        const changed = new Set([repo]);
        const { result } = renderHook(() => useSurface(graph, null, { changed }));
        expect(result.current.stations.stations.filter((s) => s.changed).map((s) => s.name)).toEqual(['repositories']);
    });

    it('pins the path strip to given refs, and a line pick returns to the line', () => {
        const { result } = renderHook(() => useSurface(graph, null));
        act(() => result.current.pinPath(['src:sys::web/page.tsx', repo]));
        expect(result.current.path.stops.map((s) => s.name)).toEqual(['Web app', 'repositories']);
        expect(result.current.pinned).toHaveLength(2);
        act(() => result.current.selectLine(result.current.lines.lines[0]!.id));
        expect(result.current.pinned).toBeNull();
        expect(result.current.path.stops.length).toBeGreaterThan(2);
    });

    it('a selected community station survives a rebuild of unrelated stations, is dropped when its id is renumbered, and other stations are never dropped (PRD 38 P1)', () => {
        const withCommunities = (extra: Array<[string, number]>, cronId: number): KnowledgeGraph => {
            const base = surfaceFixture();
            const nodes = base.nodes.map((n) => (n.ref === 'src:sys::cron/job.ts' ? { ...n, badges: { ...n.badges, communityId: cronId } } : n));
            const added = extra.map(([path, id]) => ({ ref: `src:sys::${path}`, kind: 'file', label: path, pack: 'code', importance: 0.1, origin: 'extracted', badges: { communityId: id } }) as KNode);
            return { ...base, nodes: [...nodes, ...added] };
        };
        const first = withCommunities([], 9);
        const { result, rerender } = renderHook(({ g }) => useSurface(g, null), { initialProps: { g: first } });
        act(() => result.current.selectStation(communityKey(9)));
        expect(result.current.station?.path).toBe('cron');

        // An unrelated station appears (a new community): the cron community is the same one and stays selected.
        rerender({ g: withCommunities([['misc/z.ts', 4]], 9) });
        expect(result.current.station?.id).toBe(communityKey(9));

        // The build renumbers: id 9 is now a different community (tools), cron is 3. The pick is dropped, pins included.
        rerender({ g: withCommunities([['tools/t.ts', 9]], 3) });
        expect(result.current.station).toBeNull();
        expect(result.current.pins.some((p) => p.stationId === communityKey(9))).toBe(false);

        // A non-community station is never dropped by a rebuild.
        const api = result.current.stations.stations.find((s) => s.name === 'API')!.id;
        act(() => result.current.selectStation(api));
        rerender({ g: withCommunities([['tools/t.ts', 2]], 5) });
        expect(result.current.station?.id).toBe(api);
    });

    it('Resolve opens its drawer on the finding, and null closes it', () => {
        const { result } = renderHook(() => useSurface(graph, null));
        act(() => result.current.resolve(graph.findings[0]!));
        expect(result.current.panel).toBe('resolve');
        expect(result.current.resolving).toBe(graph.findings[0]);
        act(() => result.current.resolve(null));
        expect(result.current.panel).toBeNull();
    });
});
