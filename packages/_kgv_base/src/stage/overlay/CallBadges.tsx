/**
 * The open method's call numbers on the stage (the code band; PRD 43 B1a rule 9): one button per call on its arc
 * (`badgeAt`, the arcs the overlay draws from `bus.calls`), the current call's in the partner amber like its gutter
 * number. A number goes to its call (`onStep`). Their places are written from the frame loop, as `useSlotAnchor` does,
 * so a pan or zoom moves them with no React commit; hidden during a tween and where the arc is not drawn.
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { TYPE } from '../../surface/ui/type';
import { useStageBus } from '../anchor/stageBus';
import type { Projector } from '../pick';
import { badgeAt, nthCallTo, type CallTrack } from './callArcs';
import { OVERLAY_LIFT } from './OverlayLayer';

const BADGE_PX = 20;

const badge = (current: boolean): CSSProperties => ({
    position: 'absolute', left: 0, top: 0, width: BADGE_PX, height: BADGE_PX, padding: 0, borderRadius: '50%', cursor: 'pointer',
    display: 'grid', placeItems: 'center', pointerEvents: 'auto', ...TYPE.meta, fontWeight: 700,
    border: `1.5px solid ${cssVar(current ? 'partner' : 'accent')}`, background: cssVar(current ? 'partner' : 'panel'), color: cssVar(current ? 'onAccent' : 'text'),
});

export interface CallBadgesProps {
    labels: KnowledgeGraphLabels;
    /** A number was clicked: its call's index. */
    onStep(index: number): void;
}

export function CallBadges({ labels, onStep }: CallBadgesProps) {
    const bus = useStageBus();
    const [track, setTrack] = useState<CallTrack | null>(bus.calls);
    useEffect(() => { setTrack(bus.calls); return bus.onCalls(setTrack); }, [bus]);
    const box = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        if (!track) return undefined;
        const scratch = new Float64Array(2);
        const write = (projector: Projector | null) => {
            const root = box.current, p = bus.placement;
            if (!root || !projector || !p) return;
            const shown = (s: number) => s >= 0 && (p.scale[s] ?? 0) > 0;
            const at = (s: number) => ({ x: p.position[s * 3]!, y: p.position[s * 3 + 2]! });
            root.querySelectorAll<HTMLElement>('[data-call-badge]').forEach((el, i) => {
                const to = track.to[i] ?? -1;
                const pt = shown(track.from) && shown(to) && to !== track.from ? badgeAt(at(track.from), at(to), nthCallTo(track.to, i)) : null;
                const on = !!pt && projector.project(pt.x, OVERLAY_LIFT, pt.y, scratch);
                el.style.display = on ? '' : 'none';
                if (on) el.style.transform = `translate3d(${Math.round(scratch[0]! - BADGE_PX / 2)}px, ${Math.round(scratch[1]! - BADGE_PX / 2)}px, 0px)`;
            });
        };
        const tween = (on: boolean) => { if (box.current) box.current.style.visibility = on ? 'hidden' : ''; };
        write(bus.projector);
        tween(bus.tweening);
        const offFrame = bus.onFrame((projector) => { if (!bus.tweening) write(projector); });
        const offSettle = bus.onSettle(() => write(bus.projector));
        const offTween = bus.onTween(tween);
        return () => { offFrame(); offSettle(); offTween(); };
    }, [bus, track]);

    if (!track) return null;
    const count = track.to.length;
    return (
        <div ref={box} data-call-badges style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}>
            {track.to.map((_, i) => {
                const current = i === track.current;
                return (
                    <button
                        key={i} type="button" data-call-badge={i + 1} data-current={current ? '' : undefined} aria-current={current ? 'step' : undefined}
                        aria-label={fillTemplate(labels.surface.code.stepAria, { n: i + 1, count })} onClick={() => onStep(i)} style={badge(current)}
                    >{i + 1}</button>
                );
            })}
        </div>
    );
}
