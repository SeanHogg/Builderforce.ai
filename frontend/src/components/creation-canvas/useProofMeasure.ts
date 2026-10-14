/**
 * The scoreboard's one read — `realizationApi.measure` — with a reload for after an
 * early call. `null` evaluation = the proof declares no measure.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ProofEvaluationDto } from '@builderforce/interaction-contract';
import { realizationApi } from '@/lib/realizationApi';

export interface ProofMeasureState {
  evaluation: ProofEvaluationDto | null;
  loading: boolean;
  error: unknown;
  reload: () => void;
}

export function useProofMeasure(realizationId: string | null): ProofMeasureState {
  const [evaluation, setEvaluation] = useState<ProofEvaluationDto | null>(null);
  const [loading, setLoading] = useState(realizationId !== null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!realizationId) {
      setEvaluation(null);
      setLoading(false);
      return undefined;
    }
    let live = true;
    setLoading(true);
    setError(null);
    realizationApi.measure(realizationId)
      .then((found) => { if (live) setEvaluation(found); })
      .catch((cause: unknown) => { if (live) setError(cause); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [realizationId, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { evaluation, loading, error, reload };
}
