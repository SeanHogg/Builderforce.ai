/**
 * The flow a Sequence draws (PRD 43 B1a rule 10), as data: who takes part and which messages pass, in order, at the band
 * the user is zoomed to. Never inferred — read from:
 *
 *   - system band: the line's stops and hops (the same `Line` the map routes; one message per hop, as `sequenceOf`);
 *   - class / method band: the real `calls` edges (`callIndex`), walked depth-first from the entry symbols, each caller's
 *     calls in CALL-SITE order (`CallSite.order`), one message per call site. Each message records its nesting `depth` and
 *     the last message of its callee's subtree (`end`), which is where its activation bar ends and its return is drawn.
 *     A call to no node goes to an EXTERNAL participant (`ext:`), drawn as a terminus. The class band folds each method
 *     into its class, keeps the calls BETWEEN classes, and carries the `extends` / `implements` / `composes` association
 *     stubs between its participants; the method band keeps every call.
 *
 * Bounded by {@link SEQUENCE_MAX_DEPTH} and {@link SEQUENCE_MAX_MESSAGES}. Pure.
 */

import type { CallSite, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { symbolSort } from '../../../shapes';
import type { Line } from '../../../surface/lines';
import { fileRefOf, stationOfRef, type StationModel } from '../../../surface/stations';
import { isSymbol, parentName, shortName } from '../../../surface/transit/symbols';
import type { SymbolRecord } from '../../../types';
import { callIndex, externalName, isExternal, type Association } from './callIndex';

/** Nested call levels followed from an entry (the entry's own calls are depth 0). */
export const SEQUENCE_MAX_DEPTH = 4;
/** Messages drawn at most; the rest are counted in the placement's caption ("Showing N of M"). */
export const SEQUENCE_MAX_MESSAGES = 48;
/** Calls the walk counts past the message cap before it stops counting (keeps a huge call graph bounded). */
const COUNT_BUDGET = 4096;

export type SequenceBand = 'system' | 'class' | 'method';
/** The semantic-zoom band per `req.lod` (B1a rule 9): 0 systems, 1 classes, 2+ methods. */
export const SEQUENCE_BANDS: readonly SequenceBand[] = ['system', 'class', 'method'];
export const sequenceBandOf = (lod: number): SequenceBand => SEQUENCE_BANDS[Math.max(0, Math.min(SEQUENCE_BANDS.length - 1, Math.floor(lod)))]!;

/** A participant is a key the placement maps to a slot: a station id (system band), a node ref or an `ext:` key. */
export interface FlowMessage {
    from: string; to: string; site: CallSite | null; label: string; count: number;
    /** Nesting: 0 = a call the entry makes. */
    depth: number;
    /** Index of the last message inside this call (itself when the callee calls nothing shown): activation end, return row. */
    end: number;
}
export interface Flow {
    participants: string[];
    messages: FlowMessage[];
    total: number;
    /** Class band: the association stubs between two participants. */
    stubs: Association[];
    /** Every external target the call graph holds (sorted; the same in every band, so its slot never moves). */
    externals: string[];
    /** A symbol's class (itself for a class or a free function): what the class ↔ method split tweens through. */
    classOf: (ref: string) => string;
}

const lineOf = (n: KNode): number => Number(n.badges?.line ?? 0) || 0;
const identity = (ref: string): string => ref;

/** The class a method belongs to (same file, named as its parent, or named by ref in a loaded record), else the symbol itself. */
function classOfIndex(symbols: readonly KNode[]): (ref: string) => string {
    const classes = new Map<string, string>();
    for (const n of symbols) if (symbolSort(n) === 'class') { classes.set(`${fileRefOf(n.ref)}\0${n.label}`, n.ref); classes.set(`${fileRefOf(n.ref)}\0${shortName(n)}`, n.ref); }
    const byRef = new Map(symbols.map((n) => [n.ref as string, n] as const));
    return (ref) => {
        const n = byRef.get(ref);
        const parent = n ? parentName(n) : null;
        if (!parent) return ref;
        if (byRef.has(parent) && symbolSort(byRef.get(parent)!) === 'class') return parent;
        return classes.get(`${fileRefOf(ref)}\0${parent}`) ?? classes.get(`${fileRefOf(ref)}\0${parent.slice(parent.lastIndexOf('.') + 1)}`) ?? ref;
    };
}

/**
 * The symbols a flow starts from, for the entry key `pathId` names: a method / function itself; a class's methods; a
 * file's top-level symbols; a station's (or a line's first stop's) files' symbols — each list in source-line order.
 */
function entrySymbols(entry: string | null, symbols: readonly KNode[], stations: StationModel, line: Line | null, classOf: (ref: string) => string): string[] {
    const sorted = [...symbols].sort((a, b) => (fileRefOf(a.ref) < fileRefOf(b.ref) ? -1 : fileRefOf(a.ref) > fileRefOf(b.ref) ? 1 : lineOf(a) - lineOf(b)));
    const expand = (list: readonly KNode[]): string[] => list.flatMap((n) => (symbolSort(n) === 'class' ? sorted.filter((m) => m.ref !== n.ref && classOf(m.ref) === n.ref).map((m) => m.ref as string) : [n.ref as string]));
    if (entry?.startsWith('node:')) {
        const ref = entry.slice(5);
        const own = sorted.find((n) => n.ref === ref);
        if (own) return expand([own]);
        return expand(sorted.filter((n) => fileRefOf(n.ref) === ref && classOf(n.ref) === n.ref));
    }
    const station = entry?.startsWith('st:') ? entry.slice(3) : line?.stops[0];
    if (!station) return [];
    return expand(sorted.filter((n) => classOf(n.ref) === n.ref && stationOfRef(stations, fileRefOf(n.ref)) === station));
}

export interface FlowInput {
    band: SequenceBand;
    /** `req.pathId`: `node:<ref>`, `st:<id>` or a line id; null = the first line. */
    entry: string | null;
    full: KnowledgeGraph;
    records: readonly SymbolRecord[];
    stations: StationModel;
    lines: readonly Line[];
}

/** The line a system-band flow follows: the named line, the first line through the entry's station, or the first line. */
function lineOfEntry(entry: string | null, stations: StationModel, lines: readonly Line[]): Line | null {
    const named = entry ? lines.find((l) => l.id === entry) : undefined;
    if (named) return named;
    const station = entry?.startsWith('st:') ? entry.slice(3) : entry?.startsWith('node:') ? stationOfRef(stations, fileRefOf(entry.slice(5))) : undefined;
    return (station !== undefined ? lines.find((l) => l.stops.includes(station)) : undefined) ?? lines[0] ?? null;
}

export function sequenceFlow(input: FlowInput): Flow {
    const { band, entry, full, stations, lines } = input;
    const line = lineOfEntry(entry, stations, lines);
    const symbols = full.nodes.filter(isSymbol);
    const classOf = classOfIndex(symbols);
    if (band === 'system') {
        const stops = line?.stops ?? [];
        const messages = stops.slice(1).map((to, i) => ({ from: stops[i]!, to, site: null, label: '', count: line?.hops[i]?.count ?? 0, depth: 0, end: i }));
        return { participants: [...stops], messages, total: messages.length, stubs: [], externals: [], classOf };
    }
    const fold = band === 'class' ? classOf : identity;
    const names = new Map(symbols.map((n) => [n.ref as string, shortName(n)] as const));
    const index = callIndex(full, input.records);
    const participants: string[] = [], messages: FlowMessage[] = [];
    const seenParticipant = new Set<string>();
    const meet = (p: string) => { if (!seenParticipant.has(p)) { seenParticipant.add(p); participants.push(p); } };
    let total = 0, budget = COUNT_BUDGET;
    const walk = (caller: string, depth: number, stack: Set<string>): void => {
        for (const c of index.calls.get(caller) ?? []) {
            if (budget-- <= 0) return;
            const from = fold(caller), to = fold(c.to);
            let at = -1;
            if (from !== to || band === 'method') {
                total++;
                if (messages.length < SEQUENCE_MAX_MESSAGES) {
                    meet(from); meet(to);
                    at = messages.length;
                    messages.push({ from, to, site: c.site, label: isExternal(c.to) ? externalName(c.to) : names.get(c.to) ?? c.to, count: 1, depth, end: at });
                }
            }
            if (depth + 1 < SEQUENCE_MAX_DEPTH && !stack.has(c.to)) { stack.add(c.to); walk(c.to, depth + 1, stack); stack.delete(c.to); }
            if (at >= 0) messages[at]!.end = messages.length - 1;
        }
    };
    for (const start of entrySymbols(entry, symbols, stations, line, classOf)) {
        if (!index.calls.has(start)) continue;
        meet(fold(start));
        walk(start, 0, new Set([start]));
    }
    const shown = new Set(participants);
    const stubs = band !== 'class' ? [] : index.associations
        .map((a) => ({ ...a, from: classOf(a.from), to: classOf(a.to) }))
        .filter((a, i, all) => a.from !== a.to && shown.has(a.from) && shown.has(a.to) && all.findIndex((b) => b.from === a.from && b.to === a.to && b.kind === a.kind) === i);
    return { participants, messages, total, stubs, externals: index.externals, classOf };
}
