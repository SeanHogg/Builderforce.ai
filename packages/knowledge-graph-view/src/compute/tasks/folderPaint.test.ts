/**
 * Regressions from the VS Code webview's Mind map: every folder mark was a near-black square. Folders were painted the
 * area BACKGROUND tone (`--bf-border-strong`), then dimmed toward the background by the default question, because a
 * folder lit only through a lit NODE — and the question answers in stations whose members need not be drawn nodes.
 */

import { describe, expect, it } from 'vitest';
import type { Finding, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { toneIndex } from '../../stage/tones';
import { FLAG, SLOT_FOLDER, SLOT_NODE, SLOT_STATION } from '../../stage/types';
import type { Station } from '../../surface/stations';
import { FOLDER_QUIET_TONE, lightFolders, paintFolders } from './folderPaint';

const REF = 'src:r::a/x.ts';
// Slots: 0 the node a/x.ts, 1 the root folder, 2 folder a, 3 folder b, 4 a station whose member is in folder b.
const marks = {
    keys: [`node:${REF}`, 'dir:', 'dir:a', 'dir:b', 'st:s1'],
    slotKind: new Uint8Array([SLOT_NODE, SLOT_FOLDER, SLOT_FOLDER, SLOT_FOLDER, SLOT_STATION]),
    parentFolder: new Int32Array([2, -1, 1, 1, -1]),
};
const node = { ref: REF, kind: 'file', label: 'x.ts', pack: 'code', importance: 0.5, origin: 'extracted' } as unknown as KNode;
const finding = (severity: Finding['severity']): Finding => ({ severity, nodes: [REF] } as unknown as Finding);

describe('folder paint', () => {
    it('regression: a folder is never the area background tone; it takes the worst finding beneath it, else a legible quiet tone', () => {
        const tone = new Uint8Array(5), flags = new Uint8Array(5);
        paintFolders({ nodes: [node], findings: [finding('warn'), finding('error')] }, marks, tone, flags);
        expect(tone[2]).toBe(toneIndex('violation')); // a's file has an error
        expect(tone[1]).toBe(toneIndex('violation')); // and the root holds a
        expect(tone[3]).toBe(toneIndex(FOLDER_QUIET_TONE)); // nothing found under b
        for (const f of [1, 2, 3]) { expect(tone[f]).not.toBe(toneIndex('nodeArea')); expect(flags[f]).toBe(FLAG.SELECTABLE); }
        expect(FOLDER_QUIET_TONE).toBe('muted');
    });

    it('counts FILE findings only, as the SVG mind map\'s folder tree does (a symbol\'s finding does not tone its folder)', () => {
        const tone = new Uint8Array(5), flags = new Uint8Array(5);
        const symbol = { ...node, ref: `${REF}#f`, kind: 'symbol' } as unknown as KNode;
        const onSymbol = { severity: 'error', nodes: [`${REF}#f`] } as unknown as Finding;
        paintFolders({ nodes: [node, symbol], findings: [onSymbol] }, marks, tone, flags);
        expect(tone[2]).toBe(toneIndex(FOLDER_QUIET_TONE));
    });

    it('regression: a lit station lights the folders of its member files, even when no member is a drawn node', () => {
        const on = new Uint8Array([0, 0, 0, 0, 1]);
        const s1 = { id: 's1', refs: ['src:r::b/deep/y.ts'] } as unknown as Station;
        lightFolders(on, marks, { stations: [s1] }, new Map([['s1', 4]]));
        // b/deep is no folder of the tree: the member sits in its nearest one, b, and the root above it.
        expect([...on]).toEqual([0, 1, 0, 1, 1]);
    });

    it('a lit node lights its folder and the folders above it; an unlit station lights nothing', () => {
        const on = new Uint8Array([1, 0, 0, 0, 0]);
        lightFolders(on, marks, { stations: [{ id: 's1', refs: ['src:r::b/y.ts'] } as unknown as Station] }, new Map([['s1', 4]]));
        expect([...on]).toEqual([1, 1, 1, 0, 0]);
    });
});
