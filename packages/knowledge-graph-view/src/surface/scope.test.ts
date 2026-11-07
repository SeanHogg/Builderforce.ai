import { describe, expect, it } from 'vitest';
import { surfaceFixture } from '../testing';
import { buildLines } from './lines';
import { buildSpine, EMPTY_PATH, pathOfLine, withLineCrumb } from './path';
import { findingProvenance, scopeFindings } from './scope';
import { buildStations } from './stations';

const graph = surfaceFixture();
const model = buildStations(graph);
const lines = buildLines(graph, model);
const id = (name: string) => model.stations.find((s) => s.name === name)!.id;

describe('findingProvenance', () => {
    it('is deterministic unless the kind needs a model or a guess, or a measurement', () => {
        expect(findingProvenance({ kind: 'partition-violation' })).toBe('deterministic');
        expect(findingProvenance({ kind: 'clone-group' })).toBe('deterministic');
        expect(findingProvenance({ kind: 'contradiction' })).toBe('heuristic');
        expect(findingProvenance({ kind: 'near-duplicate' })).toBe('heuristic');
        expect(findingProvenance({ kind: 'untested' })).toBe('runtime');
    });
});

describe('scopeFindings', () => {
    it('returns everything for the whole graph and the touching findings for a scope', () => {
        expect(scopeFindings(graph.findings, model, null)).toHaveLength(2);
        expect(scopeFindings(graph.findings, model, new Set([id('cron')])).map((f) => f.kind)).toEqual(['partition-violation']);
        expect(scopeFindings(graph.findings, model, new Set([id('repositories')])).map((f) => f.kind)).toEqual(['clone-group']);
        expect(scopeFindings(graph.findings, model, new Set([id('API')]))).toHaveLength(2);
        expect(scopeFindings(graph.findings, model, new Set([id('Web app')]))).toEqual([]);
    });
});

describe('pathOfLine', () => {
    it('lists the stops and the hop between each pair', () => {
        const path = pathOfLine(lines.lines[0]!, model.byId);
        expect(path.stops.map((s) => s.name)).toEqual(['main.tsx', 'Web app', 'API', 'repositories']);
        expect(path.hops).toEqual([
            { kind: 'references', count: 1, verdict: 'allowed' }, { kind: 'references', count: 1, verdict: 'allowed' }, { kind: 'references', count: 1, verdict: 'allowed' },
        ]);
        expect(pathOfLine(null, model.byId)).toBe(EMPTY_PATH);
    });
});

describe('buildSpine', () => {
    const node = (ref: string) => graph.nodes.find((n) => n.ref === ref)!;
    const label = (r: string) => r;
    it('drops the levels that are not selected', () => {
        expect(buildSpine({ rootTitle: 'Sys', station: null, node: null, nodeLabel: label }).map((i) => i.kind)).toEqual(['root']);
        const api = model.stations.find((s) => s.name === 'API')!;
        expect(buildSpine({ rootTitle: 'Sys', station: api, node: null, nodeLabel: label }).map((i) => i.label)).toEqual(['Sys', 'API']);
        expect(buildSpine({ rootTitle: 'Sys', station: api, node: node('src:sys::api/useCase.ts'), nodeLabel: label }).map((i) => i.kind)).toEqual(['root', 'station', 'file']);
    });
    it('puts the drawn line between the folder and the station, and leaves the items alone without one', () => {
        const api = model.stations.find((s) => s.name === 'API')!;
        const base = buildSpine({ rootTitle: 'Sys', station: api, node: null, nodeLabel: label });
        const withLine = withLineCrumb(base, 'VS Code line');
        expect(withLine.map((i) => i.kind)).toEqual(['root', 'line', 'station']);
        expect(withLine.map((i) => i.label)).toEqual(['Sys', 'VS Code line', 'API']);
        expect(withLine[1]!.id).toBeUndefined(); // picking it selects no node: the view steps back up to the line
        expect(withLineCrumb(base, null)).toEqual(base);
        expect(withLineCrumb(base, '')).toEqual(base);
        expect(withLineCrumb(buildSpine({ rootTitle: 'Sys', station: null, node: null, nodeLabel: label }), 'VS Code line').map((i) => i.kind)).toEqual(['root', 'line']);
    });
    it('puts a symbol under its file', () => {
        const symbol = { ...node('src:sys::api/useCase.ts'), ref: 'src:sys::api/useCase.ts#run' as const, kind: 'symbol', label: 'run' };
        const items = buildSpine({ rootTitle: 'Sys', station: null, node: symbol, nodeLabel: (r) => `file:${r}` });
        expect(items.map((i) => i.kind)).toEqual(['root', 'file', 'symbol']);
        expect(items[1]).toMatchObject({ id: 'src:sys::api/useCase.ts', label: 'file:src:sys::api/useCase.ts' });
    });
});
