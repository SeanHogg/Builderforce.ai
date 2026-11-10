/**
 * The run delta card's Predicted line (PRD 41 §D11): "≈ N unusual lines (predicted)" from the card's `ok` naturalness
 * prediction (§D6), which `run-delta/get` attaches as `predicted`. Advisory (§D0): no verdict colour, no icon — the
 * description foreground only — and nothing at all without an `ok` prediction of at least one line.
 *
 * Its first render of a prediction posts `run-delta/prediction-shown`; the host counts it as `prediction.shown`.
 */

import { useEffect } from 'react';
import { useTranslations } from 'use-intl';
import type { Prediction } from '@builderforce/run-delta/predict';
import { request } from '../../vscodeBridge';

export const RUN_DELTA_PREDICTION_SHOWN = 'run-delta/prediction-shown';
const NATURALNESS = 'naturalness.unusual-lines';

/** Predictions already reported this session (by id and input digest): one `prediction.shown` per prediction. */
const reported = new Set<string>();

export function PredictedLine({ predicted }: { predicted?: readonly Prediction[] | undefined }) {
  const t = useTranslations('runDelta');
  // An `ok` 0 ("no unusual lines") is nothing to look at: no line, no `prediction.shown`.
  const p = predicted?.find((x) => x.id === NATURALNESS && x.status === 'ok' && x.value > 0);
  useEffect(() => {
    if (!p) return;
    const key = `${p.id}\u0000${p.inputDigest}`;
    if (reported.has(key)) return;
    reported.add(key);
    void request(RUN_DELTA_PREDICTION_SHOWN, { prediction: p }).catch(() => {});
  }, [p]);
  if (!p) return null;
  return (
    <p
      data-testid="run-delta-predicted"
      title={t('predictedHint')}
      style={{ margin: 0, minWidth: 0, overflowWrap: 'anywhere', color: 'var(--vscode-descriptionForeground)', fontSize: 'var(--vscode-font-size)' }}
    >
      {t('predictedUnusualLines', { count: p.value })}
    </p>
  );
}
