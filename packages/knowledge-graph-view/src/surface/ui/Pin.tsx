/** A numbered pin on the heat ramp (the action card's and the fix queue's marker); `resolved` turns it the agreeing tone. */

import { cssVar } from '../../scene/themeColors';
import { heatColor, MONO } from '../../styles';

export function Pin({ n, level, resolved = false, size = 22 }: { n: number; level: number; resolved?: boolean; size?: number }) {
    return (
        <span
            aria-hidden="true"
            style={{ flex: 'none', width: size, height: size, borderRadius: 999, display: 'grid', placeItems: 'center', fontSize: size < 22 ? 10.5 : 11, fontWeight: 700, fontFamily: MONO, background: resolved ? cssVar('agrees') : heatColor(level), color: cssVar('bg') }}
        >
            {n}
        </span>
    );
}
