/** A numbered pin on the heat ramp (the action card's and the fix queue's marker); `resolved` turns it the agreeing tone. */

import { cssVar } from '../../scene/themeColors';
import { heatColor } from '../../styles';
import { TYPE } from './type';

export function Pin({ n, level, resolved = false, size = 22 }: { n: number; level: number; resolved?: boolean; size?: number }) {
    return (
        <span
            aria-hidden="true"
            style={{ flex: 'none', width: size, height: size, borderRadius: 999, display: 'grid', placeItems: 'center', ...TYPE.status, fontSize: size < 22 ? TYPE.tag.fontSize : TYPE.status.fontSize, background: resolved ? cssVar('agrees') : heatColor(level), color: cssVar('bg') }}
        >
            {n}
        </span>
    );
}
