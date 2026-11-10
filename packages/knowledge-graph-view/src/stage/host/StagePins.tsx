/**
 * The findings pins on the stage (PRD 43 B3: pins are per-station data and clickable): a numbered badge above each
 * pinned station's mark, in its worst finding's severity tone. Each badge is a DOM button whose transform is written from
 * the stage's frame loop (`StageBus.onFrame`), so a pan, zoom or tilt moves it with no React commit; hidden during a
 * tween (the marks are between placements) and while its station is not drawn. Activating one opens the station's card,
 * as the map's pin always did. Words come from the catalog (`pinFindings`).
 */

import { useLayoutEffect, useRef } from 'react';
import type { KnowledgeGraphLabels } from '../../labels';
import { cssVar, type ThemeTone } from '../../scene/themeColors';
import { counted } from '../../surface/plural';
import type { Station } from '../../surface/stations';
import type { Pin } from '../../surface/useSurface';
import { TYPE } from '../../surface/ui/type';
import { useStageBus } from '../anchor/stageBus';
import type { Projector } from '../pick';

const PIN = 22;
const scratch = new Float64Array(2);

export interface StagePinsProps {
    pins: readonly Pin[];
    stations: ReadonlyMap<string, Station>;
    labels: KnowledgeGraphLabels;
    onActivate(key: string): void;
}

export function StagePins({ pins, stations, labels, onActivate }: StagePinsProps) {
    return (
        <>
            {pins.map((pin) => {
                const station = stations.get(pin.stationId);
                return station ? <StagePin key={pin.stationId} pin={pin} station={station} labels={labels} onActivate={onActivate} /> : null;
            })}
        </>
    );
}

function StagePin({ pin, station, labels, onActivate }: { pin: Pin; station: Station; labels: KnowledgeGraphLabels; onActivate(key: string): void }) {
    const bus = useStageBus();
    const ref = useRef<HTMLButtonElement>(null);
    const key = `st:${station.id}`;
    useLayoutEffect(() => {
        let last = '';
        const write = (projector: Projector | null) => {
            const el = ref.current;
            if (!el) return;
            const p = bus.placement, slot = bus.slotOf(key);
            const shown = !!projector && !!p && !bus.tweening && slot >= 0 && p.scale[slot]! > 0;
            if (!shown || !projector || !p) { el.style.visibility = 'hidden'; return; }
            const x = p.position[slot * 3]!, y = p.position[slot * 3 + 1]! + (p.extrude[slot] ?? 0) * bus.extrudeScale(), z = p.position[slot * 3 + 2]!;
            if (!projector.project(x, y, z, scratch)) { el.style.visibility = 'hidden'; return; }
            const r = p.scale[slot]! * projector.pxPerWorld;
            const transform = `translate3d(${Math.round(scratch[0]! + r + 2)}px, ${Math.round(scratch[1]! - r - PIN)}px, 0)`;
            el.style.visibility = '';
            if (transform === last) return;
            last = transform;
            el.style.transform = transform;
        };
        write(bus.projector);
        const offFrame = bus.onFrame(write);
        const offSettle = bus.onSettle(() => write(bus.projector));
        const offTween = bus.onTween(() => write(bus.projector));
        return () => { offFrame(); offSettle(); offTween(); };
    }, [bus, key]);
    return (
        <button
            ref={ref} type="button" data-pin={station.id} onClick={() => onActivate(key)}
            aria-label={counted(labels, 'pinFindings', pin.count, { name: station.name })}
            style={{
                position: 'absolute', left: 0, top: 0, width: PIN, height: PIN, padding: 0, borderRadius: 999, cursor: 'pointer', visibility: 'hidden',
                border: `1.5px solid ${cssVar('bg')}`, background: cssVar(`sev${station.anti}` as ThemeTone), color: cssVar('bg'), ...TYPE.status,
            }}
        >
            {pin.count}
        </button>
    );
}
