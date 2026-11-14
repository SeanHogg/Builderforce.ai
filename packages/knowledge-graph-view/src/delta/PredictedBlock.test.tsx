// @vitest-environment jsdom
/**
 * The card's Predicted block (PRD 41 §D11): one row per known `ok` prediction (risk, similar
 * runs, ≈ undetected, unusual lines), advisory wording, no verdict colours, and nothing at all
 * when there is no `ok` prediction or no predictions.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { Prediction } from '@builderforce/run-delta/predict';
import { PredictedBlock } from './PredictedBlock';
import { DEFAULT_RUN_DELTA_LABELS as L } from './labels';

const prediction = (over: Partial<Prediction>): Prediction => ({
    id: 'naturalness.unusual-lines',
    modelId: 'm',
    modelVersion: 'v1',
    featureSchemaVersion: 1,
    value: 1,
    explanation: [],
    status: 'ok',
    inputDigest: 'd',
    ...over,
});

const risk = prediction({
    id: 'risk.followup-fix', value: 0.7, band: 'high',
    explanation: [{ feature: 'size.linesAdded', contribution: 2 }, { feature: 'run.toolFailures', contribution: 1 }, { feature: 'history.pastFollowupFixes', contribution: 0.5 }],
});
const similar = prediction({
    id: 'similar-runs.outcomes', value: 7,
    explanation: [{ feature: 'k', contribution: 10 }, { feature: 'no-followup', contribution: 7 }, { feature: 'reverted', contribution: 2 }],
});
const undetected = prediction({ id: 'estimate.undetected.security', value: 2 });
const unusual = prediction({ id: 'naturalness.unusual-lines', value: 3 });

describe('PredictedBlock (PRD 41 §D11)', () => {
    it('renders nothing when there are no ok predictions', () => {
        const { container } = render(<PredictedBlock labels={L} predicted={[]} />);
        expect(container.querySelector('[data-testid="predicted-block"]')).toBeNull();
    });

    it('renders nothing for an insufficient-data prediction (D0.5)', () => {
        const { container } = render(<PredictedBlock labels={L} predicted={[prediction({ status: 'insufficient-data', value: 0 })]} />);
        expect(container.querySelector('[data-testid="predicted-block"]')).toBeNull();
    });

    it('shows the risk probability, band and top-3 reasons, advisory not verdict', () => {
        const { getByTestId } = render(<PredictedBlock labels={L} predicted={[risk]} />);
        const row = getByTestId('predicted-risk');
        expect(row.textContent).toContain('70% risk of a follow-up fix (high)');
        expect(row.textContent).toContain('size.linesAdded, run.toolFailures, history.pastFollowupFixes');
    });

    it('shows the similar-runs outcome: N of k needed no follow-up; M reverted', () => {
        const { getByTestId } = render(<PredictedBlock labels={L} predicted={[similar]} />);
        expect(getByTestId('predicted-similar').textContent).toContain('7 of 10 similar runs needed no follow-up; 2 were reverted');
    });

    it('shows ≈ undetected per dimension and the unusual-lines count', () => {
        const { getByTestId } = render(<PredictedBlock labels={L} predicted={[undetected, unusual]} />);
        expect(getByTestId('predicted-undetected-security').textContent).toContain('≈ 2 undetected problems in Security');
        expect(getByTestId('predicted-unusual').textContent).toContain('≈ 3 unusual new lines (predicted)');
    });

    it('opens a row\'s explanation in the panel through onOpenExplanation', () => {
        const open = vi.fn();
        const { getByTestId } = render(<PredictedBlock labels={L} predicted={[risk]} onOpenExplanation={open} />);
        fireEvent.click(getByTestId('predicted-risk').querySelector('button')!);
        expect(open).toHaveBeenCalledWith(risk);
    });
});
