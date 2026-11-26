import { describe, expect, it, vi } from 'vitest';
import { render, renderHook } from '@testing-library/react';
import { buildStageModel } from '../../compute/tasks/stageModel';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import type { SceneProps } from '../../surface/registry';
import { surfaceFixture } from '../../testing';
import { createNoopStage } from '../renderer';
import { recordsForCode } from './CodeDock';
import { useStageWiring } from './useStageWiring';

// The records walk is what a docked pane must NOT trigger (a fixed perf regression): spy on it.
vi.mock('./CodeDock', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./CodeDock')>();
    return { ...actual, recordsForCode: vi.fn(actual.recordsForCode) };
});

function scene(readSource?: SceneProps['surface']['readSource']) {
    const graph = surfaceFixture();
    const model = buildStageModel(graph, []);
    const drill = { stack: [], view: null, canOut: false, parent: null, selected: null, select: vi.fn(), canEnter: () => ({ can: false, reason: 'noSymbols' as const }), enter: vi.fn(), out: vi.fn(), loading: false, notice: null, symbols: [], reanchored: { seq: 0, moves: new Map() } };
    return { graph, p: { graph, labels: L, onSelect: vi.fn(), surface: { stations: model.stations, drill, line: null, selectLine: vi.fn(), selectStation: vi.fn(), setQuestion: vi.fn(), openPanel: vi.fn(), readSource } } as unknown as SceneProps };
}

describe('the docked pane is not the reading pane', () => {
    it('docked at a wide box: the outline shows, nothing is read (no records walk, no bar, no status strip)', () => {
        vi.mocked(recordsForCode).mockClear();
        const { p } = scene(async () => null);
        const { result } = renderHook(() => useStageWiring(p, createNoopStage(), null, 1000));
        expect(result.current.code).toMatchObject({ visible: true, split: true, reading: false, bar: null });
        expect(result.current.status).toBeNull();
        expect(recordsForCode).not.toHaveBeenCalled();
        const { container } = render(<div>{result.current.code.pane}</div>);
        expect(container.querySelector('[data-level-outline]')).not.toBeNull();
        expect(container.querySelector('[data-outline-member]')).not.toBeNull();
    });

    it('a host with no readSource still docks the outline, and says the source is not here', () => {
        const { p } = scene(undefined);
        const { result } = renderHook(() => useStageWiring(p, createNoopStage(), null, 1000));
        const { container } = render(<div>{result.current.code.pane}</div>);
        expect(container.querySelector('[data-outline-note]')?.textContent).toBe(L.surface.code.levelNoSource);
    });

    it('below SPLIT_MIN_PX the pane is not split (the host shows the Code | Picture switch); hidden, it has no pane and offers Show', () => {
        const { p } = scene();
        const onToggleCode = vi.fn();
        const narrow = renderHook(() => useStageWiring(p, createNoopStage(), null, 360));
        expect(narrow.result.current.code).toMatchObject({ visible: true, split: false });
        const hidden = renderHook(() => useStageWiring(p, createNoopStage(), null, 1000, { shown: false, onToggleCode }));
        expect(hidden.result.current.code).toMatchObject({ visible: false, split: false, pane: null });
        hidden.result.current.code.show?.();
        expect(onToggleCode).toHaveBeenCalledTimes(1);
    });
});
