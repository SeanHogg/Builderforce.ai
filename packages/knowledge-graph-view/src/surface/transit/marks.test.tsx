// @vitest-environment jsdom
/** The drawing pieces of the map, one by one: station marks, hops, line ends, the backdrop, document links and satellites. */
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import type { StationStyle } from '../overlays';
import type { HopRoute } from './corridors';
import { DescribeLinks, Satellites } from './DocLinks';
import { HopPath } from './HopPath';
import type { PlacedLabel } from './labelPlacement';
import { StationMark } from './StationMark';
import { TerminusMark } from './TerminusMark';
import { TransitBands } from './TransitBands';

const svg = (node: ReactNode) => render(<svg>{node}</svg>);

const style: StationStyle = { tone: 'sev3', size: 10, ring: null, pulse: false, outline: false };
const label: PlacedLabel = { id: 's', side: 'bottom', anchor: 'middle', x: 50, y: 80, noteY: 92, text: 'api', note: 'no tests', box: { x: 20, y: 70, w: 60, h: 26 } };
const mark = (over: Partial<Parameters<typeof StationMark>[0]> = {}) => svg(
    <StationMark
        id="s" at={{ x: 50, y: 50 }} style={style} selected={false} dim={false} doc={false} interchange={null} aria="api" label={label}
        accentNote={false} reducedMotion onActivate={vi.fn()} {...over}
    />,
);

describe('StationMark', () => {
    it('is a button with a disc, a back-disc and its name and note', () => {
        const onActivate = vi.fn();
        const { container, getByRole } = mark({ onActivate });
        expect(container.querySelectorAll('circle[r="10"]')).toHaveLength(1);
        expect(container.querySelector('circle[r="14"]')).not.toBeNull();
        expect(container.textContent).toContain('api');
        expect(container.textContent).toContain('no tests');
        fireEvent.click(getByRole('button', { name: 'api' }));
        fireEvent.keyDown(getByRole('button', { name: 'api' }), { key: ' ' });
        expect(onActivate).toHaveBeenCalledTimes(2);
    });

    it('draws a square for a document and a disc otherwise', () => {
        expect(mark({ doc: true }).container.querySelector('rect')).not.toBeNull();
        expect(mark().container.querySelector('rect')).toBeNull();
    });

    it('draws the interchange backing and its title only on an interchange', () => {
        const plain = mark();
        expect(plain.container.querySelector('title')).toBeNull();
        const inter = mark({ interchange: '2 lines' });
        expect(inter.container.querySelector('title')?.textContent).toBe('2 lines');
        expect(inter.container.querySelectorAll('circle[r="17"]')).toHaveLength(1);
    });

    it('draws the coverage arc as a dash of the ring\'s fraction, and a dotted ring when the fraction is zero', () => {
        const arc = mark({ style: { ...style, ring: { frac: 0.5, tone: 'agrees' } } }).container.querySelector('circle[stroke-dasharray]')!;
        const circ = 2 * Math.PI * 14;
        expect(Number(arc.getAttribute('stroke-dasharray')!.split(' ')[0])).toBeCloseTo(circ / 2, 3);
        expect(mark({ style: { ...style, ring: { frac: 0, tone: 'violation' } } }).container.querySelector('circle[stroke-dasharray="3 3"]')).not.toBeNull();
    });

    it('pulses only when asked, and animates only when motion is allowed', () => {
        expect(mark().container.querySelector('animate')).toBeNull();
        expect(mark({ style: { ...style, pulse: true }, reducedMotion: true }).container.querySelector('animate')).toBeNull();
        expect(mark({ style: { ...style, pulse: true }, reducedMotion: false }).container.querySelectorAll('animate')).toHaveLength(2);
    });

    it('draws the dashed outline and the selection ring when set', () => {
        expect(mark().container.querySelector('circle[stroke-dasharray="2 3"]')).toBeNull();
        expect(mark({ style: { ...style, outline: true } }).container.querySelector('circle[stroke-dasharray="2 3"]')).not.toBeNull();
        expect(mark({ selected: true }).container.querySelector('circle[r="22"]')).not.toBeNull();
        expect(mark({ selected: true }).container.querySelector('[aria-pressed="true"]')).not.toBeNull();
    });

    it('dims a station off the answer, and reads the note in the accent only when it is the answer', () => {
        expect(mark({ dim: true }).container.querySelector('[data-station]')!.getAttribute('opacity')).toBe('0.4');
        expect(mark({ dim: true }).container.textContent).not.toContain('no tests');
        expect(mark({ accentNote: true }).container.querySelectorAll('text')[1]!.getAttribute('fill')).toContain('accent');
    });
});

const route: HopRoute = { lineId: 'l', index: 0, from: 'a', to: 'b', d: 'M 0 0 L 100 0', pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }], mid: { x: 50, y: 0 } };
const hop = (over: Partial<Parameters<typeof HopPath>[0]> = {}) => svg(
    <HopPath route={route} color="var(--line)" width={7} untested={false} cycle={false} dim={false} flowing={false} cycleLabel="Cycle" onSelect={vi.fn()} {...over} />,
);

describe('HopPath', () => {
    it('draws a casing under the line, at the width given, and selects the line on click', () => {
        const onSelect = vi.fn();
        const { container } = hop({ onSelect });
        const [casing, line] = [...container.querySelectorAll('path')];
        expect(casing!.getAttribute('stroke-width')).toBe('11');
        expect(line!.getAttribute('stroke-width')).toBe('7');
        expect(line!.getAttribute('stroke')).toBe('var(--line)');
        fireEvent.click(line!);
        expect(onSelect).toHaveBeenCalled();
    });

    it('dashes an untested hop in the violation colour and marks it', () => {
        const { container } = hop({ untested: true });
        const line = container.querySelectorAll('path')[1]!;
        expect(line.getAttribute('stroke-dasharray')).toBe('9 7');
        expect(line.getAttribute('stroke')).toContain('violation');
        expect(container.querySelector('[data-untested]')).not.toBeNull();
    });

    it('marks a cycle by shape: a dotted stroke and a labelled glyph', () => {
        const { container, getByRole } = hop({ cycle: true });
        expect(container.querySelectorAll('path')[1]!.getAttribute('stroke-dasharray')).toBe('3 5');
        expect(getByRole('img', { name: 'Cycle' })).toBeTruthy();
    });

    it('flows on the selected line only, and dims to .22', () => {
        expect(hop().container.querySelector('animate')).toBeNull();
        expect(hop({ flowing: true }).container.querySelector('animate')).not.toBeNull();
        expect(hop({ dim: true }).container.querySelector('[data-line]')!.getAttribute('opacity')).toBe('0.22');
    });
});

describe('TerminusMark', () => {
    const end = (glyph: Parameters<typeof TerminusMark>[0]['glyph'], lines = [{ color: 'var(--a)', width: 6 }]) => svg(
        <TerminusMark glyph={glyph} kind="data" from={{ x: 0, y: 0 }} at={{ x: 60, y: 0 }} lines={lines} text="Postgres" dim={false} />,
    );

    it('draws each glyph as its own shape', () => {
        for (const shape of ['tank', 'globe', 'cross', 'box'] as const) {
            const { container } = end(shape);
            expect(container.querySelector(`[data-shape="${shape}"]`), shape).not.toBeNull();
            expect(container.querySelector('[data-terminus]')!.getAttribute('data-glyph')).toBe(shape);
        }
    });

    it('names the end and draws a stub per line in that line\'s colour', () => {
        const { container } = end('tank', [{ color: 'var(--a)', width: 6 }, { color: 'var(--b)', width: 6 }]);
        expect(container.textContent).toContain('Postgres');
        expect([...container.querySelectorAll('[data-stub-colour]')].map((el) => el.getAttribute('data-stub-colour'))).toEqual(['var(--a)', 'var(--b)']);
        // With two lines the glyph belongs to neither: it is in the text colour.
        expect(container.querySelector('[data-shape="tank"]')!.getAttribute('fill')).toContain('text');
        expect(end('tank').container.querySelector('[data-shape="tank"]')!.getAttribute('fill')).toBe('var(--a)');
    });
});

describe('TransitBands', () => {
    const bands = [{ layer: 'entry', y: 0, h: 120 }, { layer: 'leaves', y: 120, h: 120 }];

    it('titles each band, entry layers in their layer words and a drilled level\'s in its own', () => {
        const { container } = svg(<TransitBands bands={bands} width={400} walls={[]} labels={L} />);
        expect([...container.querySelectorAll('[data-band]')].map((b) => b.textContent)).toEqual([L.surface.layers.entry.toUpperCase(), L.surface.map.bands.leaves.toUpperCase()]);
    });

    it('draws the HTTP boundary walls, and names only the first', () => {
        const wall = (x: number) => ({ a: { x, y: 10 }, b: { x, y: 54 }, label: { x: x + 6, y: 6 } });
        const { container } = svg(<TransitBands bands={bands} width={400} walls={[wall(100), wall(200)]} labels={L} />);
        expect(container.querySelectorAll('[data-wall] line')).toHaveLength(2);
        expect(container.querySelectorAll('[data-wall] text')).toHaveLength(1);
        expect(container.textContent).toContain(L.surface.map.wall);
    });
});

describe('DescribeLinks and Satellites', () => {
    it('draws a dashed link per route, faint until Claims asks, and names them then', () => {
        const quiet = svg(<DescribeLinks routes={[route]} emphasised={false} label="describes" />).container;
        expect(quiet.querySelector('[data-describes-link]')!.getAttribute('opacity')).toBe('0.4');
        expect(quiet.textContent).not.toContain('describes');
        const loud = svg(<DescribeLinks routes={[route]} emphasised label="describes" />).container;
        expect(loud.querySelector('[data-describes-link]')!.getAttribute('opacity')).toBe('1');
        expect(loud.querySelector('[data-describes-link]')!.getAttribute('d')).toBe(route.d);
        expect(loud.textContent).toContain('describes');
    });

    it('draws real, focusable satellites with their names clipped, and selecting one calls back', () => {
        const onSelect = vi.fn();
        const items = [{ id: 'a', name: 'a-very-long-satellite-name-indeed', weight: 1 }, { id: 'b', name: 'b', weight: 1 }];
        const places = [{ x: 90, y: 80, anchor: 'start' as const }, { x: 10, y: 80, anchor: 'end' as const }];
        const { container } = svg(<Satellites center={{ x: 50, y: 50 }} items={items} places={places} color="red" parentName="API" ariaTemplate={L.surface.map.satelliteAria} onSelect={onSelect} />);
        const first = container.querySelector('[data-satellite="a"]')!;
        expect(first.getAttribute('tabindex')).toBe('0');
        expect(first.getAttribute('aria-label')).toBe('a-very-long-satellite-name-indeed, inside API');
        expect(first.textContent).toBe('a-very-long-satel…');
        fireEvent.keyDown(first, { key: 'Enter' });
        fireEvent.click(container.querySelector('[data-satellite="b"]')!);
        expect(onSelect).toHaveBeenCalledTimes(2);
    });
});
