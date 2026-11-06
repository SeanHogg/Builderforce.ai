// @vitest-environment jsdom
/** The path strip, the notes it hangs on a stop, and the words of a hop (hopText / pathMermaid). */
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
    const p = { path, step: 1, labels: L, onStep: vi.fn(), stations: model.byId, onOpenPanel: vi.fn(), ...over };
    render(<PathStrip {...p} />);
    return p;
};
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

describe('PathStrip', () => {
    it('titles the strip with the title the root made (in mono), else "Path"', () => {
        strip({ pathTitle: 'Web line · GET /users/:id' });
        expect(screen.getByText('Web line · GET /users/:id')).toBeTruthy();
    });

    it('is just "Path" without a title', () => {
        strip();
        expect(screen.getByText(L.surface.pathTitle, { selector: 'strong' })).toBeTruthy();
    });

    it('resets to the first stop, steps either way and runs to the end', () => {
        const p = strip();
        click(L.surface.path.reset);
        expect(p.onStep).toHaveBeenLastCalledWith(0);
        click(L.surface.pathNext);
        expect(p.onStep).toHaveBeenLastCalledWith(2);
        click(L.surface.pathBack);
        expect(p.onStep).toHaveBeenLastCalledWith(0);
        click(L.surface.path.runToEnd);
        expect(p.onStep).toHaveBeenLastCalledWith(path.stops.length - 1);
    });

    it('offers Run to end only before the last stop', () => {
        strip({ step: path.stops.length - 1 });
        expect((screen.getByRole('button', { name: L.surface.path.runToEnd }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('opens the Simulate drawer from "Simulate with values"', () => {
        const p = strip();
        click(L.surface.path.simulate);
        expect(p.onOpenPanel).toHaveBeenCalledWith('simulate');
    });

    it('notes a stop from its metrics ("no tests") and patterns', () => {
        strip();
        const repo = model.stations.find((s) => s.name === 'repositories')!;
        expect(document.querySelector(`[data-stop-note="${repo.id}"]`)!.textContent).toContain(L.surface.path.noTests);
        const api = model.stations.find((s) => s.name === 'API')!;
        expect(document.querySelector(`[data-stop-note="${api.id}"]`)!.textContent).toContain(api.patterns[0]!);
    });

    it('swaps the stop chips for the sequence diagram with the Sequence toggle, which then offers Enlarge', () => {
        const onEnlarge = vi.fn();
        strip({ onEnlarge });
        expect(screen.queryByRole('button', { name: L.surface.path.enlarge })).toBeNull();
        const toggle = screen.getByRole('button', { name: L.surface.path.sequence });
        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-pressed')).toBe('true');
        expect(document.querySelectorAll('[data-lifeline]')).toHaveLength(path.stops.length);
        expect(screen.queryByRole('list', { name: L.surface.path.stops })).toBeNull();
        click(L.surface.path.enlarge);
        expect(onEnlarge).toHaveBeenCalled();
        fireEvent.click(toggle);
        expect(document.querySelector('[data-lifeline]')).toBeNull();
    });

    it('copies the Mermaid of exactly what the Sequence camera draws', () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });
        strip();
        click(L.copyMermaid);
        expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^sequenceDiagram\n    participant P1 as main\.tsx/));
    });

    it('is a vertical list on a phone and keeps the hops between the stops', () => {
        strip({ narrow: true });
        const list = screen.getByRole('list', { name: L.surface.path.stops });
        expect(list.style.flexDirection).toBe('column');
        expect(list.querySelectorAll('[data-hop]')).toHaveLength(path.hops.length);
    });

    it('draws a hop\'s detail (what travels over it) when the edge carries one', () => {
        strip({ path: { ...path, hops: path.hops.map((h, i) => (i === 0 ? { ...h, detail: 'PUT 1.4 MB' } : h)) } });
        expect(screen.getByText(/PUT 1\.4 MB/)).toBeTruthy();
    });

    it('marks a cycle hop with a glyph and the cycle label (never colour alone)', () => {
        strip({ path: { ...path, hops: path.hops.map((h, i) => (i === 0 ? { ...h, cycle: true } : h)) } });
        const hop = document.querySelector('[data-hop][data-cycle]')!;
        expect(hop.querySelector('[data-cycle-mark]')).not.toBeNull();
        expect(hop.textContent).toContain(L.surface.cycleHop);
    });

    it('says "no direct reference" for a hop with a zero count, the same words the Sequence camera uses', () => {
        strip({ path: { ...path, hops: path.hops.map((h, i) => (i === 0 ? { ...h, count: 0 } : h)) } });
        expect(document.querySelector('[data-hop]')!.textContent).toContain(L.surface.noDirectReference);
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
