/**
 * The ONE fold of appended slots (PRD 43 B1a rule 1) — loaded definitions the resident graph lacks (`node:<ref>`, their
 * forest the station and folder of their file) and a Sequence's external call targets (`ext:` keys, the `external`
 * dashed-cross type, no forest) — read by the drill and the Sequence alike.
 *
 * Numbering is by KEY, not by position: the held stage model keeps a registry (`model.appended`, reset only with a new
 * MarkSet, as the renderer's live keys are). A key already appended keeps its slot; a new key takes the next free one.
 * So a drill after a Sequence (or the reverse) never lands two keys on one slot, and every answer carries the WHOLE
 * registry from the MarkSet's end (`Placement.append`): a prefix of any later answer's, which the renderer's
 * `AppendedSlots` / `LiveKeys` / `SlotTable.appendRun` all fold the same way. Pure but for that registry.
 */

import type { KnowledgeGraph, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { importanceOf } from '../../../order';
import { markTypeOf } from '../../../shapes';
import { withAppended } from '../../../stage/drill/appended';
import { fileRefOf, stationOfRef } from '../../../surface/stations';
import { SLOT_NODE, type MarkSet, type SlotAppend } from '../../../stage/types';
import { typeIndex } from '../markSet';
import type { StageModel } from '../stageModel';
import { externalName } from './callIndex';

export interface SymbolSlots { marks: MarkSet; append: SlotAppend | null; nodeSlot: Map<string, number> }

/** The keys appended to a model's MarkSet so far, in slot order (slot = MarkSet size + index). */
export interface AppendedRegistry {
    keys: string[];
    at: Map<string, number>;
    label: string[]; tooltip: string[]; type: number[]; importance: number[]; parentStation: number[]; parentFolder: number[];
}

export const emptyRegistry = (): AppendedRegistry => ({ keys: [], at: new Map(), label: [], tooltip: [], type: [], importance: [], parentStation: [], parentFolder: [] });

/**
 * `full` = `withSymbolRecords(graph, req.symbols)`; its nodes past `graphNodes` are the loaded definitions. `externals`
 * (`ext:` keys) too. Every appended slot is in `nodeSlot` under its ref (a symbol) or its key (an external).
 */
export function symbolSlots(model: StageModel, full: KnowledgeGraph, graphNodes: number, externals: readonly string[] = []): SymbolSlots {
    const reg = model.appended;
    const m = model.marks, base = m.keys.length;
    const add = (key: string, entry: { label: string; tooltip: string; type: number; importance: number; parentStation: number; parentFolder: number }) => {
        if (reg.at.has(key)) return;
        reg.at.set(key, reg.keys.length);
        reg.keys.push(key); reg.label.push(entry.label); reg.tooltip.push(entry.tooltip); reg.type.push(entry.type);
        reg.importance.push(entry.importance); reg.parentStation.push(entry.parentStation); reg.parentFolder.push(entry.parentFolder);
    };
    const symbols: KNode[] = full.nodes.slice(graphNodes);
    for (const node of symbols) {
        const file = fileRefOf(node.ref), station = stationOfRef(model.stations, file), fileSlot = model.nodeSlot.get(file);
        add(`node:${node.ref}`, {
            label: node.label, tooltip: node.ref, type: typeIndex(markTypeOf(node)), importance: importanceOf(node),
            parentStation: station === undefined ? -1 : model.stationSlot.get(station) ?? -1,
            parentFolder: fileSlot === undefined ? -1 : m.parentFolder[fileSlot] ?? -1,
        });
    }
    for (const key of externals) add(key, { label: externalName(key), tooltip: key.slice(key.indexOf(':') + 1), type: typeIndex('external'), importance: 0, parentStation: -1, parentFolder: -1 });
    if (reg.keys.length === 0) return { marks: m, append: null, nodeSlot: model.nodeSlot };

    const append: SlotAppend = {
        base, keys: [...reg.keys], label: [...reg.label], tooltip: [...reg.tooltip],
        type: Uint8Array.from(reg.type), slotKind: new Uint8Array(reg.keys.length).fill(SLOT_NODE), importance: Float32Array.from(reg.importance),
        parentStation: Int32Array.from(reg.parentStation), parentFolder: Int32Array.from(reg.parentFolder),
    };
    const nodeSlot = new Map(model.nodeSlot);
    reg.keys.forEach((key, i) => nodeSlot.set(key.startsWith('node:') ? key.slice('node:'.length) : key, base + i));
    return { marks: withAppended(m, append), append, nodeSlot };
}
