/**
 * The run delta card's Predicted block (PRD 41 §D11): the shared, localized `PredictedBlock` for
 * the run's `ok` predictions (naturalness today; risk and similar-runs as the WS18 model lands).
 * Its first render of each prediction posts `run-delta/prediction-shown`; the host counts it as
 * `prediction.shown`. Advisory (§D0): no verdict colours, nothing for a prediction that is not
 * `ok`, and nothing at all when there are no `ok` predictions.
 */

import { useEffect, type ReactNode } from 'react';
import type { Prediction } from '@builderforce/run-delta/predict';
import { PredictedBlock, type RunDeltaLabels } from '@builderforce/knowledge-graph-view/delta';
import { request } from '../../bridge/vscodeBridge';

export const RUN_DELTA_PREDICTION_SHOWN = 'run-delta/prediction-shown';
const NATURALNESS = 'naturalness.unusual-lines';

/** Predictions already reported this session (by id and input digest): one `prediction.shown` per prediction. */
const reported = new Set<string>();

export function PredictedLine({ predicted, labels }: { predicted?: readonly Prediction[] | undefined; labels: RunDeltaLabels }) {
  // An `ok` 0 ("no unusual lines") is nothing to look at: no line, no `prediction.shown`.
  const p = predicted?.find((x) => x.id === NATURALNESS && x.status === 'ok' && x.value > 0);
  useEffect(() => {
    if (!p) return;
    const key = `${p.id}\u0000${p.inputDigest}`;
    if (reported.has(key)) return;
    reported.add(key);
    void request(RUN_DELTA_PREDICTION_SHOWN, { prediction: p }).catch(() => {});
  }, [p]);
  const block: ReactNode = <PredictedBlock labels={labels} predicted={predicted ?? []} />;
  return block;
}
