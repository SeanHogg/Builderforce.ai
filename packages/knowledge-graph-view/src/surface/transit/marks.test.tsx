// @vitest-environment jsdom
/** The SVG station mark, piece by piece (the tower mark draws through it). */
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { StationStyle } from '../overlays';
import type { PlacedLabel } from './labelPlacement';
import { StationMark } from './StationMark';
import { SHAPE_PATHS } from '../../shapes';
import { cssVar } from '../../scene/themeColors';

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

    it('draws the plain disc without a type, a document or not (the type, not the doc flag, picks the silhouette)', () => {
        for (const doc of [true, false]) {
            const { container } = mark({ doc });
            expect(container.querySelector('rect')).toBeNull();
            expect(container.querySelector('circle[r="10"]')).not.toBeNull();
        }
    });

    it('draws the station\'s mark-type silhouette in its tone when it has one (dashed and hollow for the outside)', () => {
        const drum = mark({ shape: 'drum' }).container.querySelector('[data-shape="drum"]')!;
        expect(drum.getAttribute('d')).toBe(SHAPE_PATHS.drum);
        expect(drum.getAttribute('fill')).toBe(cssVar('sev3'));
        expect(mark({ shape: 'drum' }).container.querySelector('circle[r="10"]')).toBeNull();
        const outside = mark({ shape: 'cross' }).container.querySelector('[data-shape="cross"]')!;
        expect(outside.getAttribute('stroke-dasharray')).toBe('3 2');
        expect(outside.getAttribute('stroke')).toBe(cssVar('sev3'));
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
