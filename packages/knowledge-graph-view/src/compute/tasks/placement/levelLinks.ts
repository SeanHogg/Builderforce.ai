/**
 * The level scene's floor links (the design's `floorLinks`): the references between the level's children as raised bars,
 * ONE `hall` batch. A graph edge between two files counts for the pair of children that hold them (system, app, station or
 * file level: the map's own `mapEdges`); a symbol level has no file edges, so the hops of its lines count instead. Only the
 * heaviest `2 × children` pairs are kept. A pair a selected line's consecutive stops cross carries that line's id, so
 * picking the bar selects the line. Pure.
 */

import { mapEdges } from '../../../surface/outlineGraph';
import { toneIndex } from '../../../stage/tones';
import { DASH_SOLID, FLAG, type LinkBatch } from '../../../stage/types';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { LINK, U } from './levelGeometry';
import type { Level } from './levelChildren';
import { linkBatch, type LinkPath } from './links';

interface Pair { a: number; b: number; weight: number; line: string }

const pairKey = (a: number, b: number): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function floorLinks(g: Pick<KnowledgeGraph, 'nodes' | 'edges' | 'outline'>, lv: Level, at: readonly { x: number; z: number }[]): LinkBatch {
    const byRef = new Map<string, number>(), byStation = new Map<string, number>();
    lv.children.forEach((c, i) => { for (const r of c.refs) byRef.set(r, i); for (const s of c.stationIds) byStation.set(s, i); });
    const pairs = new Map<string, Pair>();
    const add = (a: number | undefined, b: number | undefined, weight: number): Pair | undefined => {
        if (a === undefined || b === undefined || a === b) return undefined;
        const key = pairKey(a, b), held = pairs.get(key) ?? { a: Math.min(a, b), b: Math.max(a, b), weight: 0, line: '' };
        held.weight += weight;
        pairs.set(key, held);
        return held;
    };
    const lines = lv.model.lines.lines;
    if (lv.level === 'class' || lv.level === 'function') {
        for (const line of lines) for (const hop of line.hops) add(byStation.get(hop.from), byStation.get(hop.to), hop.count || 1);
    } else {
        for (const e of mapEdges(g as KnowledgeGraph)) add(byRef.get(e.from), byRef.get(e.to), e.weight || 1);
    }
    for (const line of lines) {
        for (let i = 1; i < line.stops.length; i++) {
            const a = byStation.get(line.stops[i - 1]!), b = byStation.get(line.stops[i]!);
            const held = a === undefined || b === undefined || a === b ? undefined : pairs.get(pairKey(a, b));
            if (held && !held.line) held.line = line.id;
        }
    }
    const kept = [...pairs.values()].sort((p, q) => q.weight - p.weight || p.a - q.a || p.b - q.b).slice(0, 2 * lv.children.length);
    const paths: LinkPath[] = kept.map((p) => ({
        pts: [{ x: at[p.a]!.x, y: at[p.a]!.z }, { x: at[p.b]!.x, y: at[p.b]!.z }], width: LINK.width * U, tone: toneIndex('hall'), dash: DASH_SOLID,
        flags: p.line ? FLAG.SELECTABLE : 0,
    }));
    return { ...linkBatch('hall', paths, LINK.y * U), lineIds: kept.map((p) => p.line) };
}
