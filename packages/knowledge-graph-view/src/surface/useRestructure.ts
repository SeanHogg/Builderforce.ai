/**
 * The restructure entries (PRD 43 Part C6): a lens, an outline row, a card or the Patterns card asks to see a finding
 * restructured; this turns the ask into a compare. A finding is found from a ref by the facts the surface computes once
 * (`symbolFacts`); a kind whose proposer reads the file's definitions (`needsSymbols`) gets them from the drill's loaded
 * symbols, else through the host's `symbolsOf` (the one symbol-loading path, bound to the root as `SymbolLoader`); then
 * `proposeRestructure` and the compare opens on Before and plays to After. Proposals are never written: Apply is the
 * existing fix flow. A proposal that cannot be made, or a read that fails, is SAID (`note`), never skipped.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Finding, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { isRestructurable, needsSymbols, proposeRestructure, type Proposal } from '../compute/compare';
import type { SymbolRecord } from '../types';
import { fileRefOf } from './stations';
import type { SymbolFacts } from './symbolFacts';
import type { CompareState } from './compareModel';
import type { SymbolLoader } from './transit/useDrill';

/** What the Patterns card calls to open a finding's restructure; null where there is nothing to compare in (no provider). */
export const RestructureContext = createContext<((finding: Finding) => void) | null>(null);
export const useRestructureAction = (): ((finding: Finding) => void) | null => useContext(RestructureContext);

export interface RestructureInput {
    /** Today's graph: the proposal is made against it, never the union. */
    graph: KnowledgeGraph | null;
    facts: SymbolFacts;
    /** The definitions the drill has read so far. */
    drillSymbols: readonly SymbolRecord[];
    /** The host's definitions reader, bound to the root; absent ⇒ a kind that needs symbols has no Restructure. */
    symbols: SymbolLoader | undefined;
    open(next: CompareState, proposal: Proposal): void;
}

export interface RestructureApi {
    /** Restructure the anti-pattern a symbol, file or station ref carries; a ref with none does nothing. */
    restructure(ref: string): void;
    restructureFinding(finding: Finding): void;
    /** The file's definitions are being read, or `null`. */
    status: 'loading' | 'none' | null;
}

export function useRestructure({ graph, facts, drillSymbols, symbols, open }: RestructureInput): RestructureApi {
    const [status, setStatus] = useState<RestructureApi['status']>(null);
    // The latest inputs, so an awaited read finishes against what is on screen now.
    const latest = useRef({ graph, drillSymbols, symbols, open });
    latest.current = { graph, drillSymbols, symbols, open };
    const asking = useRef(0);
    useEffect(() => { asking.current += 1; setStatus(null); }, [graph?.scope.rootId]);

    const restructureFinding = useCallback((finding: Finding) => {
        if (!isRestructurable(finding.kind)) return;
        const mine = ++asking.current;
        const finish = (records: readonly SymbolRecord[]): void => {
            if (mine !== asking.current) return;
            const { graph: base, open: show } = latest.current;
            const proposal = base ? proposeRestructure(base, finding, records) : null;
            if (proposal) { setStatus(null); show({ source: 'restructure', side: 'before', findingId: finding.id }, proposal); } else setStatus('none');
        };
        const file = finding.nodes[0] ? fileRefOf(finding.nodes[0]) : null;
        if (!needsSymbols(finding.kind)) { finish([]); return; }
        const held = file ? latest.current.drillSymbols.filter((r) => fileRefOf(r.ref) === file) : [];
        if (held.length > 0 || !file) { finish(held); return; }
        const load = latest.current.symbols;
        if (!load) { setStatus('none'); return; }
        setStatus('loading');
        load([file]).then(finish, () => { if (mine === asking.current) setStatus('none'); });
    }, []);

    const restructure = useCallback((ref: string) => {
        const found = facts.antiPatternOf(ref);
        const finding = found ? latest.current.graph?.findings.find((f) => f.id === found.findingId) : undefined;
        if (finding) restructureFinding(finding);
    }, [facts, restructureFinding]);

    return { restructure, restructureFinding, status };
}
