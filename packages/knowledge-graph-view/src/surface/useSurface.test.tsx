// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { surfaceFixture } from '../testing';
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

    it('Resolve opens its drawer on the finding, and null closes it', () => {
        const { result } = renderHook(() => useSurface(graph, null));
        act(() => result.current.resolve(graph.findings[0]!));
        expect(result.current.panel).toBe('resolve');
        expect(result.current.resolving).toBe(graph.findings[0]);
        act(() => result.current.resolve(null));
        expect(result.current.panel).toBeNull();
    });
});
