// @vitest-environment jsdom
/** The Tower variant is the transit map with towers and pipes: the same stations and lines, painted far to near, pins above the tops. */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import { CAMERAS } from '../cameras';
import { buildLines } from '../lines';
import { makeOverlay, PRESETS } from '../overlays';
import { buildStations } from '../stations';
import { TransitMap, type TransitMapProps } from '../TransitMap';
import { withDocs } from './testFixtures';

const graph = withDocs();
const model = buildStations(graph);
const lines = buildLines(graph, model);
const overlay = makeOverlay(PRESETS.risk, model.stations);

function draw(variant: 'map' | 'tower', over: Partial<TransitMapProps> = {}) {
    const props: TransitMapProps = {
        stations: model, lines, overlay, labels: L, lit: null, lineId: lines.lines[0]!.id, selectedStation: null, pins: [], reducedMotion: true,
        onSelectStation: vi.fn(), onSelectLine: vi.fn(), label: 'map', graph, variant, ...over,
    };
    return render(<TransitMap {...props} />).container;
}
const stationIds = (c: HTMLElement) => [...c.querySelectorAll('[data-station]')].map((el) => el.getAttribute('data-station')!).sort();
const lineIds = (c: HTMLElement) => [...c.querySelectorAll('[data-line]')].map((el) => `${el.getAttribute('data-line')}`);

describe('the Tower camera', () => {
    it('is listed beside the WebGL 3D camera, and both render', () => {
        expect(CAMERAS.map((c) => c.id)).toEqual(expect.arrayContaining(['tower', '3d']));
        expect(CAMERAS.findIndex((c) => c.id === 'tower')).toBeLessThan(CAMERAS.findIndex((c) => c.id === '3d'));
        expect(L.viewTower).not.toBe(L.view3d);
        expect(draw('tower').querySelector('[data-tower]')).not.toBeNull();
    });

    it('draws the same stations and lines as the map, as towers and pipes', () => {
        const flat = draw('map'), tower = draw('tower');
        expect(stationIds(tower)).toEqual(stationIds(flat));
        expect(lineIds(tower)).toEqual(lineIds(flat));
        expect(flat.querySelector('[data-tower]')).toBeNull();
        expect(tower.querySelectorAll('[data-tower]')).toHaveLength(stationIds(tower).length);
        expect(tower.querySelectorAll('[data-pipe]').length).toBe(lineIds(tower).length);
        expect(flat.querySelector('[data-pipe]')).toBeNull();
    });

    it('paints the farther (higher) towers first', () => {
        const feet = [...draw('tower').querySelectorAll('[data-tower-part="shadow"]')].map((el) => Number(el.getAttribute('cy')));
        expect(feet.length).toBeGreaterThan(1);
        expect(feet).toEqual([...feet].sort((a, b) => a - b));
    });

    it('puts a pin above its tower top', () => {
        const target = model.stations[0]!;
        const c = draw('tower', { pins: [{ stationId: target.id, count: 2 }] });
        const pin = c.querySelector(`[data-pin="${target.id}"] circle`)!;
        const tower = [...c.querySelectorAll('[data-station]')].find((el) => el.getAttribute('data-station') === target.id)!;
        const top = Number(tower.querySelector('[data-tower-part="top"]')!.getAttribute('cy'));
        expect(Number(pin.getAttribute('cy'))).toBeLessThan(top);
    });
});
