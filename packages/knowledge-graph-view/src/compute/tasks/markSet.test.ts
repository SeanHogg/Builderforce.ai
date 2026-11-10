import { describe, expect, it } from 'vitest';
import { dirParts } from '../../map/folderTree';
import { markTypeOf, MARK_TYPE_ORDER } from '../../shapes';
import { stationOfRef } from '../../surface/stations';
import { SLOT_FOLDER, SLOT_NODE, SLOT_STATION } from '../../stage/types';
import { surfaceFixture } from '../../testing';
import { withSymbols } from '../../surface/transit/testFixtures';
import { ComputeStore } from '../store';
import { HANDLERS } from './index';
import { buildStageModel } from './stageModel';

const graph = withSymbols(surfaceFixture());
const model = buildStageModel(graph, []);
const m = model.marks;

describe('markSet (PRD 43 B1a rules 1–3)', () => {
    it('has one slot per node (slot = node index), then one per station, then one per folder', () => {
        graph.nodes.forEach((n, i) => {
            expect(m.keys[i]).toBe(`node:${n.ref}`);
            expect(m.slotKind[i]).toBe(SLOT_NODE);
        });
        model.stations.stations.forEach((s, j) => {
            const slot = graph.nodes.length + j;
            expect(m.keys[slot]).toBe(`st:${s.id}`);
            expect(m.slotKind[slot]).toBe(SLOT_STATION);
        });
        const folders = m.keys.slice(graph.nodes.length + model.stations.stations.length);
        expect(folders.length).toBeGreaterThan(0);
        expect(folders.every((k) => k.startsWith('dir:'))).toBe(true);
        expect(folders).toContain('dir:');
        expect(new Set(m.keys).size).toBe(m.keys.length);
        expect(m.capacity).toBeGreaterThan(m.keys.length);
    });

    it('types every node with the ONE registry (markTypeOf), as an index into MARK_TYPE_ORDER', () => {
        graph.nodes.forEach((n, i) => expect(MARK_TYPE_ORDER[m.type[i]!]).toBe(markTypeOf(n)));
        expect(graph.nodes.some((n) => n.kind === 'symbol')).toBe(true);
    });

    it('parents each node to its station and its folder', () => {
        graph.nodes.forEach((n, i) => {
            const station = stationOfRef(model.stations, n.ref);
            expect(m.parentStation[i]).toBe(station === undefined ? -1 : model.stationSlot.get(station));
            if (n.kind === 'file') {
                const parts = dirParts(n.ref);
                const folder = m.parentFolder[i]!;
                expect(m.keys[folder]).toBe(`dir:${parts!.join('/')}`);
                expect(m.slotKind[folder]).toBe(SLOT_FOLDER);
            }
        });
        // A folder's parent is the folder above it; the root has none.
        m.keys.forEach((k, slot) => {
            if (m.slotKind[slot] !== SLOT_FOLDER) return;
            const path = k.slice('dir:'.length);
            const parent = m.parentFolder[slot]!;
            if (path === '') expect(parent).toBe(-1);
            else expect(m.keys[parent]).toBe(`dir:${path.slice(0, Math.max(0, path.lastIndexOf('/')))}`);
        });
    });

    it('batches every slot exactly once, one batch per type present', () => {
        const seen = new Uint8Array(m.keys.length);
        for (const b of m.batches) for (const s of b.slots) { expect(m.type[s]).toBe(b.type); seen[s] = seen[s]! + 1; }
        expect([...seen].every((c) => c === 1)).toBe(true);
        expect(new Set(m.batches.map((b) => b.type)).size).toBe(m.batches.length);
    });

    it('the task builds the model once per graph and replies with copies (a transfer never detaches the pinned arrays)', () => {
        const store = new ComputeStore();
        store.adopt(1, graph);
        const run = () => { const t = HANDLERS.markSet(store, { graph: 1, changed: [], strings: {} }); while (!t.step()); return t.result(); };
        const a = run(), b = run();
        expect(a.generation).toBe(b.generation);
        expect(a.type).not.toBe(b.type);
        expect([...a.type]).toEqual([...b.type]);
    });
});
