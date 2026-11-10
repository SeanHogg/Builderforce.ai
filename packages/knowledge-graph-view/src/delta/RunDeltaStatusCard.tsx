/**
 * The Run Delta card before (or instead of) a delta (PRD 41 §C11.1): `pending` — "Measuring what this run changed…" —
 * posted the moment the run's delta starts computing, and `failed` when the computation ended without one (an error, or
 * its budget ran out). The computed {@link RunDeltaCard} replaces it. Props only.
 */

import type { RunDeltaProgressCard } from '@builderforce/run-delta/contract';
import { cssVar } from '../scene/themeColors';
import { card } from '../styles';
import { TYPE } from '../surface/ui/type';
import type { RunDeltaLabels } from './labels';
import { VERDICT_TONE, VerdictIcon } from './VerdictMark';

export interface RunDeltaStatusCardProps {
    status: RunDeltaProgressCard['status'];
    runId: string;
    labels: RunDeltaLabels;
}

export function RunDeltaStatusCard({ status, runId, labels }: RunDeltaStatusCardProps) {
    const pending = status === 'pending';
    return (
        <section
            aria-label={labels.cardTitle}
            aria-busy={pending}
            data-run-delta={runId}
            data-status={status}
            style={{ ...card, display: 'grid', gap: 6, minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', color: cssVar('text') }}
        >
            <h3 style={TYPE.sectionHeading}>{labels.cardTitle}</h3>
            <p role="status" style={{ ...TYPE.body, margin: 0, display: 'flex', gap: 6, alignItems: 'flex-start', overflowWrap: 'anywhere', color: cssVar(pending ? 'text' : 'muted') }}>
                <span style={{ color: VERDICT_TONE.not_measured, paddingTop: 1 }}><VerdictIcon verdict="not_measured" /></span>
                <span>{pending ? labels.pendingCard : labels.failedCard}</span>
            </p>
        </section>
    );
}
