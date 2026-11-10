/**
 * The card's Predicted line (PRD 41 §D11): "≈ N unusual lines (predicted)" for an `ok` naturalness prediction of at least one
 * line, and nothing otherwise — an `ok` 0 included. Static markup: the suite has no DOM.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'use-intl';
import { describe, expect, it, vi } from 'vitest';
import type { Prediction } from '@builderforce/run-delta/predict';
import { PredictedLine } from './PredictedLine';

/** The two `runDelta` entries it reads, as the English catalog spells them. */
const RUN_DELTA = {
  predictedUnusualLines: '≈ {count, plural, one {# unusual line} other {# unusual lines}} (predicted)',
  predictedHint: 'Estimated from how unusual the new code is for this repository. A place to look, not a verdict.',
};

vi.mock('../../vscodeBridge', () => ({ request: vi.fn(() => Promise.resolve(true)), onHostMessage: vi.fn(() => () => {}) }));

const prediction = (value: number, status: Prediction['status'] = 'ok'): Prediction => ({
  id: 'naturalness.unusual-lines', modelId: 'naturalness.trigram', modelVersion: '1.2.0', featureSchemaVersion: 3, value,
  explanation: [], status, inputDigest: String(value).padStart(64, '0'),
});

const render = (predicted?: Prediction[]): string => renderToStaticMarkup(createElement(IntlProvider, {
  locale: 'en', messages: { runDelta: RUN_DELTA }, onError: () => {},
  children: createElement(PredictedLine, { predicted }),
}));

describe('PredictedLine', () => {
  it('shows the count with ≈ wording and theme colours only', () => {
    const html = render([prediction(2)]);
    expect(html).toContain('≈ 2 unusual lines (predicted)');
    expect(html).toContain('var(--vscode-descriptionForeground)');
  });

  it('renders nothing for an ok 0, a non-ok status, or no prediction', () => {
    expect(render([prediction(0)])).toBe('');
    expect(render([prediction(3, 'insufficient-data')])).toBe('');
    expect(render(undefined)).toBe('');
  });
});
