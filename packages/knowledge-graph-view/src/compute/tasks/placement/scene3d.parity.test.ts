import { describe, expect, it } from 'vitest';
import { codeFixture } from '../../../testing';
import { FLAG, SLOT_NODE } from '../../../stage/types';
import { paintMarks } from '../markPaint';
import { buildStageModel } from '../stageModel';
import { channelBindings } from './request';

const graph = codeFixture();
const model = buildStageModel(graph);
const { marks } = model;
const slotOf = (ref: string) => model.nodeSlot.get(ref)!;

describe('architecture stage paint', () => {
    it('dims what the lens is not about', () => {
        const paint = paintMarks(graph, model, { lensId: 'unused', overlay: channelBindings(), lit: null, roles: null });
        const nodes = [...marks.keys.keys()].filter((i) => marks.slotKind[i] === SLOT_NODE);
        const lit = nodes.filter((i) => !(paint.flags[i]! & FLAG.DIM));
        expect(lit).toEqual([slotOf('src:code::infrastructure/legacy.ts')]);
        expect(nodes.length - lit.length).toBe(graph.nodes.length - 1);
    });
});
