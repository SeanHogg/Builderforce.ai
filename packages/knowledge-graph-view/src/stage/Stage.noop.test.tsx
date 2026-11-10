import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { buildStageModel } from '../compute/tasks/stageModel';
import { PLACEMENTS } from '../compute/tasks/placement';
import { surfaceFixture } from '../testing';
import { frameOf, nearestSlot, toScreen } from './pick';
import { createNoopStage } from './renderer';
import { Stage } from './Stage';

const graph = surfaceFixture();
const model = buildStageModel(graph, []);
const t = PLACEMENTS.map(graph, model, { graph: 1, generation: model.marks.generation, camera: 'map', drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0 });
while (!t.step());
const map = t.result();

describe('the stage with the no-op renderer (jsdom)', () => {
    it('mounts the a11y proxies over every Tab-stop mark once the view settles, and a proxy selects its slot\'s key', async () => {
        const onSelect = vi.fn();
        render(<Stage renderer={createNoopStage()} marks={model.marks} paint={null} placement={map} colors={null} width={800} height={500} reducedMotion selected={null} onSelect={onSelect} depthLabel="Depth" />);
        const first = map.a11y[0]!;
        const proxies = await screen.findAllByRole('button', { name: first.label });
        expect(screen.getAllByRole('button')).toHaveLength(map.a11y.length);
        fireEvent.click(proxies[0]!);
        expect(onSelect).toHaveBeenCalledWith(model.marks.keys[first.slot]);
        expect(document.querySelector('canvas')).toBeNull();
    });

    it('picks the nearest shown slot from the placement alone, never a hidden one', () => {
        const frame = frameOf(map, 800, 500);
        const slot = map.a11y[0]!.slot;
        const [x, y] = toScreen(frame, map.position[slot * 3]!, map.position[slot * 3 + 2]!);
        expect(nearestSlot(map, frame, x + 3, y - 2)).toBe(slot);
        expect(map.scale[nearestSlot(map, frame, x, y)]!).toBeGreaterThan(0);
        expect(nearestSlot(map, frame, -500, -500)).toBe(-1);
    });
});
