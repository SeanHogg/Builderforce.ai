/** The restructure entry against a graph that is not today's (the shown side), a graph that refreshes under an open comparison, and the per-ref status. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Finding, KEdge, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels } from '../labels';
import type { SymbolRecord } from '../types';
import { symbolFacts } from './symbolFacts';
import type { StationModel } from './stations';
import { useCompare } from './useCompare';
import { useCompareActions } from './useCompareActions';
import { useRestructure } from './useRestructure';
import type { SurfaceModel } from './useSurface';

const R = (path: string) => `src:r::${path}`;
const node = (path: string): KNode => ({ ref: R(path) as KNode['ref'], kind: 'file', label: path, pack: 'code', importance: 0.6, origin: 'extracted', sourceHash: `h:${path}` });
const edge = (from: string, to: string): KEdge => ({ from: R(from) as KEdge['from'], to: R(to) as KEdge['to'], kind: 'references', weight: 1, origin: 'extracted' });
const BIG = R('api/big.ts'), CALLER = R('web/caller.ts');
const sym = (name: string, line: number, over: Partial<SymbolRecord> = {}, rel: string[] = []): SymbolRecord => ({
    ref: `${BIG}#${name}`, name, kind: 'function', parent: BIG, line, exported: true, relations: rel.map((to) => ({ kind: 'calls', to })), ...over,
});
const SYMBOLS: SymbolRecord[] = [
    sym('fetchUsers', 1, {}, [`${BIG}#parseUser`]), sym('parseUser', 5, { exported: false }),
    sym('renderPage', 20, {}, [`${BIG}#renderRow`]), sym('renderRow', 25, { exported: false }),
];
const god: Finding = { id: 'god1', kind: 'god-module', pack: 'code', nodes: [BIG as never], severity: 'warn', params: {} };
const ghost: Finding = { ...god, id: 'ghost' }; // a finding the shown side (a baseline) had and today's graph no longer has
const graphOf = (findings: Finding[], extra: string[] = []): KnowledgeGraph => ({
    scope: { rootId: 'r', packs: ['code'], digest: 'd' }, nodes: [node('web/caller.ts'), node('api/big.ts'), ...extra.map(node)], edges: [edge('web/caller.ts', 'api/big.ts')],
    findings, stats: { sources: 2, nodes: 2 + extra.length, edges: 1, stale: 0, truncated: false },
});
const stations = { stations: [], byId: new Map(), stationOf: new Map() } as unknown as StationModel;

interface Props { g: KnowledgeGraph; facts: KnowledgeGraph; symbols?: ((refs: string[]) => Promise<SymbolRecord[]>) | undefined }

function mount(initial: Props) {
    return renderHook((p: Props) => {
        const compare = useCompare({ current: p.g, baseline: null, source: {}, commits: [], rootId: 'r' });
        const restructure = useRestructure({
            graph: p.g, facts: symbolFacts(p.facts, stations), drillSymbols: SYMBOLS, symbols: p.symbols, open: compare.open,
            activeFindingId: compare.state?.source === 'restructure' ? compare.state.findingId : undefined, close: compare.close,
        });
        return { compare, restructure };
    }, { initialProps: initial });
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { vi.useRealTimers(); });

describe('restructure from a shown side whose finding today\'s graph lacks', () => {
    it('says so (status none, no comparison) instead of returning silently', () => {
        const today = graphOf([]);
        const { result } = mount({ g: today, facts: graphOf([ghost]) });
        act(() => result.current.restructure.restructure(BIG));
        expect(result.current.compare.state).toBeNull();
        expect(result.current.restructure.status).toBe('none');
    });

    it('a finding both have opens the comparison from the facts of the shown side', () => {
        const { result } = mount({ g: graphOf([god]), facts: graphOf([god]) });
        act(() => result.current.restructure.restructure(BIG));
        expect(result.current.compare.state).toMatchObject({ source: 'restructure', findingId: 'god1' });
    });
});

describe('a graph refresh while a restructure is on show', () => {
    it('re-proposes against the new graph', () => {
        const first = graphOf([god]);
        const { result, rerender } = mount({ g: first, facts: first });
        act(() => result.current.restructure.restructure(BIG));
        expect(result.current.compare.view!.graph!.nodes.some((n) => n.ref === R('late.ts'))).toBe(false);

        const next = graphOf([god], ['late.ts']);
        rerender({ g: next, facts: next });
        expect(result.current.compare.state).toMatchObject({ source: 'restructure', findingId: 'god1' });
        expect(result.current.compare.view!.graph!.nodes.some((n) => n.ref === R('late.ts'))).toBe(true);
        expect(result.current.restructure.status).toBeNull();
    });

    it('closes the comparison and says none when the finding is gone', () => {
        const first = graphOf([god]);
        const { result, rerender } = mount({ g: first, facts: first });
        act(() => result.current.restructure.restructure(BIG));
        expect(result.current.compare.state?.source).toBe('restructure');

        const resolved = graphOf([]);
        rerender({ g: resolved, facts: resolved });
        expect(result.current.compare.state).toBeNull();
        expect(result.current.restructure.status).toBe('none');
    });

    it('a refresh with no restructure open does nothing', () => {
        const first = graphOf([god]);
        const { result, rerender } = mount({ g: first, facts: first });
        const next = graphOf([god], ['late.ts']);
        rerender({ g: next, facts: next });
        expect(result.current.compare.state).toBeNull();
        expect(result.current.restructure.status).toBeNull();
    });
});

describe('statusOf(ref): the status as it concerns ONE ref', () => {
    it('is loading only for the file being read, then null once the proposal opens', async () => {
        let release!: (r: SymbolRecord[]) => void;
        const symbols = vi.fn(() => new Promise<SymbolRecord[]>((r) => { release = r; }));
        const g = graphOf([god]);
        // The drill holds none of the file's symbols here, so the loader is asked.
        const { result } = renderHook(() => {
            const compare = useCompare({ current: g, baseline: null, source: {}, commits: [], rootId: 'r' });
            return useRestructure({ graph: g, facts: symbolFacts(g, stations), drillSymbols: [], symbols, open: compare.open });
        });
        act(() => result.current.restructure(`${BIG}#fetchUsers`));
        expect(result.current.status).toBe('loading');
        expect(result.current.statusOf(BIG)).toBe('loading');
        expect(result.current.statusOf(`${BIG}#renderPage`)).toBe('loading'); // a symbol of the same file
        expect(result.current.statusOf(CALLER)).toBeNull();
        await act(async () => { release(SYMBOLS); });
        await waitFor(() => expect(result.current.status).toBeNull());
        expect(result.current.statusOf(BIG)).toBeNull();
    });

    it('is none for the file that cannot be proposed, null for any other', async () => {
        const g = graphOf([god]);
        const { result } = renderHook(() => useRestructure({ graph: g, facts: symbolFacts(g, stations), drillSymbols: [], symbols: undefined, open: vi.fn() }));
        act(() => result.current.restructure(BIG));
        expect(result.current.statusOf(BIG)).toBe('none');
        expect(result.current.statusOf(CALLER)).toBeNull();
    });
});

describe('useCompareActions exposes the restructure status', () => {
    it('restructureStatus and restructureStatusOf follow useRestructure', () => {
        const g = graphOf([god]);
        const surface = {
            stations, lines: { lines: [], interchanges: new Map(), omitted: 0 }, line: null, drill: { symbols: [] as SymbolRecord[] },
            openPanel: vi.fn(), resolve: vi.fn(), selectLine: vi.fn(),
        } as unknown as SurfaceModel;
        const { result } = renderHook(() => {
            const compare = useCompare({ current: g, baseline: null, source: {}, commits: [], rootId: 'r' });
            return useCompareActions({
                compare, current: g, graph: g, index: new Map(), surface, symbols: undefined, labels: {} as KnowledgeGraphLabels, select: vi.fn(), openSimulate: vi.fn(),
            });
        });
        expect(result.current.restructureStatus).toBeNull();
        expect(result.current.restructureStatusOf(BIG)).toBeNull();
        act(() => result.current.onRestructure(BIG)); // needs symbols, the host has no loader: none
        expect(result.current.restructureStatus).toBe('none');
        expect(result.current.restructureStatusOf(BIG)).toBe('none');
        expect(result.current.restructureStatusOf(CALLER)).toBeNull();
    });
});
