import { describe, expect, it } from 'vitest';
import { CARD_HEIGHT, CARD_WIDTH, placeCard } from './cardPlacement';

const box = { width: 800, height: 600 };
const station = (left: number, top: number) => ({ left, top, width: 40, height: 40 });

describe('placeCard', () => {
    it('sits to the right of the station, centred on it', () => {
        expect(placeCard(station(100, 300), box)).toEqual({ left: 150, top: 300 + 20 - CARD_HEIGHT / 2 });
    });

    it('flips to the left of the station at the right edge', () => {
        expect(placeCard(station(700, 100), box).left).toBe(700 - 10 - CARD_WIDTH);
    });

    it('clamps to the left edge when it fits on neither side', () => {
        expect(placeCard(station(20, 100), { width: 200, height: 600 }).left).toBe(0);
    });

    it('clamps to the bottom and the top of the container', () => {
        expect(placeCard(station(100, 590), box).top).toBe(600 - CARD_HEIGHT);
        expect(placeCard(station(100, 0), box).top).toBe(0);
    });

    it('uses the measured size of the card', () => {
        expect(placeCard(station(100, 590), box, { width: 300, height: 100 }).top).toBe(500);
        expect(placeCard(station(560, 100), box, { width: 300, height: 100 }).left).toBe(560 - 10 - 300);
    });

    it('goes to the other side when the first would cover what must stay visible', () => {
        // Satellites to the right of the station: the card flips left.
        const arc = { left: 360, top: 80, width: 120, height: 120 };
        expect(placeCard(station(300, 100), box, undefined, [arc]).left).toBe(300 - 10 - CARD_WIDTH);
        expect(placeCard(station(300, 100), box).left).toBe(350);
        // Covered on both sides: it still stays on the map, on the first side that fits.
        const both = { left: 0, top: 0, width: 800, height: 600 };
        expect(placeCard(station(300, 100), box, undefined, [both]).left).toBe(350);
    });
});
