/**
 * The Run Delta card (PRD 41 §C11.1): what a finished run changed, for people who don't read
 * code. It sits in the chat transcript of the run that produced it (principle 6, one flow) —
 * the headline, one row per dimension, the blast-radius band and "Open details". Props only:
 * no fetching, no host calls; the same component renders on the web.
 *
 * No "measuring…" row: the `RunDelta` contract (v1) has no pending state — a delta is posted
 * once, final. When the contract grows one, the row belongs in {@link DimensionRow}.
 */

import type { RunDelta } from '@builderforce/run-delta/contract';
import { cssVar } from '../scene/themeColors';
import { card, quietButton } from '../styles';
import { TYPE } from '../surface/ui/type';
import { fillTemplate } from '../template';
import { headlineText, reasonLabel } from './deltaText';
import { DimensionRow } from './DimensionRow';
import type { RunDeltaLabels } from './labels';
import { reasonTag, VERDICT_TONE, VerdictIcon } from './VerdictMark';

export interface RunDeltaCardProps {
    delta: RunDelta;
    labels: RunDeltaLabels;
    /** The repo the delta covers, shown under the title when a run touched more than one. */
    repoLabel?: string | undefined;
    onOpenDetails(): void;
}

const BAND_TONE = { low: cssVar('sev1'), medium: cssVar('sev3'), high: cssVar('sev5') } as const;

export function RunDeltaCard({ delta, labels, repoLabel, onOpenDetails }: RunDeltaCardProps) {
    const headline = headlineText(labels, delta.summary);
    const band = delta.blastRadius.band;
    return (
        <section
            aria-label={labels.cardTitle}
            data-run-delta={delta.runId}
            style={{ ...card, display: 'grid', gap: 8, minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', color: cssVar('text') }}
        >
            <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                <h3 style={{ ...TYPE.sectionHeading, flex: '1 1 auto' }}>{labels.cardTitle}</h3>
                {repoLabel && <span style={{ ...TYPE.monoMeta, overflowWrap: 'anywhere', minWidth: 0 }}>{repoLabel}</span>}
            </header>
            <p style={{ ...TYPE.body, margin: 0, display: 'flex', gap: 6, alignItems: 'flex-start', overflowWrap: 'anywhere' }}>
                <span style={{ color: VERDICT_TONE[delta.headline], paddingTop: 1 }}><VerdictIcon verdict={delta.headline} /></span>
                <span data-testid="run-delta-headline">{headline}</span>
            </p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {delta.dimensions.map((d) => <DimensionRow key={d.id} dimension={d} labels={labels} />)}
            </ul>
            <footer style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span data-band={band} style={{ ...TYPE.status, display: 'inline-flex', alignItems: 'center', gap: 6, color: cssVar('text') }}>
                    <span aria-hidden="true" style={{ display: 'inline-block', width: 4, height: 14, borderRadius: 2, background: BAND_TONE[band] }} />
                    {fillTemplate(labels.blastRadiusValue, { band: labels.bands[band] })}
                </span>
                {delta.blastRadius.reasons.map((r) => <span key={r} data-reason={r} style={reasonTag}>{reasonLabel(labels, r)}</span>)}
                {delta.blocking.length > 0 && <span style={{ ...reasonTag, color: cssVar('sev5'), borderColor: cssVar('sev5') }}>{labels.blocking}</span>}
                <button type="button" onClick={onOpenDetails} style={{ ...quietButton, marginInlineStart: 'auto' }}>
                    {labels.openDetails}
                </button>
            </footer>
        </section>
    );
}
