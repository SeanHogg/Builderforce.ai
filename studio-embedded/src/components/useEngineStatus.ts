/**
 * Shared engine-readiness hook — the single source of "can the host run the studio?"
 * Both StudioPanel and any third-party consumer using engine-only mode should
 * read engine status through this hook. Eliminates duplicated WebGPU/WebNN
 * detection branching (DRY) and matches the project's "no canX prop" rule.
 */

import { useEffect, useRef, useState } from 'react';
import { probeDevice, type ProbedDevice } from '@seanhogg/builderforce-studio';

export type EngineStatus =
  | { state: 'probing' }
  | { state: 'ready'; device: ProbedDevice }
  | { state: 'unsupported'; reason: string };

export function useEngineStatus(): EngineStatus {
  const [status, setStatus] = useState<EngineStatus>({ state: 'probing' });
  // Hold the probed device in a ref so the unmount cleanup can destroy()
  // its GPUDevice without going through React state. Without this the
  // probe-time WebGPU device leaks every time StudioPanel unmounts.
  const probedRef = useRef<ProbedDevice | null>(null);

  useEffect(() => {
    let cancelled = false;
    probeDevice('auto')
      .then((device) => {
        if (cancelled) {
          // Probe completed after unmount — release the device we just took.
          if (device?.kind === 'webgpu' && device.gpuDevice) {
            try { device.gpuDevice.destroy(); } catch { /* already lost */ }
          }
          return;
        }
        if (!device) {
          setStatus({
            state: 'unsupported',
            reason:
              'This browser cannot run the AI Video Studio. Requires WebGPU (Chrome 113+, Edge 113+) or WebNN.',
          });
          return;
        }
        probedRef.current = device;
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
      const probed = probedRef.current;
      if (probed?.kind === 'webgpu' && probed.gpuDevice) {
        try { probed.gpuDevice.destroy(); } catch { /* already lost */ }
      }
      probedRef.current = null;
    };
  }, []);

  return status;
}
