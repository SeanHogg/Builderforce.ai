/**
 * The blast-radius band (PRD 41 §C10) as word + bar + colour: "Blast radius: high" beside a short
 * bar in the band's theme token. ONE mark for the card, the history rows and the trend, so the band
 * reads the same everywhere and never by colour alone.
 */

import type { RunDelta } from '@builderforce/run-delta/contract';
import { cssVar } from '../../scene/themeColors';
import { TYPE } from '../../surface/ui/type';
import { fillTemplate } from '../../template';
import type { RunDeltaLabels } from '../labels';

export type BlastBand = RunDelta['blastRadius']['band'];

/** Theme tokens only: success, warning, danger. */
export const BAND_TONE: Record<BlastBand, string> = { low: cssVar('sev1'), medium: cssVar('sev3'), high: cssVar('sev5') };

export function BandMark({ band, labels }: { band: BlastBand; labels: RunDeltaLabels }) {
    return (
        <span data-band={band} style={{ ...TYPE.status, display: 'inline-flex', alignItems: 'center', gap: 6, color: cssVar('text'), whiteSpace: 'nowrap' }}>
            <span aria-hidden="true" style={{ display: 'inline-block', width: 4, height: 14, borderRadius: 2, background: BAND_TONE[band] }} />
            {fillTemplate(labels.blastRadiusValue, { band: labels.bands[band] })}
        </span>
    );
}
