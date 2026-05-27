/**
 * Shared engine-readiness hook — the single source of "can the host run the studio?"
 * Both StudioPanel and any third-party consumer using engine-only mode should
 * read engine status through this hook. Eliminates duplicated WebGPU/WebNN
 * detection branching (DRY) and matches the project's "no canX prop" rule.
 */

import { useEffect, useState } from 'react';
import { probeDevice } from '../engine/device-router';
import type { ProbedDevice } from '../engine/device-router';

export type EngineStatus =
  | { state: 'probing' }
  | { state: 'ready'; device: ProbedDevice }
  | { state: 'unsupported'; reason: string };

export function useEngineStatus(): EngineStatus {
  const [status, setStatus] = useState<EngineStatus>({ state: 'probing' });

  useEffect(() => {
    let cancelled = false;
    probeDevice('auto')
      .then((device) => {
        if (cancelled) return;
        if (!device) {
          setStatus({
            state: 'unsupported',
            reason:
              'This browser cannot run the AI Video Studio. Requires WebGPU (Chrome 113+, Edge 113+) or WebNN.',
          });
          return;
        }
        setStatus({ state: 'ready', device });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus({
          state: 'unsupported',
          reason: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
