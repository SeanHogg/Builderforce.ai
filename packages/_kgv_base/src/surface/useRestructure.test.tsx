import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Finding, KEdge, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { codeFixture } from '../testing';
import type { SymbolRecord } from '../types';
import type { StationModel } from './stations';
import { symbolFacts } from './symbolFacts';
import { useCompare } from './useCompare';
import { useRestructure } from './useRestructure';

const R = (path: string) => `src:r::${path}`;
const node = (path: string): KNode => ({ ref: R(path) as KNode['ref'], kind: 'file', label: path, pack: 'code', importance: 0.6, origin: 'extracted', sourceHash: `h:${path}` });
const edge = (from: string, to: string): KEdge => ({ from: R(from) as KEdge['from'], to: R(to) as KEdge['to'], kind: 'references', weight: 1, origin: 'extracted' });
const BIG = R('api/big.ts');
const sym = (name: string, line: number, over: Partial<SymbolRecord> = {}, rel: string[] = []): SymbolRecord => ({
    ref: `${BIG}#${name}`, name, kind: 'function', parent: BIG, line, exported: true, relations: rel.map((to) => ({ kind: 'calls', to })), ...over,
});
const SYMBOLS: SymbolRecord[] = [
    sym('fetchUsers', 1, {}, [`${BIG}#parseUser`]), sym('parseUser', 5, { exported: false }),
    sym('renderPage', 20, {}, [`${BIG}#renderRow`]), sym('renderRow', 25, { exported: false }),
];
const god: Finding = { id: 'god1', kind: 'god-module', pack: 'code', nodes: [BIG as never], severity: 'warn', params: {} };
const graph: KnowledgeGraph = {
    scope: { rootId: 'r', packs: ['code'], digest: 'd' }, nodes: [node('web/caller.ts'), node('api/big.ts')], edges: [edge('web/caller.ts', 'api/big.ts')],
    findings: [god], stats: { sources: 2, nodes: 2, edges: 1, stale: 0, truncated: false },
};
const stations = { stations: [], byId: new Map(), stationOf: new Map() } as unknown as StationModel;

/** The entry as the host view composes it: the ONE compare state, and the restructure that opens it. */
function mount(over: { drillSymbols?: SymbolRecord[]; symbols?: ((refs: string[]) => Promise<SymbolRecord[]>) | undefined; graph?: KnowledgeGraph } = {}) {
    const g = over.graph ?? graph;
    return renderHook(() => {
        const compare = useCompare({ current: g, baseline: null, source: {}, commits: [], rootId: 'r' });
        const restructure = useRestructure({ graph: g, facts: symbolFacts(g, stations), drillSymbols: over.drillSymbols ?? [], symbols: 'symbols' in over ? over.symbols : async () => SYMBOLS, open: compare.open });
        return { compare, restructure };
    });
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { vi.useRealTimers(); });

describe('the restructure entry: ref → finding → proposal → compare', () => {
    it('loads the file\'s symbols through the host loader, proposes, and opens the compare on Before', async () => {
        const symbols = vi.fn(async () => SYMBOLS);
        const { result } = mount({ symbols });
        act(() => result.current.restructure.restructure(`${BIG}#fetchUsers`)); // a SYMBOL of the file: the anti-pattern sits on its file
        expect(result.current.restructure.status).toBe('loading');
        await waitFor(() => expect(result.current.compare.state?.source).toBe('restructure'));
        expect(symbols).toHaveBeenCalledWith([BIG]);
        expect(result.current.compare.state).toMatchObject({ side: 'before', findingId: 'god1' });
        expect(result.current.restructure.status).toBeNull();
        // The union holds the file AND the modules grown out of it.
        const refs = result.current.compare.view!.graph!.nodes.map((n) => n.ref);
        expect(refs).toContain(BIG);
        expect(refs.length).toBeGreaterThan(graph.nodes.length);
        // Before shows the file only; After shows its modules.
        expect(result.current.compare.view!.absent.size).toBeGreaterThan(0);
        act(() => { vi.advanceTimersByTime(800); });
        expect(result.current.compare.state?.side).toBe('after');
        expect(result.current.compare.view!.absent.has(BIG)).toBe(true);
    });

    it('uses the symbols the drill already read, and asks the host for none', async () => {
        const symbols = vi.fn(async () => SYMBOLS);
        const { result } = mount({ symbols, drillSymbols: SYMBOLS });
        act(() => result.current.restructure.restructure(BIG));
        await waitFor(() => expect(result.current.compare.state?.source).toBe('restructure'));
        expect(symbols).not.toHaveBeenCalled();
    });

    it('a kind that needs no symbols opens at once', () => {
        const g = codeFixture('code');
        const f = g.findings.find((x) => x.kind === 'partition-violation' && x.params['verdict'] === 'skips')!;
        const { result } = mount({ graph: g });
        act(() => result.current.restructure.restructureFinding(f));
        expect(result.current.compare.state).toMatchObject({ source: 'restructure', findingId: f.id });
    });

    it('a ref with no restructurable anti-pattern does nothing', () => {
        const { result } = mount();
        act(() => result.current.restructure.restructure(R('web/caller.ts')));
        expect(result.current.compare.state).toBeNull();
        expect(result.current.restructure.status).toBeNull();
    });

    it('says so when the file cannot be read, or the host cannot read definitions: never silently skips', async () => {
        const failing = mount({ symbols: async () => { throw new Error('refused'); } });
        act(() => failing.result.current.restructure.restructure(BIG));
        await waitFor(() => expect(failing.result.current.restructure.status).toBe('none'));
        expect(failing.result.current.compare.state).toBeNull();

        const none = mount({ symbols: undefined });
        act(() => none.result.current.restructure.restructure(BIG));
        expect(none.result.current.restructure.status).toBe('none');
    });
});
