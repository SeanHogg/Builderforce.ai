// @vitest-environment jsdom
/** PRD 38 P7 on screen: path-strip hop probabilities, "Run to end" and Simulate following the most likely walk. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { stationTransitions } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import type { PathModel } from './path';
import { PathStrip } from './PathStrip';
import { simulate } from './simulate/simulateModel';

const path: PathModel = {
    stops: [{ id: 'api', name: 'Api' }, { id: 'svc', name: 'Service' }, { id: 'db', name: 'Db' }],
    hops: [{ kind: 'references', count: 3 }, { kind: 'references', count: 2 }],
};
const stations = new Map([['api', { name: 'Api' }], ['svc', { name: 'Service' }], ['db', { name: 'Db' }], ['cache', { name: 'Cache' }]]);
const weights = [
    { from: 'api', to: 'svc', weight: 3 }, { from: 'api', to: 'cache', weight: 1 },
    { from: 'svc', to: 'db', weight: 2 },
];
const referenced = stationTransitions({ weights });
const traced = stationTransitions({ sequences: [['api', 'svc']], weights });

const strip = (transitions: Parameters<typeof PathStrip>[0]['transitions'], step = 0) =>
    render(<PathStrip path={path} step={step} labels={L} onStep={vi.fn()} transitions={transitions} />);
const hopTexts = (c: HTMLElement) => [...c.querySelectorAll('[data-hop-p]')].map((e) => e.textContent);

describe('PathStrip hop probabilities', () => {
    it('shows P(next) beside the count: a share of references without an interval', () => {
        const { container } = strip(referenced);
        expect(hopTexts(container)).toEqual([' · next 3 of 4 references', ' · next 2 of 2 references']);
    });

    it('a traced hop is ≈ with its interval under 10 runs, and its 1-of-1 is not 100%', () => {
        const [first] = hopTexts(strip(traced).container);
        expect(first).toMatch(/next ≈ \d+% \(\d+–\d+\) · n = 1/);
        expect(first).not.toContain('100%');
    });

    it('no transition table: no probability and no walk, never a guess', () => {
        const { container } = strip(null);
        expect(hopTexts(container)).toEqual([]);
        fireEvent.click(screen.getByRole('button', { name: L.surface.path.runToEnd }));
        expect(screen.queryByTestId('kg-walk')).toBeNull();
        expect(screen.queryByTestId('kg-walk-none')).toBeNull();
    });

    it('"Run to end" shows the most likely walk from the stop it ran from, each hop with its probability', () => {
        strip(referenced);
        fireEvent.click(screen.getByRole('button', { name: L.surface.path.runToEnd }));
        const walk = screen.getByRole('list', { name: 'Most likely from Api' });
        expect([...walk.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['→ Service · 3 of 4 references', '→ Db · 2 of 2 references']);
    });
});

describe('simulate follows the most likely walk', () => {
    const steps = (transitions: Parameters<typeof simulate>[0]['transitions']) =>
        simulate({ path, recorded: null, edits: {}, stubs: new Set(), labels: L, transitions, stations });

    it('each step carries mostLikelyWalk from its stop, and each call line its hop probability', () => {
        const s = steps(referenced);
        expect(s[0]!.walk!.map((h) => [h.name, h.rate])).toEqual([['Service', '3 of 4 references'], ['Db', '2 of 2 references']]);
        expect(s[1]!.walk!.map((h) => h.to)).toEqual(['db']);
        expect(s[2]!.walk).toEqual([]);
        expect(s[0]!.lines[1]!.note).toBe('references · 3 · next 3 of 4 references');
    });

    it('without a table there is no walk and no probability', () => {
        const s = steps(null);
        expect(s[0]!.walk).toBeNull();
        expect(s[0]!.lines[1]!.note).not.toContain('next');
    });
});
