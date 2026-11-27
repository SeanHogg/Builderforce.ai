import { describe, expect, it } from 'vitest';
import { surfaceFixture } from '../../testing';
import { buildStations } from '../stations';
import { buildDrillView, hasSymbols, LEAVES } from './drillView';
import { CLASS_REF, FAIL_REF, RUN_REF, USE_CASE, withSymbols } from './testFixtures';

const graph = withSymbols();
const world = buildStations(graph);
const api = world.stations.find((s) => s.name === 'API')!;
const names = (v: ReturnType<typeof buildDrillView>) => v.stations.stations.map((s) => s.name).sort();

describe('the package level', () => {
    const view = buildDrillView(graph, world, { level: 'package', ref: api.id, name: 'API' });
    it('shows the station\'s files, each with the world\'s own metrics', () => {
        expect(names(view)).toEqual(expect.arrayContaining(['routes.ts', 'useCase.ts']));
        const useCase = view.stations.stations.find((s) => s.name === 'useCase.ts')!;
        expect(useCase.cov).toBeCloseTo(0.8, 5);
        expect(useCase.layer).toBe('application');
    });
    it('puts what the package reaches outside itself in the leaves band, and draws a line to it', () => {
        expect(view.order[view.order.length - 1]).toBe(LEAVES);
        expect(view.leaves.size).toBeGreaterThan(0);
        const leaf = view.stations.stations.find((s) => s.layer === LEAVES)!;
        expect(view.lines.lines.some((l) => l.stops.includes(leaf.id))).toBe(true);
    });
    it('has lines even though the package has no entry file', () => {
        expect(view.lines.lines.length).toBeGreaterThan(0);
    });
});

describe('the class level', () => {
    it('shows a file\'s class above its methods, the error symbol in its own band', () => {
        const view = buildDrillView(graph, world, { level: 'class', ref: USE_CASE, name: 'useCase.ts' });
        const by = (n: string) => view.stations.stations.find((s) => s.name === n)!;
        expect(by('UseCase').layer).toBe('symbol');
        expect(by('run').layer).toBe('methods');
        expect(by('UseCaseError').layer).toBe('errors');
        expect(view.order.slice(0, 3)).toEqual(['symbol', 'methods', 'errors']);
        expect(view.filesOnly).toBe(false);
        expect(view.lines.lines.some((l) => l.stops.includes(by('UseCase').id) && l.stops.includes(by('run').id))).toBe(true);
    });
});

describe('the function level', () => {
    it('shows the function and what it calls', () => {
        const view = buildDrillView(graph, world, { level: 'function', ref: RUN_REF, name: 'run' });
        const layers = Object.fromEntries(view.stations.stations.map((s) => [s.name, s.layer]));
        expect(layers.run).toBe('body');
        expect(layers.UseCaseError).toBe('callees');
        expect(view.order.slice(0, 2)).toEqual(['body', 'callees']);
    });
});

it('shows the selected class and its own methods', () => {
    const view = buildDrillView(graph, world, { level: 'function', ref: CLASS_REF, name: 'UseCase' });
    expect(view.order.slice(0, 2)).toEqual(['symbol', 'methods']);
    expect(view.stations.stations.filter((station) => !view.leaves.has(station.id)).map((station) => station.name).sort())
        .toEqual(['UseCase', 'UseCaseError', 'run']);
});

it('resolves calls from both graph edges and host symbol relations', () => {
    const fromHost = {
        ...graph, edges: graph.edges.filter((edge) => edge.from !== RUN_REF),
        nodes: graph.nodes.map((node) => node.ref === FAIL_REF ? { ...node, ref: `${FAIL_REF}@5` as typeof node.ref } : node),
    };
    const view = buildDrillView(fromHost, world, { level: 'function', ref: RUN_REF, name: 'run' }, [{
        ref: RUN_REF, name: 'run', parent: CLASS_REF, kind: 'method', exported: false, line: 1,
        relations: [{ kind: 'calls', to: FAIL_REF }],
    }]);
    expect(view.stations.byId.get(`${FAIL_REF}@5`)?.layer).toBe('callees');
    const withCall = { ...graph, edges: graph.edges.map((edge) => edge.from === RUN_REF ? { ...edge, kind: 'calls' } : edge) };
    expect(buildDrillView(withCall, world, { level: 'function', ref: RUN_REF, name: 'run' }).stations.byId.get(FAIL_REF)?.layer).toBe('callees');
});

describe('a graph with no symbols', () => {
    const plain = surfaceFixture();
    const plainWorld = buildStations(plain);
    it('says so, and the class level shows the package\'s files', () => {
        expect(hasSymbols(plain)).toBe(false);
        expect(hasSymbols(graph)).toBe(true);
        const view = buildDrillView(plain, plainWorld, { level: 'class', ref: 'src:sys::api/useCase.ts', name: 'useCase.ts' });
        expect(view.noSymbols).toBe(true);
        expect(view.filesOnly).toBe(true);
        expect(names(view)).toEqual(expect.arrayContaining(['routes.ts', 'useCase.ts']));
    });
});

it('does not leak the symbol ref constants out of range', () => {
    expect(CLASS_REF.startsWith(USE_CASE)).toBe(true);
});
