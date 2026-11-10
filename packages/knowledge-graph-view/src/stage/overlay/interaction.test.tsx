import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { buildStageModel } from '../../compute/tasks/stageModel';
import { buildSlotIncident } from '../../compute/tasks/stageIncident';
import { PLACEMENTS } from '../../compute/tasks/placement';
import { surfaceFixture } from '../../testing';
import { proxyItems, MAX_PROXIES } from '../a11y/proxyItems';
import { StageBus, StageBusContext, stageBus } from '../anchor/stageBus';
import { useSlotAnchor } from '../anchor/useSlotAnchor';
import { frameOf, frameProjector, PickIndex, type Projector } from '../pick';
import { createNoopStage } from '../renderer';
import { Stage } from '../Stage';
import { focusProxy, StageProxies } from '../StageProxies';
import type { A11yItem, Placement } from '../types';
import { SlotIncident, INCIDENT_SHOWN } from './incident';
import { overlayLinks } from './OverlayLayer';

const graph = surfaceFixture();
const model = buildStageModel(graph, []);
const t = PLACEMENTS.map(graph, model, { graph: 1, generation: model.marks.generation, camera: 'map', drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0 });
while (!t.step());
const map = t.result();
const keys = model.marks.keys;

/** A bus settled over `p` under the fitted frame of a `w` × `h` box (or `projector`). */
function settledBus(p: Placement = map, projector: Projector = frameProjector(frameOf(p, 800, 500))): StageBus {
    const bus = new StageBus();
    bus.setPlacement(p, keys);
    bus.frame(projector);
    bus.settle();
    return bus;
}

describe('a11y proxies (PRD 43 B5)', () => {
    it('keeps at most 200 on-screen stops at their marks\' projected centres, plus the way on and the kept slots', () => {
        const n = 600;
        const at = (s: number): [number, number] | null => (s % 10 === 9 ? null : [(s % 30) * 30 + 10, Math.floor(s / 30) * 30 + 10]);
        const index = { screenOf: at, onScreen: (s: number) => { const p = at(s); return !!p && p[1] <= 400; } };
        const a11y: A11yItem[] = Array.from({ length: n }, (_, slot) => ({ slot, label: `s${slot}` }));
        const items = proxyItems(a11y, index, { width: 900, height: 400 }, [590]);
        // 378 stops are on screen: the first 200 in reading order, each at its mark's centre…
        const visible = a11y.filter((a) => index.onScreen(a.slot));
        expect(visible.length).toBeGreaterThan(MAX_PROXIES);
        expect(items.slice(0, MAX_PROXIES).map((i) => i.slot)).toEqual(visible.slice(0, MAX_PROXIES).map((a) => a.slot));
        for (const i of items.slice(0, MAX_PROXIES)) expect([i.x, i.y]).toEqual(at(i.slot));
        expect(items.every((i) => at(i.slot) !== null)).toBe(true);      // a hidden slot is never a stop
        // …then the way on (the next stop past the cap), then the kept selection, clamped into the viewport.
        expect(items).toHaveLength(MAX_PROXIES + 2);
        expect(items[MAX_PROXIES]!.slot).toBe(visible[MAX_PROXIES]!.slot);
        const kept = items[MAX_PROXIES + 1]!;
        expect(kept.slot).toBe(590);
        expect(kept.offscreen).toBe(true);
        expect(kept.y).toBeLessThanOrEqual(400 - 20);
    });

    it('roving focus: one tab stop, arrows walk the reading order, Escape and Backspace go Out', async () => {
        const onOut = vi.fn();
        render(<Stage renderer={createNoopStage()} marks={model.marks} paint={null} placement={map} colors={null} width={800} height={500} reducedMotion selected={null} onSelect={() => {}} depthLabel="Depth" description="The map" onOut={onOut} />);
        await screen.findAllByRole('button', { name: map.a11y[0]!.label });
        const proxies = [...document.querySelectorAll<HTMLButtonElement>('[data-stage-proxies] button')];
        expect(proxies.length).toBe(map.a11y.length);
        expect(proxies.filter((b) => b.tabIndex === 0)).toHaveLength(1);
        act(() => proxies[0]!.focus());
        fireEvent.keyDown(proxies[0]!, { key: 'ArrowRight' });
        expect(document.activeElement).toBe(proxies[1]);
        expect(proxies[1]!.getAttribute('tabindex')).toBe('0');
        expect(proxies[0]!.getAttribute('tabindex')).toBe('-1');
        fireEvent.keyDown(proxies[1]!, { key: 'Escape' });
        fireEvent.keyDown(proxies[1]!, { key: 'Backspace' });
        expect(onOut).toHaveBeenCalledTimes(2);
        expect(screen.getByRole('group', { description: 'The map' })).toBeTruthy();
    });

    it('focus returns to a station\'s proxy (after its card closes)', () => {
        const bus = settledBus();
        const slot = map.a11y[1]!.slot;
        render(<StageProxies bus={bus} selected={null} onSelect={() => {}} />);
        act(() => { expect(focusProxy(bus, keys[slot]!)).toBe(true); });
        expect(document.activeElement?.getAttribute('data-slot')).toBe(String(slot));
        expect(focusProxy(bus, 'st:nowhere')).toBe(false);
    });

    it('focusing an off-screen stop asks the rig to pan to it', () => {
        // Zoomed in on the left of the map: the right-hand stations are off screen.
        const p = map;
        const slots = p.a11y.map((a) => a.slot);
        const xs = slots.map((s) => p.position[s * 3]!);
        const right = slots[xs.indexOf(Math.max(...xs))]!;
        const bus = settledBus(p, frameProjector({ zoom: 4, cx: Math.min(...xs), cz: p.position[slots[0]! * 3 + 2]!, width: 300, height: 300 }));
        const reveal = vi.fn();
        bus.onReveal(reveal);
        render(<StageProxies bus={bus} selected={keys[right]!} onSelect={() => {}} />);
        const proxy = document.querySelector<HTMLButtonElement>(`[data-slot="${right}"]`)!;
        expect(proxy.dataset.offscreen).toBe('true');
        act(() => proxy.focus());
        expect(reveal).toHaveBeenCalledWith(right);
    });
});

describe('picking on the stage bus (PRD 43 B5)', () => {
    it('hover and select read the settled grid; picking is OFF during a tween', () => {
        const bus = settledBus();
        const slot = map.a11y[0]!.slot;
        const [x, y] = bus.pickIndex!.screenOf(slot)!;
        expect(bus.pick(x + 2, y + 1)).toEqual({ kind: 'mark', slot });
        bus.setTweening(true);
        expect(bus.pickIndex).toBeNull();
        expect(bus.pick(x, y)).toBeNull();
        bus.setTweening(false);                                  // landing settles at once
        expect(bus.pick(x, y)).toEqual({ kind: 'mark', slot });
    });

    it('a click on the stage selects the mark under it; during a tween it does nothing', async () => {
        const onSelect = vi.fn();
        const renderer = createNoopStage();
        const props = { renderer, marks: model.marks, paint: null, colors: null, width: 800, height: 500, reducedMotion: false, selected: null, onSelect, depthLabel: 'Depth' };
        const view = render(<Stage {...props} placement={map} />);
        await screen.findAllByRole('button', { name: map.a11y[0]!.label });
        const box = document.querySelector<HTMLElement>('[data-stage]')!;
        const slot = map.a11y[0]!.slot;
        const proxy = document.querySelector<HTMLElement>(`[data-slot="${slot}"]`)!;
        const x = parseFloat(proxy.style.left) + 20, y = parseFloat(proxy.style.top) + 20;
        fireEvent.pointerDown(box, { clientX: x, clientY: y });
        fireEvent.pointerUp(box, { clientX: x, clientY: y });
        expect(onSelect).toHaveBeenCalledWith(keys[slot]);
        // A drag is the rig's, not a click.
        fireEvent.pointerDown(box, { clientX: x, clientY: y });
        fireEvent.pointerUp(box, { clientX: x + 30, clientY: y });
        expect(onSelect).toHaveBeenCalledTimes(1);
        // A new placement tweens (motion allowed): the same click picks nothing.
        view.rerender(<Stage {...props} placement={{ ...map }} />);
        fireEvent.pointerDown(box, { clientX: x, clientY: y });
        fireEvent.pointerUp(box, { clientX: x, clientY: y });
        expect(onSelect).toHaveBeenCalledTimes(1);
    });
});

describe('the overlay (B7 Selection: overlay + incident slice on the main thread)', () => {
    it('a selection hands the renderer the slot, its best incident neighbours (sliced, capped) and the path', async () => {
        const renderer = createNoopStage();
        const incident = new SlotIncident(buildSlotIncident(graph, model));
        const station = map.a11y[0]!.slot;
        const { rerender } = render(<Stage renderer={renderer} marks={model.marks} paint={null} placement={map} colors={null} width={800} height={500} reducedMotion selected={null} onSelect={() => {}} depthLabel="Depth" />);
        const bus = stageBus(renderer);
        const path = map.a11y.slice(0, 3).map((a) => keys[a.slot]!);
        act(() => bus.setOptions({ incident, path }));
        rerender(<Stage renderer={renderer} marks={model.marks} paint={null} placement={map} colors={null} width={800} height={500} reducedMotion selected={keys[station]!} onSelect={() => {}} depthLabel="Depth" />);
        expect(renderer.overlay.selected).toBe(station);
        expect(Array.from(renderer.overlay.incident)).toEqual([...incident.of(station, INCIDENT_SHOWN)]);
        expect(Array.from(renderer.overlay.path)).toEqual(map.a11y.slice(0, 3).map((a) => a.slot));
        // The overlay's lines: the path between its shown stops, one segment per neighbour placed elsewhere.
        const lines = overlayLinks(map, renderer.overlay)!;
        expect(lines.widthUnit).toBe('px');
        expect(lines.group.length).toBeGreaterThan(0);
    });
});

describe('useSlotAnchor (B3 Cards: the card follows the frame loop with no React commit)', () => {
    it('rewrites the element\'s transform on every camera frame without re-rendering', () => {
        const bus = settledBus();
        const slot = map.a11y[0]!.slot;
        let renders = 0;
        function Card() {
            renders++;
            const ref = useRef<HTMLDivElement>(null);
            const { missing } = useSlotAnchor(keys[slot]!, ref);
            return <div ref={ref} data-card data-missing={missing} />;
        }
        render(<StageBusContext.Provider value={bus}><Card /></StageBusContext.Provider>);
        const el = document.querySelector<HTMLElement>('[data-card]')!;
        const before = renders;
        const first = el.style.transform;
        expect(first).toMatch(/translate3d/);
        const f = frameOf(map, 800, 500);
        act(() => { bus.frame(frameProjector({ ...f, cx: f.cx - 40 })); });
        const panned = el.style.transform;
        act(() => { bus.frame(frameProjector({ ...f, cx: f.cx - 80, zoom: f.zoom * 1.2 })); });
        expect(panned).not.toBe(first);
        expect(el.style.transform).not.toBe(panned);
        expect(renders).toBe(before);
        expect(el.dataset.missing).toBe('false');
    });

    it('reports the slot missing at a settle once it is hidden (the caller closes the card)', () => {
        const bus = settledBus();
        const slot = map.a11y[0]!.slot;
        function Card() {
            const ref = useRef<HTMLDivElement>(null);
            const { missing } = useSlotAnchor(keys[slot]!, ref);
            return <div ref={ref} data-card data-missing={missing} />;
        }
        render(<StageBusContext.Provider value={bus}><Card /></StageBusContext.Provider>);
        const hidden = { ...map, scale: map.scale.slice() };
        hidden.scale[slot] = 0;
        act(() => { bus.setPlacement(hidden, keys); bus.settle(); });
        expect(document.querySelector<HTMLElement>('[data-card]')!.dataset.missing).toBe('true');
    });
});

describe('PickIndex is what the bus settles (one projection pass per settle)', () => {
    it('rebuilds once per settle, not per query', () => {
        const bus = settledBus();
        const index = bus.pickIndex!;
        bus.pick(10, 10); bus.pick(20, 20);
        expect(bus.pickIndex).toBe(index);
        expect(index).toBeInstanceOf(PickIndex);
    });
});
