// @vitest-environment jsdom
/** The transit map with the station card, drill, documents and named termini wired in. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../../labels';
import { counted } from '../plural';
import { buildLines } from '../lines';
import { makeOverlay, PRESETS } from '../overlays';
import { buildStations } from '../stations';
import { TransitMap, type TransitMapProps } from '../TransitMap';
import { TYPE_SHAPE } from '../../shapes';
import { withDocs } from './testFixtures';

const graph = withDocs();
const model = buildStations(graph);
const lines = buildLines(graph, model);
const overlay = makeOverlay(PRESETS.risk, model.stations);
const idOf = (name: string) => model.stations.find((s) => s.name === name)!.id;
const aria = (name: string, files: number, layer: string) => fillTemplate(L.surface.stationAria, { name, layer, files: counted(L, 'file', files) });

function map(over: Partial<TransitMapProps> = {}) {
    const props: TransitMapProps = {
        stations: model, lines, overlay, labels: L, lit: null, lineId: lines.lines[0]!.id, selectedStation: null, pins: [], reducedMotion: true,
        onSelectStation: vi.fn(), onSelectLine: vi.fn(), label: 'map', graph, ...over,
    };
    return { props, ...render(<TransitMap {...props} />) };
}

describe('the station card on the map', () => {
    it('opens on a click, with the station\'s stats and actions, and closes on Escape', () => {
        const onEnter = vi.fn(), onQuestion = vi.fn(), onOpenPanel = vi.fn();
        const { props } = map({ canEnter: () => ({ can: true, level: 'package' }), onEnter, onQuestion, onOpenPanel });
        fireEvent.click(screen.getByRole('button', { name: aria('API', 2, L.surface.layers.presentation) }));
        expect(props.onSelectStation).toHaveBeenCalledWith(idOf('API'));
        const dialog = screen.getByRole('dialog', { name: 'API' });
        expect(dialog).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: L.surface.map.card.whoCalls }));
        expect(onQuestion).toHaveBeenCalledWith('callers');
        expect(screen.queryByRole('dialog')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: aria('API', 2, L.surface.layers.presentation) }));
        fireEvent.click(screen.getByRole('button', { name: L.surface.map.card.apiContract }));
        expect(onOpenPanel).toHaveBeenCalledWith('api');

        fireEvent.click(screen.getByRole('button', { name: aria('API', 2, L.surface.layers.presentation) }));
        fireEvent.click(screen.getByRole('button', { name: L.surface.map.card.goInside }));
        expect(onEnter).toHaveBeenCalledWith(idOf('API'));

        fireEvent.click(screen.getByRole('button', { name: aria('API', 2, L.surface.layers.presentation) }));
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    const apiName = () => aria('API', 2, L.surface.layers.presentation);
    const unfold = () => {
        fireEvent.click(screen.getByRole('button', { name: apiName() }));
        fireEvent.click(screen.getByRole('button', { name: fillTemplate(L.surface.map.card.unfold, { count: 2 }) }));
    };

    it('unfolds a station into satellites and folds it again', () => {
        const { container } = map();
        unfold();
        expect(container.querySelectorAll('[data-satellite]')).toHaveLength(2);
        fireEvent.click(screen.getByRole('button', { name: L.surface.map.card.fold }));
        expect(container.querySelectorAll('[data-satellite]')).toHaveLength(0);
    });

    it('keeps the satellites when the card closes, and folds them on Escape, or on a click on the station again', () => {
        const { container } = map();
        unfold();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(container.querySelectorAll('[data-satellite]')).toHaveLength(2);
        // No card is open now, so the next Escape is the unfold's.
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(container.querySelectorAll('[data-satellite]')).toHaveLength(0);

        unfold();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(container.querySelectorAll('[data-satellite]')).toHaveLength(2);
        fireEvent.click(screen.getByRole('button', { name: apiName() }));
        expect(container.querySelectorAll('[data-satellite]')).toHaveLength(0);
    });

    it('draws the satellites as focusable stations whose selection opens their station\'s card', () => {
        const { container } = map();
        unfold();
        fireEvent.keyDown(document, { key: 'Escape' });
        const satellite = container.querySelector('[data-satellite]')!;
        expect(satellite.getAttribute('role')).toBe('button');
        expect(satellite.getAttribute('tabindex')).toBe('0');
        expect(satellite.getAttribute('aria-label')).toMatch(/inside API$/);
        fireEvent.keyDown(satellite, { key: 'Enter' });
        expect(screen.getByRole('dialog', { name: 'API' })).toBeTruthy();
        // The satellites stay while their station's card is open.
        expect(container.querySelectorAll('[data-satellite]')).toHaveLength(2);
    });

    it('hands focus back to the station after an action, not only after a close', () => {
        const { container } = map({ onQuestion: vi.fn(), onOpenPanel: vi.fn() });
        const station = () => container.querySelector(`[data-station="${idOf('API')}"]`) as SVGElement;
        fireEvent.click(screen.getByRole('button', { name: apiName() }));
        fireEvent.click(screen.getByRole('button', { name: L.surface.map.card.whoCalls }));
        expect(document.activeElement).toBe(station());
        fireEvent.click(screen.getByRole('button', { name: apiName() }));
        fireEvent.click(screen.getByRole('button', { name: L.surface.map.card.patterns }));
        expect(document.activeElement).toBe(station());
    });

    it('closes the card when its station is no longer on the map', () => {
        const { props, rerender } = map();
        fireEvent.click(screen.getByRole('button', { name: apiName() }));
        expect(screen.getByRole('dialog')).toBeTruthy();
        const gone = { ...model, stations: model.stations.filter((s) => s.id !== idOf('API')), byId: new Map([...model.byId].filter(([k]) => k !== idOf('API'))) };
        rerender(<TransitMap {...props} stations={gone} lines={{ lines: [], interchanges: new Map(), omitted: 0 }} />);
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});

describe('the map\'s drawing', () => {
    it('draws a document station as the doc-type silhouette and a dashed describes link, strong under Claims', () => {
        const { container, rerender, props } = map();
        const doc = container.querySelector(`[data-station="${idOf('docs')}"]`)!;
        expect(doc.hasAttribute('data-doc')).toBe(true);
        // A station draws its members' dominant mark type (shapes.ts): documents are the doc tile, code is not.
        expect(doc.querySelector(`[data-shape="${TYPE_SHAPE.doc}"]`)).not.toBeNull();
        expect(container.querySelector(`[data-station="${idOf('API')}"] [data-shape="${TYPE_SHAPE.doc}"]`)).toBeNull();
        const link = container.querySelector('[data-describes-link]')!;
        expect(link.getAttribute('opacity')).toBe('0.4');
        rerender(<TransitMap {...props} question="claims" />);
        expect(container.querySelector('[data-describes-link]')!.getAttribute('opacity')).toBe('1');
        expect(screen.getByText(L.surface.map.describes)).toBeTruthy();
    });

    it('names the terminus and puts the line\'s end beside it', () => {
        const { container } = map();
        const end = container.querySelector('[data-terminus="data"]')!;
        expect(end.getAttribute('data-glyph')).toBe('tank');
        expect(end.querySelector('title')?.textContent).toBe(L.surface.terminus.data);
    });

    it('labels a station with its name in full and a note line, never the old 16-character cut', () => {
        const longName = { ...model.stations[0]!, id: 'long', name: 'projectKnowledgeRoutes', findingIds: [] };
        const stations = { ...model, stations: [longName], byId: new Map([['long', longName]]) };
        const { container } = map({ stations, lines: { lines: [], interchanges: new Map(), omitted: 0 } });
        expect(container.textContent).toContain('projectKnowledgeRoutes');
    });

    it('draws the level note and the band of a drilled level', () => {
        const { container } = map({ levelNote: L.surface.map.noSymbolsNote, order: ['entry', 'presentation', 'application', 'domain', 'infrastructure', 'leaves'] });
        expect(screen.getByText(L.surface.map.noSymbolsNote)).toBeTruthy();
        expect(container.querySelector('[data-band]')).not.toBeNull();
    });
});
