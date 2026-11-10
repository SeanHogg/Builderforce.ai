/**
 * Accessibility by position (PRD 43 B5): transparent, focusable buttons over the Tab-stop marks that are on screen
 * (`a11y/proxyItems.ts`: ≤ 200, plus the way on past the viewport and the selection), rebuilt when the camera SETTLES
 * from the bus's pick grid, so magnifiers and touch screen readers find a mark where it is drawn. Each carries
 * `aria-label`, `aria-pressed` and `aria-current="step"`; the group carries the view description. Keys are the bus's
 * LIVE keys, so a drilled level's appended symbols are stops like any other.
 *
 * Keyboard: roving focus (one tab stop, arrows walk the reading order), Enter/Space select, Escape/Backspace go "Out"
 * (a drilled level), and focusing an off-screen stop asks the rig to pan to it. After a settle the bus's focus request
 * is honoured (Out: the station drilled out of; Go inside: the level's first stop), so focus never falls to the page.
 * During a tween the proxies stay in the DOM (focus stays where it is) but are `aria-hidden`: they sit over where the
 * marks were. The buttons take no pointer events: a pointer goes to the canvas and is picked there (`StageInteraction`),
 * so the rig's gestures keep working. Mounts with either renderer: it reads only the placement and the projection.
 */

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useRoving } from '../useRoving';
import { MAX_PROXIES, PROXY_SIZE, proxyItems, type ProxyItem } from './a11y/proxyItems';
import type { StageBus } from './anchor/stageBus';
import type { Placement } from './types';

export interface StageProxiesProps {
    bus: StageBus;
    selected: string | null;
    /** A tween is running (B1a rule 5): the proxies are over where the marks were, so they are hidden from assistive tech. */
    disabled?: boolean;
    /** What the view shows, read with the group (the placement's view description). */
    description?: string | undefined;
    onSelect(key: string): void;
    /** Escape / Backspace: out of a drilled level. Absent = nothing to go out of. */
    onOut?: (() => void) | undefined;
}

const BOX: CSSProperties = {
    position: 'absolute', width: PROXY_SIZE, height: PROXY_SIZE, margin: 0, padding: 0, border: 0, background: 'transparent',
    borderRadius: '50%', pointerEvents: 'none',
};
const HIDDEN: CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' };

interface Stop extends ProxyItem { key: string }

/** The proxies of the last settle (the selection and the focused stop are kept even off screen); a slot with no key is none. */
function useStops(bus: StageBus, keep: readonly number[]): { stops: Stop[]; of: Placement | null } {
    const [built, setBuilt] = useState<{ stops: Stop[]; of: Placement | null }>({ stops: [], of: null });
    const keepKey = keep.join(',');
    useEffect(() => {
        const rebuild = () => {
            const index = bus.pickIndex, p = bus.placement, view = bus.projector, keys = bus.keys;
            const items = index && p && view ? proxyItems(p.a11y, index, view, keep, MAX_PROXIES) : [];
            setBuilt({ stops: items.flatMap((item) => { const key = keys[item.slot]; return key ? [{ ...item, key }] : []; }), of: index ? p : null });
        };
        rebuild();
        return bus.onSettle(rebuild);
    }, [bus, keepKey]); // eslint-disable-line react-hooks/exhaustive-deps
    return built;
}

export function StageProxies({ bus, selected, disabled = false, description, onSelect, onOut }: StageProxiesProps) {
    const roving = useRoving();
    const [focused, setFocused] = useState(-1);
    const { stops, of } = useStops(bus, [bus.slotOf(selected), focused]);
    const describedBy = useId();
    const root = useRef<HTMLDivElement | null>(null);
    const stop = stops.find((i) => i.key === selected)?.slot ?? (focused >= 0 && stops.some((i) => i.slot === focused) ? focused : stops[0]?.slot);

    // A focus move the bus was asked for lands once the stops of the placement now on show are in the DOM.
    useEffect(() => {
        const want = bus.focusRequest;
        // Only stops of the placement now on show, and only once that is not the placement the request was made on.
        if (!want || disabled || stops.length === 0 || of !== bus.placement || bus.placement === want.from) return;
        bus.focusRequest = null;
        const target = 'key' in want ? stops.find((s) => s.key === want.key) ?? stops[0]! : stops[0]!;
        root.current?.querySelector<HTMLElement>(`[data-slot="${target.slot}"]`)?.focus({ preventScroll: true });
    }, [bus, stops, of, disabled]);

    const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, key: string) => {
        // Enter selects here (the default click is cancelled, so it selects once); Space stays the button's own click.
        if (e.key === 'Enter') { e.preventDefault(); onSelect(key); return; }
        if ((e.key === 'Escape' || e.key === 'Backspace') && onOut) { e.preventDefault(); onOut(); return; }
        roving.onArrow(e);
    };

    return (
        <div
            role="group" aria-describedby={description ? describedBy : undefined} aria-hidden={disabled || undefined} data-stage-proxies
            ref={(el) => { root.current = el; bus.proxyRoot = el; }}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
            {description && <p id={describedBy} style={HIDDEN}>{description}</p>}
            {stops.map((item) => (
                <button
                    key={item.key} type="button" aria-label={item.label} aria-pressed={selected === item.key} {...(item.current ? { 'aria-current': 'step' as const } : {})}
                    tabIndex={!disabled && item.slot === stop ? 0 : -1} data-id={item.key} data-slot={item.slot} data-offscreen={item.offscreen || undefined}
                    style={{ ...BOX, left: item.x - PROXY_SIZE / 2, top: item.y - PROXY_SIZE / 2 }}
                    onFocus={(e) => { roving.onFocus(e); setFocused(item.slot); if (item.offscreen) bus.reveal(item.slot); }}
                    onBlur={roving.onBlur}
                    onKeyDown={(e) => onKeyDown(e, item.key)}
                    onClick={() => onSelect(item.key)}
                />
            ))}
        </div>
    );
}

/** Moves keyboard focus to the proxy of `key` (focus return after a card closes); false when it has none. */
export function focusProxy(bus: StageBus, key: string): boolean {
    const el = [...(bus.proxyRoot?.querySelectorAll<HTMLElement>('[data-id]') ?? [])].find((b) => b.getAttribute('data-id') === key);
    el?.focus({ preventScroll: true });
    return !!el;
}
