/**
 * The card's Predicted block (PRD 41 §D11): risk, similar-runs outcome, "≈ N undetected" and the
 * unusual-lines count, each advisory (§D0) — rendered apart from the verdict rows, no verdict
 * colours, and nothing at all for a prediction that is not `ok`. Purely presentational: the host
 * hands the block the run's `ok` predictions (already filtered by `runDeltaPredictions.predictedOf`
 * on the VSIX; the web reads its stored prediction rows), and each row opens its explanation in
 * the panel through `onOpenExplanation`.
 *
 * Strings come from {@link RunDeltaLabels} (the host's catalog), so the block is localized with
 * the rest of the card and reads in both themes. Layout is fluid down to 360 px.
 */

import type { ReactNode } from 'react';
import type { Prediction } from '@builderforce/run-delta/predict';
import { cssVar } from '../scene/themeColors';
import { TYPE } from '../surface/ui/type';
import { fillTemplate } from '../template';
import type { RunDeltaLabels } from './labels';

const RISK = 'risk.followup-fix';
const SIMILAR = 'similar-runs.outcomes';
const UNDETECTED_PREFIX = 'estimate.undetected.';
const UNUSUAL = 'naturalness.unusual-lines';

export interface PredictedBlockProps {
    labels: RunDeltaLabels;
    /** The run's `ok` predictions (already filtered — anything not `ok` renders nothing). */
    predicted: readonly Prediction[];
    /** Opens a row's explanation (its top contributions) in the panel. */
    onOpenExplanation?: ((prediction: Prediction) => void) | undefined;
}

const percent = (p: number): string => `${Math.round(p * 100)}%`;

function row(content: string, onOpen: (() => void) | undefined, testId: string): ReactNode {
    return (
        <li key={testId} data-testid={testId} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
            <span style={{ ...TYPE.body, color: cssVar('text'), minWidth: 0, overflowWrap: 'anywhere' }}>{content}</span>
            {onOpen && (
                <button type="button" onClick={onOpen} title="ⓘ" style={{ ...TYPE.meta, color: cssVar('accent'), background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                    ⓘ
                </button>
            )}
        </li>
    );
}

/**
 * The Predicted block. One row per prediction id it knows; unknown ids render nothing (a newer
 * model's prediction is never mis-rendered). Empty ⇒ `null`, so a run with no predictions shows
 * no Predicted block at all.
 */
export function PredictedBlock({ labels, predicted, onOpenExplanation }: PredictedBlockProps) {
    const rows: ReactNode[] = [];
    const risk = predicted.find((p) => p.id === RISK && p.status === 'ok');
    if (risk) {
        const reasons = risk.explanation.slice(0, 3).map((e) => e.feature).join(', ');
        rows.push(row(
            fillTemplate(labels.predictedRisk, { probability: percent(risk.value), band: labels.bands[risk.band ?? 'medium'], reasons }),
            onOpenExplanation ? () => onOpenExplanation(risk) : undefined,
            'predicted-risk',
        ));
    }
    const similar = predicted.find((p) => p.id === SIMILAR && p.status === 'ok');
    if (similar) {
        const noFollowup = similar.value;
        const reverted = similar.explanation.find((e) => e.feature === 'reverted')?.contribution ?? 0;
        const k = similar.explanation.find((e) => e.feature === 'k')?.contribution ?? similar.value;
        rows.push(row(
            fillTemplate(labels.predictedSimilar, { noFollowup, k, reverted }),
            onOpenExplanation ? () => onOpenExplanation(similar) : undefined,
            'predicted-similar',
        ));
    }
    for (const p of predicted) {
        if (!p.id.startsWith(UNDETECTED_PREFIX) || p.status !== 'ok' || p.value <= 0) continue;
        const dimension = p.id.slice(UNDETECTED_PREFIX.length);
        rows.push(row(
            fillTemplate(labels.predictedUndetected, { count: p.value, dimension: labels.dimensions[dimension as keyof typeof labels.dimensions] ?? dimension }),
            onOpenExplanation ? () => onOpenExplanation(p) : undefined,
            `predicted-undetected-${dimension}`,
        ));
    }
    const unusual = predicted.find((p) => p.id === UNUSUAL && p.status === 'ok' && p.value > 0);
    if (unusual) {
        rows.push(row(
            fillTemplate(labels.predictedUnusualLines, { count: unusual.value }),
            onOpenExplanation ? () => onOpenExplanation(unusual) : undefined,
            'predicted-unusual',
        ));
    }
    if (rows.length === 0) return null;
    return (
        <section data-testid="predicted-block" style={{ display: 'grid', gap: 4, minWidth: 0, paddingTop: 6, borderTop: `1px solid ${cssVar('border')}` }}>
            <h4 style={{ ...TYPE.sectionHeading, margin: 0 }}>{labels.predictedHeading}</h4>
            <p style={{ ...TYPE.meta, margin: 0, overflowWrap: 'anywhere' }}>{labels.predictedAdvisory}</p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 3, minWidth: 0 }}>{rows}</ul>
        </section>
    );
}
