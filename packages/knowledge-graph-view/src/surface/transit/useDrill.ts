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
import { fileRefOf, stationOfRef, type StationModel } from '../stations';
import { tailOf } from '../outlineGraph';
import { buildDrillView, hasSymbols, type DrillFrame, type DrillLevel, type DrillView } from './drillView';
import { folderFrameOf, folderOfKey, frameToEnter, isStructuralLevel, LEVEL_RANK } from './levelFrames';
import { anchorFilesOf, reanchorDrill } from './reanchorDrill';
import { SYMBOL_FILES, isClassLike, membersOfClass, symbolSort, symbolsOf, symbolsOfFile, withSymbolRecords } from './symbols';

/** The package moves of one re-anchor; `seq` changes with every one. */
export interface Reanchored { seq: number; moves: ReadonlyMap<string, string> }

/** `ref` is the frame's own ref: a station id, a folder path (system, app) or a node ref. A folder mark is asked about by its slot key (`dir:<path>`). */
export type EnterCheck = { can: true; level: DrillLevel; ref: string } | { can: false; reason: 'noSymbols' | 'leaf' | 'deepest' | 'unknown' };

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
    /** The frame `enter(id)` lands on (a level holding one child is skipped through), or null when it cannot be entered. */
    frameOf(id: string): DrillFrame | null;
    enter(id: string): void;
    openFile?(ref: string): void;
    hasMembers?(ref: string): boolean;
    /** Climb back to a depth. 0 is the system (the world map). A depth at or past the current one stays. */
    climb(depth: number): void;
    out(): void;
    /** Definitions are being read: a file without symbols may only be one that has not arrived yet. */
    loading: boolean;
    /** The name of a level the map no longer has (the view went back out of it); null once the person moves on. */
    notice: string | null;
    /** The definitions read so far, append-only (the stage places a drilled level's symbols from them, PRD 43 B7). */
    symbols: readonly SymbolRecord[];
    /** Load definitions for a file opened directly from a hierarchy. */
    loadFileSymbols?(ref: string): void;
    /** The package frames the last rebuilt map moved (old id → new id), numbered so each is seen once: what is keyed by a package id follows it. */
    reanchored: Reanchored;
}

/** The level a station (or a file, or a symbol) opens from `level`: world → system → app → package → class → function (system and app are entered through their folder marks). */
const NEXT: Record<string, DrillLevel | undefined> = { world: 'package', system: 'package', app: 'package', package: 'class', class: 'function' };

export function useDrill(graph: KnowledgeGraph | null, world: StationModel, load?: SymbolLoader): DrillModel {
    const [stack, setStack] = useState<readonly DrillFrame[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const [records, setRecords] = useState<readonly SymbolRecord[]>([]);
    const [pending, setPending] = useState(0);
    const [notice, setNotice] = useState<string | null>(null);
    const [reanchored, setReanchored] = useState<Reanchored>({ seq: 0, moves: new Map() });
    const rootId = graph?.scope.rootId;
    // Which FILES were asked about (a re-enter, or a package re-anchored onto a renumbered station, does not ask again: station ids
    // change between builds, files do not), and which root's answers still count.
    const asked = useRef(new Set<string>());
    const generation = useRef(0);
    useEffect(() => {
        generation.current += 1;
        asked.current = new Set();
        setStack([]); setSelected(null); setRecords([]); setPending(0); setNotice(null);
    }, [rootId]);

    // The graph as the drill reads it: the stored files plus the definitions loaded so far.
    const full = useMemo(() => (graph ? withSymbolRecords(graph, records) : null), [graph, records]);

    // Asks the host for the definitions of those of `files` not asked about yet; never asks for nothing.
    const requestSymbols = useCallback((files: readonly string[]) => {
        const refs = files.filter((f) => !asked.current.has(f));
        if (!load || refs.length === 0) return;
        for (const f of refs) asked.current.add(f);
        const mine = generation.current;
        setPending((n) => n + 1);
        const settle = (): void => { if (mine === generation.current) setPending((n) => Math.max(0, n - 1)); };
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
            if (mine === generation.current) for (const f of refs) asked.current.delete(f);
            settle();
        });
    }, [load]);

    // The map can change under the person (a re-review, Live): a package that moved follows its files to the station that
    // holds them now (and reads the definitions of the files of it that have none yet); a level whose files are gone is
    // left, and said so.
    useEffect(() => {
        if (!full) return;
        const fresh = reanchorDrill(stack, world, (ref) => full.nodes.some((n) => n.ref === ref));
        if (fresh.stack === stack) return;
        if (fresh.moved.size > 0) {
            setReanchored((r) => ({ seq: r.seq + 1, moves: fresh.moved }));
            for (const to of fresh.moved.values()) requestSymbols((world.byId.get(to)?.refs ?? []).slice(0, SYMBOL_FILES));
        }
        if (fresh.notice !== null) { setNotice(fresh.notice); setSelected(null); }
        setStack(fresh.stack);
    }, [world, full, stack, requestSymbols]);
    const view = useMemo(() => {
        const top = stack[stack.length - 1];
        return full && top ? buildDrillView(full, world, top, records) : null;
    }, [full, world, stack, records]);

    const hasMembers = useCallback((ref: string) => {
        if (!full) return false;
        const symbols = symbolsOfFile(symbolsOf(full), fileRefOf(ref));
        const parent = symbols.find((node) => node.ref === ref);
        return !!parent && isClassLike(symbolSort(parent)) && membersOfClass(symbols, parent).length > 0;
    }, [full]);

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
        // The most important files first; the HOST applies the one real cap, this only keeps the request small.
        if (check.level === 'package') requestSymbols((world.byId.get(id)?.refs ?? []).slice(0, SYMBOL_FILES));
    }, [canEnter, view, world, requestSymbols]);

    const openFile = useCallback((ref: string) => {
        const id = stationOfRef(world, ref);
        const station = id ? world.byId.get(id) : undefined;
        if (!station || !station.refs.includes(ref)) return;
        setStack([
            { level: 'package', ref: station.id, name: station.name, files: [ref] },
            { level: 'class', ref, name: tailOf(ref) },
        ]);
        setSelected(null);
        setNotice(null);
        requestSymbols([ref]);
    }, [world, requestSymbols]);

    const climb = useCallback((depth: number) => {
        const n = Number.isFinite(depth) ? Math.max(0, Math.floor(depth)) : 0;
        if (n >= stack.length) return;
        setStack((s) => s.slice(0, n));
        setSelected(null);
        setNotice(null);
    }, [stack.length]);
    const out = useCallback(() => { setStack((s) => s.slice(0, -1)); setSelected(null); setNotice(null); }, []);
    return {
        stack, view, canOut: stack.length > 0, parent: stack[stack.length - 2] ?? null, selected, select: setSelected, canEnter, enter, openFile, hasMembers, climb, out,
        loading: pending > 0, notice, symbols: records, loadFileSymbols: (ref) => requestSymbols([ref]), reanchored,
    };
}
