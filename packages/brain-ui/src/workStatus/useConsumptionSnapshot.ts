import { useEffect, useState } from 'react';
import {
  cachedConsumptionSnapshot,
  fetchConsumptionSnapshot,
  subscribeConsumptionSnapshot,
  type ConsumptionSnapshot,
  type JsonRequest,
} from './consumptionSnapshot';

/** Subscribe a component to the shared consumption snapshot (one fetch per page). */
export function useConsumptionSnapshot(request: JsonRequest | null): ConsumptionSnapshot | null {
  const [snapshot, setSnapshot] = useState<ConsumptionSnapshot | null>(cachedConsumptionSnapshot());
  useEffect(() => {
    if (!request) return undefined;
    let alive = true;
    const off = subscribeConsumptionSnapshot((s) => { if (alive && s) setSnapshot(s); });
    void fetchConsumptionSnapshot(request).then((s) => { if (alive && s) setSnapshot(s); });
    return () => { alive = false; off(); };
  }, [request]);
  return snapshot;
}
