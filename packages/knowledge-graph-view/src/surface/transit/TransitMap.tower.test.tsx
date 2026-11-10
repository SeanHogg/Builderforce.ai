// @vitest-environment jsdom
/** The towers look is the transit map with towers and pipes: the same stations and lines, painted far to near, pins above the tops. */
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

describe('the Map\'s towers look', () => {
    it('is a look of the Map camera, not a camera of its own, beside the WebGL 3D camera', () => {
        expect(CAMERAS.map((c) => c.id)).toEqual(expect.arrayContaining(['transit', '3d']));
        expect(CAMERAS.map((c) => c.id)).not.toContain('tower');
        expect(L.surface.map.look.towers).not.toBe(L.view3d);
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

    it('lights an anti-pattern highlight: the offender in the violation tone, the partner in the partner tone, every other tower dimmed', () => {
        const [offender, partner, ...rest] = model.stations;
        expect(rest.length).toBeGreaterThan(0);
        const c = draw('tower', { roles: new Map([[offender!.id, 'offender'], [partner!.id, 'partner']]) });
        const paint = (el: Element) => `${el.getAttribute('fill')} ${el.getAttribute('stroke')}`;
        const body = (id: string) => [...c.querySelectorAll('[data-station]')].find((el) => el.getAttribute('data-station') === id)!.querySelector('[data-tower-part="body"], [data-tower-part="shell"]')!;
        expect(paint(body(offender!.id))).toContain('--kg-violation');
        expect(body(offender!.id).getAttribute('opacity')).toBe('1');
        expect(paint(body(partner!.id))).toContain('--kg-partner');
        expect(body(rest[0]!.id).getAttribute('opacity')).toBe('0.3');
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
