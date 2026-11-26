// @vitest-environment jsdom
/** The journey strip (one row), the notes of a stop, and the words of a hop (hopText / pathMermaid). */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { pathOfLine } from './path';
import { entryLabel, stationNote } from './pathNotes';
import { PathStrip } from './PathStrip';
import { hopText, pathMermaid } from './sequenceText';
import { graph, lines, model } from './testFixtures';

const path = pathOfLine(lines.lines[0]!, model.byId);
const strip = (over: Partial<Parameters<typeof PathStrip>[0]> = {}) => {
    const p = { path, step: 1, labels: L, onStep: vi.fn(), stations: model.byId, ...over };
    render(<PathStrip {...p} />);
    return p;
};
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

describe('PathStrip', () => {
    it('titles the strip with the title the root made, else "Path", after the "Journey" cap', () => {
        strip({ pathTitle: 'Web line · GET /users/:id' });
        expect(screen.getByText(L.surface.path.journey)).toBeTruthy();
        expect(screen.getByText('Web line · GET /users/:id')).toBeTruthy();
    });

    it('is just "Path" without a title', () => {
        strip();
        expect(screen.getByText(L.surface.pathTitle, { selector: 'strong' })).toBeTruthy();
    });

    it('steps either way with the arrows and jumps with a numbered chip', () => {
        const p = strip();
        click(L.surface.pathNext);
        expect(p.onStep).toHaveBeenLastCalledWith(2);
        click(L.surface.pathBack);
        expect(p.onStep).toHaveBeenLastCalledWith(0);
        const chips = screen.getByRole('list', { name: L.surface.path.stops }).querySelectorAll('button');
        expect(chips).toHaveLength(path.stops.length);
        expect(chips[0]!.querySelector('b')!.textContent).toBe('1');
        fireEvent.click(chips[2]!);
        expect(p.onStep).toHaveBeenLastCalledWith(2);
        expect(chips[1]!.getAttribute('aria-current')).toBe('step');
    });

    it('has no Reset, Run to end, Simulate, Sequence or narration: one row', () => {
        strip();
        for (const name of [L.surface.path.reset, L.surface.path.runToEnd, L.surface.path.simulate, L.surface.path.sequence]) {
            expect(screen.queryByRole('button', { name })).toBeNull();
        }
        expect(screen.queryByTestId('kg-step-narration')).toBeNull();
    });

    it('copies the Mermaid of exactly what the Sequence camera draws', () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });
        strip();
        click(L.copyMermaid);
        expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^sequenceDiagram\n    participant P1 as main\.tsx/));
    });
});

describe('hopText and pathMermaid', () => {
    it('reads the edge kind and count, or "no direct reference" at zero, and the cycle label on a cycle', () => {
        expect(hopText(L, { kind: 'references', count: 3 })).toBe('references · 3');
        expect(hopText(L, { kind: 'references', count: 0 })).toBe(L.surface.noDirectReference);
        expect(hopText(L, { kind: 'references', count: 2, cycle: true })).toBe(`references · 2 · ${L.surface.cycleHop}`);
    });

    it('is the Mermaid of the path: a participant per stop and a message per hop, with the same words', () => {
        const text = pathMermaid({ stops: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], hops: [{ kind: 'references', count: 0 }] }, L);
        expect(text).toBe(`sequenceDiagram\n    participant P1 as A\n    participant P2 as B\n    P1->>P2: ${L.surface.noDirectReference}`);
    });
});

describe('pathNotes', () => {
    it('names the first route of the entry station, else the station', () => {
        expect(entryLabel(graph, model.stations.find((s) => s.name === 'API')!)).toBe('GET /users/:id');
        expect(entryLabel(graph, model.stations.find((s) => s.name === 'Web app')!)).toBe('Web app');
        expect(entryLabel(graph, undefined)).toBe('');
    });

    it('writes no note for a clean, tested station', () => {
        expect(stationNote({ ...model.stations[0]!, cov: 0.9, patterns: [], findingIds: [] }, L)).toBeNull();
    });
});
