/**
 * CHIP labels (the design's `.lb`): the perspective Map's names as screen-facing DOM chips — panel background, 1px border,
 * mono 11.5px, padding 1px 6px, radius 3 — projected above each mark's top. Inverted (text background, page-colour text,
 * weight 600) when selected; a warn border when risky. Every frame the stage's camera projection (`bus.onFrame`) moves each chip
 * with one style write — no React commit — and clamps it inside the stage box. Clicking a chip selects its mark; a double
 * click goes inside it. Hidden while the marks tween (a chip would sit where they were).
 */

import { memo, useEffect, useRef, type CSSProperties } from 'react';
import { cssVar } from '../../scene/themeColors';
import { FONT_MONO } from '../../surface/ui/type';
import type { StageBus } from '../anchor/stageBus';
import type { PlacedChip } from './runs';

export interface ChipLayerProps {
    bus: StageBus;
    chips: readonly PlacedChip[];
    /** The selected mark's key (null: none). */
    selected: string | null;
    hidden: boolean;
    onSelect(key: string): void;
    onDrill?: ((key: string) => void) | undefined;
}

/** Px above the mark's top the chip floats, and the gutter kept from the stage edge. */
const RISE_PX = 8, GUTTER_PX = 2;

const LAYER: CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 2 };

function chipStyle(risky: boolean, on: boolean, ghost: boolean): CSSProperties {
    return {
        position: 'absolute', left: 0, top: 0, whiteSpace: 'nowrap', pointerEvents: 'auto', cursor: 'pointer',
        fontFamily: FONT_MONO, fontSize: 11.5, lineHeight: 1.35, padding: '1px 6px', borderRadius: 3, fontWeight: on ? 600 : 500,
        background: on ? cssVar('text') : cssVar('panel'),
        color: on ? cssVar('bg') : ghost ? cssVar('muted') : cssVar('text'),
        opacity: ghost ? 0.62 : 1,
        border: `1px solid ${risky ? cssVar('cycle') : on ? cssVar('text') : cssVar('border')}`,
        visibility: 'hidden',
    };
}

export const ChipLayer = memo(function ChipLayer({ bus, chips, selected, hidden, onSelect, onDrill }: ChipLayerProps) {
    const layer = useRef<HTMLDivElement>(null);
    const els = useRef<(HTMLButtonElement | null)[]>([]);
    const live = useRef({ chips, selected, hidden });
    live.current = { chips, selected, hidden };
    const out = useRef(new Float64Array(2));

    useEffect(() => {
        const move = (): void => {
            const box = layer.current, pr = bus.projector;
            if (!box || !pr) return;
            const { chips: list, hidden: off } = live.current;
            const selSlot = bus.slotOf(live.current.selected);
            const W = box.clientWidth, H = box.clientHeight, o = out.current;
            list.forEach((c, i) => {
                const el = els.current[i];
                if (!el) return;
                if (off || !pr.project(c.position[0], c.position[1], c.position[2], o)) { el.style.visibility = 'hidden'; return; }
                const w = el.offsetWidth, h = el.offsetHeight;
                // Centred over the mark's top, floating RISE_PX above it, then kept inside the stage box.
                const x = Math.min(Math.max(o[0]! - w / 2, GUTTER_PX), Math.max(GUTTER_PX, W - w - GUTTER_PX));
                const y = Math.min(Math.max(o[1]! - h - RISE_PX, GUTTER_PX), Math.max(GUTTER_PX, H - h - GUTTER_PX));
                el.style.transform = `translate(${x}px, ${y}px)`;
                el.style.visibility = 'visible';
                const on = c.slot === selSlot;
                if (el.dataset.on !== String(on)) { el.dataset.on = String(on); Object.assign(el.style, chipStyle(c.risky, on, c.ghost), { visibility: 'visible', transform: `translate(${x}px, ${y}px)` }); }
            });
        };
        move();
        return bus.onFrame(move);
    }, [bus, chips, hidden, selected]);

    return (
        <div ref={layer} data-stage-chips style={LAYER}>
            {chips.map((c, i) => {
                const key = bus.keys[c.slot] ?? '';
                return (
                    <button
                        key={`${c.slot}:${c.text}`} ref={(el) => { els.current[i] = el; }} type="button" tabIndex={-1} data-chip={key}
                        style={chipStyle(c.risky, false, c.ghost)}
                        onClick={() => { if (key) onSelect(key); }}
                        onDoubleClick={() => { if (key) onDrill?.(key); }}
                    >
                        {c.text}
                    </button>
                );
            })}
        </div>
    );
});
