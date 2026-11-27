import { useEffect, useRef } from 'react';
import { cssVar } from '../../scene/themeColors';
import { FONT_MONO, TYPE } from '../../surface/ui/type';
import type { StageBus } from '../anchor/stageBus';
import { TONE_ORDER } from '../tones';
import type { Caption } from '../types';

/** Real screen-space text at the projected 3D point, including height. */
export function ProjectedCaptions({ captions, bus, hidden }: { captions: readonly Caption[]; bus: StageBus; hidden: boolean }) {
    const layer = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const rows = layer.current?.children;
        if (!rows) return;
        const at = new Float64Array(2);
        const move = () => {
            captions.forEach((caption, i) => {
                const row = rows[i] as HTMLElement | undefined;
                if (!row) return;
                const shown = !hidden && bus.projector?.project(...caption.position, at);
                row.style.visibility = shown ? 'visible' : 'hidden';
                if (shown) {
                    row.style.left = `${Math.round(at[0]! + (caption.offsetPx?.[0] ?? 0))}px`;
                    row.style.top = `${Math.round(at[1]! + (caption.offsetPx?.[1] ?? 0))}px`;
                }
            });
        };
        move();
        return bus.onFrame(move);
    }, [captions, bus, hidden]);
    return <div ref={layer} data-projected-captions style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        {captions.map((caption, i) => <span key={i} data-caption-role={caption.role ?? 'plane'} style={{
            ...TYPE.caption, ...(caption.font === 'mono' ? { fontFamily: FONT_MONO, fontSize: 11 } : {}),
            position: 'absolute', whiteSpace: 'nowrap', visibility: 'hidden',
            color: cssVar(TONE_ORDER[caption.tone] ?? 'muted'), transform: `translate(${caption.anchor === 'end' ? '-100%' : caption.anchor === 'middle' ? '-50%' : '0'}, -50%)`,
            ...(caption.role === 'step' ? { border: `1px solid ${cssVar('border')}`, background: cssVar('panel'), padding: '1px 4px', borderRadius: 4 } : {}),
        }}>{caption.text}</span>)}
    </div>;
}
