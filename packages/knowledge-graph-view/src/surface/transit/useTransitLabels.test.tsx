// @vitest-environment jsdom
/** The Tower camera's label placer keeps other labels off the whole tower body, not just a circle at its foot. */
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { resolveLabels } from '../../labels';
import { surfaceFixture } from '../../testing';
import type { StationStyle } from '../overlays';
import { buildStations } from '../stations';
import { towerBox } from './TowerMark';
import { useTransitLabels } from './useTransitLabels';

const stations = buildStations(surfaceFixture()).stations;
const [tall, neighbour] = stations;
const labels = resolveLabels();
const style = (size: number): StationStyle => ({ tone: 'sev3', size, ring: null, pulse: false, outline: false });
/** The tall station's size is level 5 (94px); the neighbour sits above it, where a circle-sized obstacle leaves room for its label. */
const positions = new Map([[tall!.id, { x: 200, y: 150 }], [neighbour!.id, { x: 200, y: 60 }]]);
const styles = new Map([[tall!.id, style(5 + 5 * 2)], [neighbour!.id, style(8)]]);

const place = (tower: boolean) => renderHook(() => useTransitLabels({
    drawn: [tall!, neighbour!], positions, styles, lit: null, noteOf: undefined, selectedStation: null, labels, width: 600, height: 400, obstacles: [], tower,
})).result.current.placed.get(neighbour!.id)!;

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('useTransitLabels on the Tower camera', () => {
    it('places a neighbour\'s label under it on the map, where the tall station is only a circle', () => {
        expect(place(false).side).toBe('bottom');
    });

    it('keeps that label off the tower body when the station is a tower', () => {
        const label = place(true);
        const body = towerBox(positions.get(tall!.id)!, styles.get(tall!.id)!, tall!.cx);
        expect(label.side).not.toBe('bottom');
        expect(overlaps(label.box, body)).toBe(false);
    });
});
