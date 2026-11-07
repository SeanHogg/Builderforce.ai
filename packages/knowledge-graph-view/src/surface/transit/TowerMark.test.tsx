// @vitest-environment jsdom
/** The Tower camera's station mark: height from the size level, fill from coverage, the shell, the selected stroke, depth order, pins. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { StationStyle } from '../overlays';
import type { PlacedLabel } from './labelPlacement';
import { byDepth, TOWER_WIDTH, TowerMark, towerBox, towerGeometry, towerHeight, towerPinY } from './TowerMark';

const style: StationStyle = { tone: 'sev3', size: 5 + 3 * 2, ring: null, pulse: false, outline: false };
const label: PlacedLabel = { id: 's', side: 'bottom', anchor: 'middle', x: 50, y: 80, noteY: 92, text: 'api', note: 'no tests', box: { x: 20, y: 70, w: 60, h: 26 } };
const at = { x: 50, y: 100 };
const mark = (over: Partial<Parameters<typeof TowerMark>[0]> = {}) => render(
    <svg>
        <TowerMark id="s" at={at} style={style} selected={false} dim={false} doc={false} interchange={null} aria="api" label={label} accentNote={false} reducedMotion onActivate={vi.fn()} {...over} />
    </svg>,
);
const part = (c: HTMLElement, name: string) => c.querySelector(`[data-tower-part="${name}"]`);

describe('tower geometry', () => {
    it('stands 14 + 16 per level tall, from level 1 to 5, and a middling tower when the channel has no reading', () => {
        expect(towerHeight(5 + 1 * 2)).toBe(30);
        expect(towerHeight(5 + 3 * 2)).toBe(62);
        expect(towerHeight(5 + 5 * 2)).toBe(94);
        expect(towerHeight(8)).toBe(46);
    });

    it('reads the station\'s complexity level for a neutral tower, and ignores it once the size channel has a reading', () => {
        expect(towerHeight(8, 5)).toBe(94);
        expect(towerHeight(8, 1)).toBe(30);
        expect(towerHeight(5 + 1 * 2, 5)).toBe(30);
        expect(towerGeometry(at, { ...style, size: 8 }, 4).height).toBe(78);
        expect(towerPinY(at, { ...style, size: 8 }, 4)).toBe(towerGeometry(at, { ...style, size: 8 }, 4).top - 12);
    });

    it('takes the space from the top ellipse to the shadow\'s foot, as wide as the shadow', () => {
        expect(towerBox(at, style)).toEqual({ x: 38, y: 106 - 62 - 4, w: 24, h: 62 + 4 + 5 });
        const tall = towerBox(at, { ...style, size: 5 + 5 * 2 });
        expect(tall.h).toBeGreaterThan(towerBox(at, style).h);
        expect(tall.y + tall.h).toBe(towerBox(at, style).y + towerBox(at, style).h);
    });

    it('puts the foot 6 below the station, the top a height above it, and the fill height at the ring fraction', () => {
        const g = towerGeometry(at, { ...style, ring: { frac: 0.5, tone: 'agrees' } });
        expect(g.base).toEqual({ x: 50, y: 106 });
        expect(g.top).toBe(106 - 62);
        expect(g.fillHeight).toBe(31);
        expect(g.fillTop).toBe(106 - 31);
        expect(g.shell).toBe(false);
        expect(towerGeometry(at, style).fillHeight).toBe(0);
    });

    it('is a shell only for MEASURED zero coverage: no data is no shell, and a zero that is not coverage (or merely red) is none either', () => {
        expect(towerGeometry(at, { ...style, ring: { frac: 0, tone: 'violation', zeroCoverage: true } }).shell).toBe(true);
        expect(towerGeometry(at, { ...style, ring: null }).shell).toBe(false);
        expect(towerGeometry(at, { ...style, ring: { frac: 0, tone: 'accent' } }).shell).toBe(false);
        // The tone no longer decides it: a red zero that is not flagged as coverage is a plain body.
        expect(towerGeometry(at, { ...style, ring: { frac: 0, tone: 'violation' } }).shell).toBe(false);
        expect(towerGeometry(at, { ...style, ring: { frac: 0.4, tone: 'cycle' } }).shell).toBe(false);
    });

    it('places a pin 12 above the tower top', () => {
        expect(towerPinY(at, style)).toBe(towerGeometry(at, style).top - 12);
    });

    it('sorts nearer (lower) stations after farther ones', () => {
        const pos = new Map([['a', { x: 0, y: 300 }], ['b', { x: 0, y: 100 }], ['c', { x: 0, y: 200 }]]);
        expect(byDepth([{ id: 'a' }, { id: 'b' }, { id: 'c' }], pos).map((s) => s.id)).toEqual(['b', 'c', 'a']);
    });
});

describe('TowerMark', () => {
    it('draws a 18px body of the computed height, a side face and a top ellipse, and activates like a button', () => {
        const onActivate = vi.fn();
        const { container, getByRole } = mark({ onActivate });
        const body = part(container, 'body')!;
        expect(body.getAttribute('width')).toBe('18');
        expect(body.getAttribute('height')).toBe('62');
        expect(part(container, 'side')!.getAttribute('width')).toBe('6');
        expect(part(container, 'top')).not.toBeNull();
        expect(part(container, 'shadow')).not.toBeNull();
        expect(container.textContent).toContain('api');
        fireEvent.click(getByRole('button', { name: 'api' }));
        fireEvent.keyDown(getByRole('button', { name: 'api' }), { key: 'Enter' });
        expect(onActivate).toHaveBeenCalledTimes(2);
    });

    it('draws the coverage tint and its 2px fill line at the fraction of the height', () => {
        const { container } = mark({ style: { ...style, ring: { frac: 0.5, tone: 'agrees' } } });
        expect(part(container, 'tint')!.getAttribute('height')).toBe('31');
        expect(part(container, 'fill-line')!.getAttribute('height')).toBe('2');
        expect(part(mark().container, 'tint')).toBeNull();
    });

    it('draws a dashed shell, not a body, when coverage is zero', () => {
        const { container } = mark({ style: { ...style, ring: { frac: 0, tone: 'violation', zeroCoverage: true } } });
        expect(part(container, 'body')).toBeNull();
        expect(part(container, 'shell')!.getAttribute('stroke-dasharray')).toBe('3 3');
        expect(part(container, 'tint')).toBeNull();
    });

    it('draws neither a shell nor a fill when there is no coverage data at all (the legend says why)', () => {
        const { container } = mark({ style: { ...style, ring: null } });
        expect(part(container, 'shell')).toBeNull();
        expect(part(container, 'body')).not.toBeNull();
        expect(part(container, 'tint')).toBeNull();
    });

    it('paints its side face from the tower-side token and sizes the top ellipse from the tower constants', () => {
        const { container } = mark();
        expect(part(container, 'side')!.getAttribute('fill')).toContain('--kg-tower-side');
        const top = part(container, 'top')!;
        expect(top.getAttribute('rx')).toBe(String(TOWER_WIDTH / 2));
        expect(top.getAttribute('ry')).toBe('4');
    });

    it('strokes the top in the accent when selected, and drops to .3 when off the answer', () => {
        expect(part(mark({ selected: true }).container, 'top')!.getAttribute('stroke')).toContain('accent');
        expect(part(mark().container, 'top')!.getAttribute('stroke')).toBeNull();
        expect(part(mark({ dim: true }).container, 'body')!.getAttribute('opacity')).toBe('0.3');
    });

    it('centres its label under the base, the note 13px below it', () => {
        const texts = [...mark().container.querySelectorAll('text')];
        expect(texts[0]!.getAttribute('y')).toBe('122');
        expect(texts[0]!.getAttribute('text-anchor')).toBe('middle');
        expect(texts[1]!.getAttribute('y')).toBe('135');
    });
});
