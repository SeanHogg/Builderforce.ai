// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { surfaceFixture } from '../../testing';
import type { SymbolRecord } from '../../types';
import { buildStations } from '../stations';
import { USE_CASE, withSymbols } from './testFixtures';
import { useDrill } from './useDrill';

const graph = withSymbols();
const world = buildStations(graph);
const api = world.stations.find((s) => s.name === 'API')!;

describe('useDrill', () => {
    it('starts on the world map and goes package, class, function, then out one level at a time', () => {
        const { result } = renderHook(() => useDrill(graph, world));
        expect(result.current.view).toBeNull();
        expect(result.current.canOut).toBe(false);
        expect(result.current.canEnter(api.id)).toEqual({ can: true, level: 'package' });

        act(() => result.current.enter(api.id));
        expect(result.current.view?.level).toBe('package');
        expect(result.current.parent).toBeNull();
        expect(result.current.canOut).toBe(true);

        expect(result.current.canEnter('src:sys::api/routes.ts')).toEqual({ can: false, reason: 'noSymbols' });
        act(() => result.current.enter(USE_CASE));
        expect(result.current.view?.level).toBe('class');
        expect(result.current.parent?.name).toBe('API');

        const run = result.current.view!.stations.stations.find((s) => s.name === 'run')!;
        act(() => result.current.enter(run.id));
        expect(result.current.view?.level).toBe('function');
        expect(result.current.canEnter(run.id)).toEqual({ can: false, reason: 'deepest' });

        act(() => result.current.out());
        expect(result.current.view?.level).toBe('class');
        act(() => { result.current.out(); result.current.out(); });
        expect(result.current.view).toBeNull();
    });

    it('cannot go inside a graph that has no symbols, and says why', () => {
        const plain = surfaceFixture();
        const plainWorld = buildStations(plain);
        const { result } = renderHook(() => useDrill(plain, plainWorld));
        const id = plainWorld.stations.find((s) => s.name === 'API')!.id;
        act(() => result.current.enter(id));
        expect(result.current.canEnter('src:sys::api/useCase.ts')).toEqual({ can: false, reason: 'noSymbols' });
    });

    it('loads the definitions of the package\'s files when it goes inside, and builds the class level from them', async () => {
        const plain = surfaceFixture();
        const plainWorld = buildStations(plain);
        const id = plainWorld.stations.find((s) => s.name === 'API')!.id;
        const cls = `${USE_CASE}#UseCase`;
        const load = vi.fn(async (_refs: string[]) => [
            { ref: cls, name: 'UseCase', kind: 'class', parent: USE_CASE, line: 3, exported: true },
            { ref: `${cls}.run`, name: 'run', kind: 'method', parent: cls, line: 5, exported: false },
        ]);
        const { result } = renderHook(() => useDrill(plain, plainWorld, load));
        act(() => result.current.enter(id));
        expect(load).toHaveBeenCalledTimes(1);
        expect(load.mock.calls[0]![0]).toEqual(expect.arrayContaining([USE_CASE]));
        expect(load.mock.calls[0]![0].length).toBeLessThanOrEqual(200);
        await waitFor(() => expect(result.current.canEnter(USE_CASE)).toEqual({ can: true, level: 'class' }));
        act(() => result.current.enter(USE_CASE));
        const layers = Object.fromEntries(result.current.view!.stations.stations.map((s) => [s.name, s.layer]));
        expect(layers).toMatchObject({ UseCase: 'symbol', run: 'methods' });
    });

    it('asks once per package: going out and in again does not load again, and a failed read may be retried', async () => {
        const plain = surfaceFixture();
        const plainWorld = buildStations(plain);
        const id = plainWorld.stations.find((s) => s.name === 'API')!.id;
        const load = vi.fn(async (_refs: string[]) => []);
        const { result } = renderHook(() => useDrill(plain, plainWorld, load));
        act(() => result.current.enter(id));
        act(() => result.current.out());
        act(() => result.current.enter(id));
        expect(load).toHaveBeenCalledTimes(1);

        const failing = vi.fn(async (_refs: string[]) => { throw new Error('boom'); });
        const again = renderHook(() => useDrill(plain, plainWorld, failing));
        act(() => again.result.current.enter(id));
        await waitFor(() => expect(failing).toHaveBeenCalledTimes(1));
        act(() => again.result.current.out());
        act(() => again.result.current.enter(id));
        expect(failing).toHaveBeenCalledTimes(2);
    });

    it('drops an answer that arrives after the person moved to another root', async () => {
        const a = surfaceFixture('sys'), b = surfaceFixture('other');
        const worldA = buildStations(a), worldB = buildStations(b);
        const fileB = 'src:other::api/useCase.ts';
        let answerA!: (r: SymbolRecord[]) => void;
        const loadA = vi.fn((_refs: string[]) => new Promise<SymbolRecord[]>((resolve) => { answerA = resolve; }));
        const loadB = vi.fn(async (_refs: string[]) => []);
        const { result, rerender } = renderHook(({ g, w, l }) => useDrill(g, w, l), { initialProps: { g: a, w: worldA, l: loadA } });
        act(() => result.current.enter(worldA.stations.find((s) => s.name === 'API')!.id));
        expect(loadA).toHaveBeenCalledTimes(1);

        rerender({ g: b, w: worldB, l: loadB as never });
        act(() => result.current.enter(worldB.stations.find((s) => s.name === 'API')!.id));
        await act(async () => { answerA([{ ref: `${fileB}#Stale@1`, name: 'Stale', kind: 'class', parent: fileB, line: 1, exported: true }]); });
        expect(result.current.canEnter(fileB)).toEqual({ can: false, reason: 'noSymbols' });
    });

    it('reports loading while the definitions are read, and only then', async () => {
        const plain = surfaceFixture();
        const plainWorld = buildStations(plain);
        let answer!: (r: SymbolRecord[]) => void;
        const load = vi.fn(() => new Promise<SymbolRecord[]>((resolve) => { answer = resolve; }));
        const { result } = renderHook(() => useDrill(plain, plainWorld, load));
        expect(result.current.loading).toBe(false);
        act(() => result.current.enter(plainWorld.stations.find((s) => s.name === 'API')!.id));
        expect(result.current.loading).toBe(true);
        await act(async () => { answer([]); });
        expect(result.current.loading).toBe(false);
    });

    it('leaves a level the map no longer has, and names it', () => {
        const a = surfaceFixture();
        const worldA = buildStations(a);
        const apiId = worldA.stations.find((s) => s.name === 'API')!.id;
        const { result, rerender } = renderHook(({ w }) => useDrill(a, w), { initialProps: { w: worldA } });
        act(() => result.current.enter(apiId));
        expect(result.current.view?.level).toBe('package');
        // The same root, re-reviewed: the API station is gone.
        const without = { ...worldA, stations: worldA.stations.filter((s) => s.id !== apiId), byId: new Map([...worldA.byId].filter(([id]) => id !== apiId)) };
        rerender({ w: without });
        expect(result.current.view).toBeNull();
        expect(result.current.canOut).toBe(false);
        expect(result.current.notice).toBe('API');
        act(() => result.current.enter(without.stations[0]!.id));
        expect(result.current.notice).toBeNull();
    });

    it('treats a host whose read fails like a host without the port', async () => {
        const plain = surfaceFixture();
        const plainWorld = buildStations(plain);
        const id = plainWorld.stations.find((s) => s.name === 'API')!.id;
        const load = vi.fn(async () => { throw new Error('boom'); });
        const { result } = renderHook(() => useDrill(plain, plainWorld, load));
        act(() => result.current.enter(id));
        await Promise.resolve();
        expect(result.current.canEnter(USE_CASE)).toEqual({ can: false, reason: 'noSymbols' });
        expect(result.current.view?.noSymbols).toBe(true);
    });

    it('keeps a selection inside the level and clears it when the level changes', () => {
        const { result } = renderHook(() => useDrill(graph, world));
        act(() => result.current.enter(api.id));
        act(() => result.current.select('x'));
        expect(result.current.selected).toBe('x');
        act(() => result.current.out());
        expect(result.current.selected).toBeNull();
    });
});
