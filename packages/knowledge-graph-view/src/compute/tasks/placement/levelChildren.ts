/**
 * What ONE level of the Map / 3D scene draws (the design shows one level at a time). The hierarchy is the outline's:
 *
 *   world            2 or more systems → the systems; one system → its apps (a level with a single child opens through
 *                    it, the design's root opens straight onto areas); no apps → the code stations;
 *   system:<path>    the system's apps, plus its code stations that have no app;
 *   app:<path>       the code stations of that app;
 *   package / class / function   the members `drillLevel` already computes (a station's files, a file's symbols, a symbol
 *                    and its callees); the world stations they reach stand beside them as ghost leaves.
 *
 * A system or app is its folder slot (`dir:<path>`; a folder the MarkSet does not hold borrows its biggest station's slot);
 * a station is its station slot; a file or symbol is its node slot. Stations with no code file (`.plans`, `.claude`, root
 * docs) belong to no level: they are counted as "not on the map". {@link Level.below} gives each child its own children
 * (the roof miniatures; the next level's count). Pure; worker-safe.
 */

import type { KnowledgeGraph, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { MARK_TYPE_ORDER, type MarkType } from '../../../shapes';
import { LAYER_ORDER } from '../../../surface/layers';
import { fileNodesOf, isArchitectureFile, tailOf } from '../../../surface/outlineGraph';
import type { Station } from '../../../surface/stations';
import { modulesOfFiles, primarySystems, systemName, systemsOf } from '../../../surface/systems';
import type { DrillFrame, DrillLevel } from '../../../surface/transit/drillView';
import type { SymbolRecord } from '../../../types';
import type { StageModel } from '../stageModel';
import { dirKey, dirSlotsOf } from '../markSet';
import { drillLevel } from './drillLevel';
import { MAX_CHILDREN, type Tier } from './levelGeometry';
import { tierOf } from './tierLayout';

/** A drilled level draws more than a structural one: a package's files are the level (the design's areas hold dozens). */
export const MAX_DRILL_CHILDREN = 48;

export interface LevelChild {
    /** The identity the frame is entered by: `dir:<path>` (system, app), `st:<id>` (a station), else the slot's key. */
    key: string;
    slot: number;
    role: 'system' | 'app' | 'station' | 'node';
    name: string;
    type: MarkType;
    tier: Tier;
    /** Code files held (a file or symbol is 1). */
    files: number;
    /** The code file refs it holds / the ref it draws: floor links map graph edges onto children through them. */
    refs: readonly string[];
    /** The station ids it holds: the lines' stops map onto children through them. */
    stationIds: readonly string[];
    cx: number | undefined;
    importance: number;
    risky: boolean;
    /** A world station beside a drilled level (drawn at 0.62). */
    ghost: boolean;
}

export interface Level {
    level: 'world' | DrillLevel;
    ref: string | null;
    name: string;
    /** The model every slot below belongs to: the world's, or the drilled level's (with its appended slots and its lines). */
    model: StageModel;
    /** The children drawn (capped), in layout order. */
    children: LevelChild[];
    /** The children the level holds, before the cap. */
    total: number;
    notOnMap: { stations: number; files: number; examples: string[] };
    /** The drilled level's own build (its view, appended slots), when this is a package / class / function level. */
    drilled: ReturnType<typeof drillLevel> | null;
    /** A child's own children: what stands small on its roof, and what the next level opens onto. */
    below(child: LevelChild): LevelChild[];
}

interface Entry { s: Station; refs: string[]; app: string; system: string }

const NO_SLOT = -1;

function dominant(counts: ReadonlyMap<string, number>): string {
    let best = '', most = 0;
    for (const [k, c] of counts) if (c > most) { best = k; most = c; }
    return best;
}

/** The world's code stations with their code files, app and system; the rest are what is not on the map. */
function entriesOf(g: KnowledgeGraph, model: StageModel): { code: Entry[]; off: Station[] } {
    const isCode = new Set(fileNodesOf(g).filter(isArchitectureFile).map((n) => n.ref as string));
    const modules = modulesOfFiles(g);
    const code: Entry[] = [], off: Station[] = [];
    for (const s of model.stations.stations) {
        const refs = s.refs.filter((r) => isCode.has(r));
        if (refs.length === 0) { off.push(s); continue; }
        const counts = new Map<string, number>();
        for (const r of refs) { const a = modules.get(r); if (a) counts.set(a, (counts.get(a) ?? 0) + 1); }
        code.push({ s, refs, app: s.app || dominant(counts), system: s.system ?? '' });
    }
    return { code, off };
}

const bySize = (a: LevelChild, b: LevelChild): number => b.files - a.files || b.importance - a.importance || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export function levelOf(g: KnowledgeGraph, model: StageModel, frame: Pick<DrillFrame, 'level' | 'ref'> | null, symbols: readonly SymbolRecord[] = []): Level {
    const { code, off } = entriesOf(g, model);
    const notOnMap = { stations: off.length, files: off.reduce((n, s) => n + s.files, 0), examples: off.slice(0, 3).map((s) => s.name) };
    const typeAt = (marks: StageModel['marks'], slot: number): MarkType => MARK_TYPE_ORDER[marks.type[slot]!] ?? 'source';
    const dirAt = dirSlotsOf(model.marks.keys);
    const systems = systemsOf(g), byRef = new Map(g.nodes.map((n) => [n.ref as string, n] as const));

    const stationChild = (e: Entry): LevelChild | null => {
        const slot = model.stationSlot.get(e.s.id);
        if (slot === undefined) return null;
        return {
            key: `st:${e.s.id}`, slot, role: 'station', name: e.s.name, type: typeAt(model.marks, slot), tier: tierOf(e.s.layer), files: e.refs.length,
            refs: e.refs, stationIds: [e.s.id], cx: e.s.cx, importance: e.s.use, risky: e.s.anti >= 3, ghost: false,
        };
    };
    /** A system or an app: its folder slot, or (a folder the MarkSet lacks) the slot of its biggest station not yet used. */
    const folderChild = (role: 'system' | 'app', path: string, name: string, held: readonly Entry[], used: Set<number>): LevelChild | null => {
        let slot = dirAt.get(path) ?? NO_SLOT;
        if (slot === NO_SLOT || used.has(slot)) {
            slot = held.map((e) => model.stationSlot.get(e.s.id) ?? NO_SLOT).find((s) => s !== NO_SLOT && !used.has(s)) ?? NO_SLOT;
        }
        if (slot === NO_SLOT) return null;
        used.add(slot);
        const layers = new Map<string, number>();
        for (const e of held) if (e.s.layer) layers.set(e.s.layer, (layers.get(e.s.layer) ?? 0) + e.refs.length);
        return {
            key: dirKey(path), slot, role, name, type: 'system', tier: tierOf(dominant(layers)), files: held.reduce((n, e) => n + e.refs.length, 0),
            refs: held.flatMap((e) => e.refs), stationIds: held.map((e) => e.s.id), cx: undefined,
            importance: held.reduce((n, e) => n + e.s.use, 0), risky: held.some((e) => e.s.anti >= 3), ghost: false,
        };
    };
    const group = (held: readonly Entry[], by: (e: Entry) => string): Map<string, Entry[]> => {
        const out = new Map<string, Entry[]>();
        for (const e of held) { const k = by(e), list = out.get(k); if (list) list.push(e); else out.set(k, [e]); }
        return out;
    };
    const stations = (held: readonly Entry[]): LevelChild[] => held.flatMap((e) => stationChild(e) ?? []).sort(bySize);
    /** A system's (or the single system's) apps, and the code stations that have no app. */
    const appsAndLoose = (held: readonly Entry[]): LevelChild[] => {
        const used = new Set<number>(), out: LevelChild[] = [];
        for (const [app, list] of group(held, (e) => e.app)) {
            if (!app) { out.push(...stations(list)); continue; }
            const child = folderChild('app', app, tailOf(app), list, used);
            if (child) out.push(child); else out.push(...stations(list));
        }
        return out.sort(bySize);
    };
    const systemsOfWorld = (held: readonly Entry[]): LevelChild[] => {
        const used = new Set<number>(), out: LevelChild[] = [];
        for (const [path, list] of group(held, (e) => e.system)) {
            const child = path ? folderChild('system', path, systemName(systems, path) ?? tailOf(path), list, used) : null;
            if (child) out.push(child); else out.push(...stations(list));
        }
        return out.sort(bySize);
    };
    const worldChildren = (): LevelChild[] => {
        const multi = primarySystems(systems).length >= 2;
        let held = code, kids = multi ? systemsOfWorld(held) : appsAndLoose(held);
        // A level with exactly one child opens through it.
        for (let guard = 0; guard < 2 && kids.length === 1 && kids[0]!.role !== 'station'; guard++) {
            const only = kids[0]!, ids = new Set(only.stationIds);
            held = held.filter((e) => ids.has(e.s.id));
            kids = only.role === 'system' ? appsAndLoose(held) : stations(held);
        }
        return kids;
    };
    const nodeChildren = (parent: LevelChild): LevelChild[] => parent.refs.flatMap((ref): LevelChild[] => {
        const slot = model.nodeSlot.get(ref), node: KNode | undefined = byRef.get(ref);
        if (slot === undefined || !node) return [];
        return [{
            key: model.marks.keys[slot]!, slot, role: 'node', name: model.marks.label[slot] ?? tailOf(ref), type: typeAt(model.marks, slot), tier: tierOf(node.partition),
            files: 1, refs: [ref], stationIds: [], cx: undefined, importance: model.marks.importance[slot] ?? 0, risky: false, ghost: false,
        }];
    }).sort((a, b) => b.importance - a.importance);
    const entriesIn = (child: LevelChild): Entry[] => { const ids = new Set(child.stationIds); return code.filter((e) => ids.has(e.s.id)); };
    const below = (child: LevelChild): LevelChild[] =>
        child.role === 'system' ? appsAndLoose(entriesIn(child)) : child.role === 'app' ? stations(entriesIn(child)) : child.role === 'station' && !child.ghost ? nodeChildren(child) : [];

    const structural = (list: LevelChild[], level: Level['level'], ref: string | null, name: string): Level =>
        ({ level, ref, name, model, children: list.slice(0, MAX_CHILDREN), total: list.length, notOnMap, drilled: null, below });

    if (!frame) return structural(worldChildren(), 'world', null, model.marks.label[dirAt.get('') ?? NO_SLOT] ?? '');
    if (frame.level === 'system') {
        const held = code.filter((e) => e.system === frame.ref);
        return structural(appsAndLoose(held), 'system', frame.ref, systemName(systems, frame.ref) ?? tailOf(frame.ref));
    }
    if (frame.level === 'app') return structural(stations(code.filter((e) => e.app === frame.ref)), 'app', frame.ref, tailOf(frame.ref));
    return drilledLevel(g, model, frame as Pick<DrillFrame, 'level' | 'ref'> & { level: Exclude<DrillLevel, 'system' | 'app'> }, symbols, notOnMap);
}

/** The members of a package, class or function level, from the ONE drilled build; neighbours are ghost leaves. */
function drilledLevel(g: KnowledgeGraph, model: StageModel, frame: { level: Exclude<DrillLevel, 'system' | 'app'>; ref: string }, symbols: readonly SymbolRecord[], notOnMap: Level['notOnMap']): Level {
    const drilled = drillLevel(g, model, frame, symbols);
    const { level, view, stationSlot } = drilled;
    const order = view.order;
    const tierFor = (s: Station): Tier => {
        if (s.layer && (LAYER_ORDER as readonly string[]).includes(s.layer)) return tierOf(s.layer);
        const at = order.indexOf(s.layer ?? '');
        return at <= 0 ? 'front' : at === 1 ? 'mid' : 'back';
    };
    const all = view.stations.stations.flatMap((s): LevelChild[] => {
        const slot = stationSlot.get(s.id);
        if (slot === undefined) return [];
        const leaf = view.leaves.has(s.id);
        return [{
            key: level.marks.keys[slot]!, slot, role: leaf ? 'station' : 'node', name: s.name, type: MARK_TYPE_ORDER[level.marks.type[slot]!] ?? 'source',
            tier: leaf ? 'back' : tierFor(s), files: leaf ? s.files : 1, refs: s.refs, stationIds: [s.id], cx: s.cx, importance: s.use || level.marks.importance[slot] || 0,
            risky: s.anti >= 3, ghost: leaf,
        }];
    });
    const members = all.filter((c) => !c.ghost).sort((a, b) => b.importance - a.importance), leaves = all.filter((c) => c.ghost);
    const name = frame.level === 'package' ? model.stations.byId.get(frame.ref)?.name ?? tailOf(frame.ref) : level.marks.label[model.nodeSlot.get(frame.ref) ?? NO_SLOT] ?? tailOf(frame.ref);
    const list = [...members.slice(0, MAX_DRILL_CHILDREN - leaves.length), ...leaves];
    return { level: frame.level, ref: frame.ref, name, model: level, children: list, total: members.length + leaves.length, notOnMap, drilled, below: () => [] };
}

/** The children of a level (a frame, or the world for null), as the level scene draws them. */
export const levelChildren = (g: KnowledgeGraph, model: StageModel, frame: Pick<DrillFrame, 'level' | 'ref'> | null, symbols: readonly SymbolRecord[] = []): LevelChild[] =>
    levelOf(g, model, frame, symbols).children;
