/**
 * The drill state of the map: a stack of frames (package, then class, then function) over the
 * world map, the level's view, and the station picked inside it. "Go inside" pushes, "↑ Out to"
 * pops. The view is derived (`buildDrillView`), so the hook only holds the stack and memoizes it.
 *
 * The stored graph holds files only. When a host can read definitions (`KnowledgeGraphSource.symbolsOf`),
 * going inside a package asks for those of its top files (at most `SYMBOL_FILES`) and the class and
 * function levels are built from the answer; the symbols live in this hook, never in the graph.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { SymbolRecord } from '../../types';
import type { StationModel } from '../stations';
import { buildDrillView, hasSymbols, type DrillFrame, type DrillLevel, type DrillView } from './drillView';
import { anchorFilesOf, reanchorDrill } from './reanchorDrill';
import { SYMBOL_FILES, symbolsOf, symbolsOfFile, withSymbolRecords } from './symbols';

export type EnterCheck = { can: true; level: DrillLevel } | { can: false; reason: 'noSymbols' | 'leaf' | 'deepest' | 'unknown' };

/** Reads the definitions of some files (the source's `symbolsOf` bound to its root); undefined on a host that cannot. */
export type SymbolLoader = (fileRefs: string[]) => Promise<SymbolRecord[]>;

export interface DrillModel {
    stack: readonly DrillFrame[];
    /** The view of the innermost level; null on the world map. */
    view: DrillView | null;
    /** Inside a level: "↑ Out to" goes up. */
    canOut: boolean;
    /** The level above (named in "↑ Out to {name}"); null above the first level, where the world map is the parent. */
    parent: DrillFrame | null;
    /** The station picked inside the drilled level. */
    selected: string | null;
    select(id: string | null): void;
    canEnter(id: string): EnterCheck;
    enter(id: string): void;
    /** Climb back to a depth. 0 is the system (the world map). A depth at or past the current one stays. */
    climb(depth: number): void;
    out(): void;
    /** Definitions are being read: a file without symbols may only be one that has not arrived yet. */
    loading: boolean;
    /** The name of a level the map no longer has (the view went back out of it); null once the person moves on. */
    notice: string | null;
    /** The definitions read so far, append-only (the stage places a drilled level's symbols from them, PRD 43 B7). */
    symbols: readonly SymbolRecord[];
}

const NEXT: Record<string, DrillLevel | undefined> = { world: 'package', package: 'class', class: 'function' };

export function useDrill(graph: KnowledgeGraph | null, world: StationModel, load?: SymbolLoader): DrillModel {
    const [stack, setStack] = useState<readonly DrillFrame[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const [records, setRecords] = useState<readonly SymbolRecord[]>([]);
    const [pending, setPending] = useState(0);
    const [notice, setNotice] = useState<string | null>(null);
    const rootId = graph?.scope.rootId;
    // Which packages were asked about (a re-enter does not ask again), and which root's answers still count.
    const asked = useRef(new Set<string>());
    const generation = useRef(0);
    useEffect(() => {
        generation.current += 1;
        asked.current = new Set();
        setStack([]); setSelected(null); setRecords([]); setPending(0); setNotice(null);
    }, [rootId]);

    // The graph as the drill reads it: the stored files plus the definitions loaded so far.
    const full = useMemo(() => (graph ? withSymbolRecords(graph, records) : null), [graph, records]);

    // The map can change under the person (a re-review, Live): a package whose station id changed follows its files to the
    // station that holds them now; a level whose files are gone is left, and said so.
    useEffect(() => {
        if (!full) return;
        const fresh = reanchorDrill(stack, world, (ref) => full.nodes.some((n) => n.ref === ref));
        if (fresh.stack === stack) return;
        for (const [from, to] of fresh.moved) if (asked.current.has(from)) { asked.current.delete(from); asked.current.add(to); }
        if (fresh.notice !== null) { setNotice(fresh.notice); setSelected(null); }
        setStack(fresh.stack);
    }, [world, full, stack]);
    const view = useMemo(() => {
        const top = stack[stack.length - 1];
        return full && top ? buildDrillView(full, world, top) : null;
    }, [full, world, stack]);

    const canEnter = useCallback((id: string): EnterCheck => {
        // An empty stack IS the world level. Branch on length, not `top?.level ?? 'world'`: without
        // `noUncheckedIndexedAccess` (the frontend's config) the index narrows to `DrillFrame` and 'world' drops out.
        const level: DrillLevel | 'world' = stack.length === 0 ? 'world' : stack[stack.length - 1]!.level;
        const next = NEXT[level];
        if (!next) return { can: false, reason: 'deepest' };
        if (view?.leaves.has(id)) return { can: false, reason: 'leaf' };
        if (level === 'world') return world.byId.has(id) ? { can: true, level: 'package' } : { can: false, reason: 'unknown' };
        if (!full || !hasSymbols(full)) return { can: false, reason: 'noSymbols' };
        if (level === 'package' && symbolsOfFile(symbolsOf(full), id).length === 0) return { can: false, reason: 'noSymbols' };
        if (level === 'class' && full.nodes.find((n) => n.ref === id)?.kind !== 'symbol') return { can: false, reason: 'noSymbols' };
        return { can: true, level: next };
    }, [stack, view, world, full]);

    const enter = useCallback((id: string) => {
        const check = canEnter(id);
        if (!check.can) return;
        const name = view?.stations.byId.get(id)?.name ?? world.byId.get(id)?.name ?? id;
        setStack((s) => [...s, check.level === 'package' ? { level: check.level, ref: id, name, files: anchorFilesOf(world, id) } : { level: check.level, ref: id, name }]);
        setSelected(null);
        setNotice(null);
        if (check.level === 'package' && load && !asked.current.has(id)) {
            asked.current.add(id);
            const mine = generation.current;
            setPending((n) => n + 1);
            const settle = (): void => { if (mine === generation.current) setPending((n) => Math.max(0, n - 1)); };
            // The most important files first; the HOST applies the one real cap, this only keeps the request small.
            const refs = (world.byId.get(id)?.refs ?? []).slice(0, SYMBOL_FILES);
            load(refs).then((got) => {
                // An answer for a root the person has left is not for this graph.
                if (mine !== generation.current) return;
                setRecords((have) => {
                    const seen = new Set(have.map((r) => r.ref));
                    return [...have, ...got.filter((r) => !seen.has(r.ref))];
                });
                settle();
            }, () => {
                // A host that fails to read leaves the levels below the package showing files, as a host without the port does; entering again retries.
                if (mine === generation.current) asked.current.delete(id);
                settle();
            });
        }
    }, [canEnter, view, world, load]);

    const climb = useCallback((depth: number) => {
        const n = Number.isFinite(depth) ? Math.max(0, Math.floor(depth)) : 0;
        if (n >= stack.length) return;
        setStack((s) => s.slice(0, n));
        setSelected(null);
        setNotice(null);
    }, [stack.length]);
    const out = useCallback(() => { setStack((s) => s.slice(0, -1)); setSelected(null); setNotice(null); }, []);
    return {
        stack, view, canOut: stack.length > 0, parent: stack[stack.length - 2] ?? null, selected, select: setSelected, canEnter, enter, climb, out,
        loading: pending > 0, notice, symbols: records,
    };
}
