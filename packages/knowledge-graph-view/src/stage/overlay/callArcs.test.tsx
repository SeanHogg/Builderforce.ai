import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import { toneIndex } from '../tones';
import { StageBus, StageBusContext } from '../anchor/stageBus';
import type { Projector } from '../pick';
import type { Placement } from '../types';
import { CallBadges } from './CallBadges';
import { badgeAt, callArc, callTrackOf, markOf, nthCallTo, ARC_SAMPLES, type CallTrack } from './callArcs';
import { NO_OVERLAY, overlayLinks } from './OverlayLayer';

/** Four marks on the ground: the method at the origin, callees at x 10, 20 and 30 (z 0); slot 4 hidden. */
const placement = {
    position: new Float32Array([0, 0, 0, 10, 0, 0, 20, 0, 0, 30, 0, 0, 40, 0, 0]),
    scale: new Float32Array([1, 1, 1, 1, 0]),
} as unknown as Placement;
const keys = ['node:src:sys::a.ts#run', 'node:src:sys::a.ts#check', 'node:src:sys::b.ts', 'node:src:sys::c.ts#save', 'node:src:sys::d.ts#gone'];
const slotOf = (k: string) => keys.indexOf(k);

describe('the open method\'s calls on the stage', () => {
    it('a callee is its own mark, else its file\'s, else none', () => {
        expect(markOf('src:sys::a.ts#check', slotOf)).toBe(1);
        expect(markOf('src:sys::b.ts#charge', slotOf)).toBe(2);
        expect(markOf('src:sys::z.ts#nowhere', slotOf)).toBe(-1);
    });

    it('tracks each call in order from the method; none without a method mark or calls', () => {
        const steps = [{ line: 3, to: 'src:sys::a.ts#check', kind: 'calls' }, { line: 4, to: 'src:sys::b.ts#charge', kind: 'calls' }, { line: 5, to: 'src:sys::a.ts#check', kind: 'calls' }] as const;
        expect(callTrackOf('src:sys::a.ts#run', steps, 1, slotOf)).toEqual({ from: 0, to: [1, 2, 1], current: 1 });
        expect(callTrackOf('src:sys::z.ts#nowhere', steps, 0, slotOf)).toBeNull();
        expect(callTrackOf(null, steps, 0, slotOf)).toBeNull();
        expect(callTrackOf('src:sys::a.ts#run', [], -1, slotOf)).toBeNull();
    });

    it('counts the earlier calls to the same callee, so its next arc bows further and its number sits nearer the method', () => {
        expect([0, 1, 2, 3].map((i) => nthCallTo([1, 2, 1, 1], i))).toEqual([0, 0, 1, 2]);
        const a = { x: 0, y: 0 }, b = { x: 10, y: 0 };
        const first = callArc(a, b, 0), second = callArc(a, b, 1);
        expect(first).toHaveLength(ARC_SAMPLES + 1);
        expect(first[0]).toEqual(a);
        expect(first[ARC_SAMPLES]).toEqual(b);
        const mid = (pts: { y: number }[]) => Math.abs(pts[ARC_SAMPLES / 2]!.y);
        expect(mid(second)).toBeGreaterThan(mid(first));
        expect(badgeAt(a, b, 1).x).toBeLessThan(badgeAt(a, b, 0).x);
    });

    it('draws one arc per call to a shown callee, the current one last, wider and amber', () => {
        const calls: CallTrack = { from: 0, to: [1, 2, 4, 3], current: 1 };
        const lines = overlayLinks(placement, { ...NO_OVERLAY, calls })!;
        // Slot 4 is hidden: three arcs of ARC_SAMPLES segments each.
        expect(lines.tone).toHaveLength(3 * ARC_SAMPLES);
        const last = lines.tone.length - 1;
        expect(lines.tone[last]).toBe(toneIndex('partner'));
        expect(lines.width[last]).toBeGreaterThan(lines.width[0]!);
        expect(lines.tone[0]).toBe(toneIndex('accent'));
        expect(overlayLinks(placement, { ...NO_OVERLAY, calls: { ...calls, from: 4 } })).toBeNull();
    });
});

describe('the reading line and the calls on the bus', () => {
    it('tells its listeners once per change', () => {
        const bus = new StageBus();
        const reading = vi.fn(), calls = vi.fn();
        bus.onReading(reading);
        bus.onCalls(calls);
        bus.setReading(3);
        bus.setReading(3);
        const track = { from: 0, to: [1], current: 0 };
        bus.setCalls(track);
        bus.setCalls(track);
        bus.setCalls(null);
        expect(reading.mock.calls).toEqual([[3]]);
        expect(calls.mock.calls).toEqual([[track], [null]]);
    });
});

describe('the call numbers on the stage', () => {
    /** World x, z straight onto the screen. */
    const projector: Projector = {
        width: 800, height: 500, pxPerWorld: 1, key: 'flat',
        project(x, _y, z, out) { out[0] = x; out[1] = z; return true; },
    } as Projector;

    function setup(track: CallTrack | null) {
        const bus = new StageBus();
        bus.setPlacement(placement, keys);
        bus.frame(projector);
        bus.setCalls(track);
        const onStep = vi.fn();
        const view = render(<StageBusContext.Provider value={bus}><CallBadges labels={L} onStep={onStep} /></StageBusContext.Provider>);
        return { bus, onStep, ...view };
    }

    it('numbers every call on its arc, the current one marked, and a number goes to its call', () => {
        const { container, onStep } = setup({ from: 0, to: [1, 2, 4], current: 1 });
        const badges = [...container.querySelectorAll<HTMLElement>('[data-call-badge]')];
        expect(badges.map((b) => b.textContent)).toEqual(['1', '2', '3']);
        expect(badges[1]!.hasAttribute('data-current')).toBe(true);
        expect(badges[1]!.getAttribute('aria-label')).toBe('Call 2 of 3');
        // On its arc (the badge point projected, centred), and hidden where the callee is not drawn.
        const at = badgeAt({ x: 0, y: 0 }, { x: 10, y: 0 }, 0);
        expect(badges[0]!.style.transform).toBe(`translate3d(${Math.round(at.x - 10)}px, ${Math.round(at.y - 10)}px, 0px)`);
        expect(badges[2]!.style.display).toBe('none');
        fireEvent.click(badges[0]!);
        expect(onStep).toHaveBeenCalledWith(0);
    });

    it('follows the bus: no open method, no numbers', () => {
        const { container, bus } = setup({ from: 0, to: [1], current: -1 });
        expect(container.querySelectorAll('[data-call-badge]')).toHaveLength(1);
        act(() => { bus.setCalls(null); });
        expect(container.querySelector('[data-call-badges]')).toBeNull();
    });
});
