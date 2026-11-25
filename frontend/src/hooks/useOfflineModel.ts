/**
 * useOfflineModel — "make available offline" for one on-device studio model.
 *
 * The engine owns the download (`prepareModelOffline` writes every weight and the
 * tokenizer into its IndexedDB weight store); this hook only drives it: checks the
 * stored state, starts/cancels a download, and exposes progress. The engine is
 * reached through the one `loadStudio()` loader, so nothing here pulls it into a
 * bundle that never opens a scene.
 *
 * It also fetches the same-origin ONNX runtime `.wasm` once so the service worker
 * (which caches same-origin static assets after first fetch) holds them for offline.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiffusionModelId } from '@seanhogg/builderforce-studio';
import { getStoredTenantToken } from '@/lib/auth';
import { getApiBaseUrl } from '@/lib/apiClient';
import { loadStudio } from '@/lib/studioLoader';
import { canvasWasmBaseUrl } from '@/lib/canvasHost';
import { resolveOrtWasmPaths } from '@/lib/ortWasmPaths';
import { recordedFailure } from '@/lib/reportError';

export type OfflineModelState = 'checking' | 'idle' | 'downloading' | 'available' | 'error';

/** The ORT wasm binaries `scripts/copy-ort-runtime.mjs` publishes under `/ort/`. */
const ORT_WASM_FILES = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.jsep.wasm'] as const;

export interface UseOfflineModelResult {
  state: OfflineModelState;
  /** 0..1 while downloading; null when the total size is not known yet. */
  fraction: number | null;
  /** Bytes the model occupies offline, when known. */
  sizeBytes: number | null;
  /** The failure message, in `error`. */
  error: string | null;
  /** Whether there is a signed-in token to download with. */
  signedIn: boolean;
  start: () => Promise<void>;
  cancel: () => void;
}

/** Fetch the same-origin ORT wasm once so the service worker caches it. Best-effort. */
async function warmOrtWasm(): Promise<void> {
  const base = resolveOrtWasmPaths(canvasWasmBaseUrl());
  if (!base.startsWith('/')) return; // a host-served copy is the host's to cache
  await Promise.all(ORT_WASM_FILES.map((file) => fetch(`${base}${file}`).then((res) => res.arrayBuffer()).catch(recordedFailure(`Caching ${file} for offline use`, undefined))));
}

export function useOfflineModel(modelId: string): UseOfflineModelResult {
  const [state, setState] = useState<OfflineModelState>('checking');
  const [fraction, setFraction] = useState<number | null>(null);
  const [sizeBytes, setSizeBytes] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const signedIn = Boolean(getStoredTenantToken());

  const refresh = useCallback(async (isCurrent: () => boolean) => {
    if (!modelId) return;
    setState('checking');
    try {
      const studio = await loadStudio();
      const status = await studio.getModelOfflineStatus(modelId as DiffusionModelId);
      if (!isCurrent()) return;
      setSizeBytes(status.sizeBytes);
      setState(status.available ? 'available' : 'idle');
    } catch {
      if (isCurrent()) setState('idle'); // an unreadable store is simply "not downloaded"
    }
  }, [modelId]);

  useEffect(() => {
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      setError(null);
      setFraction(null);
      void refresh(() => current);
    });
    return () => {
      current = false;
      abortRef.current?.abort();
    };
  }, [refresh]);

  const start = useCallback(async () => {
    const token = getStoredTenantToken();
    if (!token || !modelId || abortRef.current) return;
    const abort = new AbortController();
    abortRef.current = abort;
    setError(null);
    setFraction(0);
    setState('downloading');
    try {
      const studio = await loadStudio();
      await studio.prepareModelOffline({
        model: modelId as DiffusionModelId,
        baseUrl: getApiBaseUrl(),
        authToken: token,
        signal: abort.signal,
        onProgress: (p) => setFraction(p.totalBytes ? p.loadedBytes / p.totalBytes : (p.fileIndex - 1) / p.fileCount),
      });
      await warmOrtWasm();
      await refresh(() => true);
    } catch (err) {
      if (abort.signal.aborted) {
        setState('idle');
      } else {
        setError(err instanceof Error ? err.message : String(err));
        setState('error');
      }
    } finally {
      abortRef.current = null;
    }
  }, [modelId, refresh]);

  const cancel = useCallback(() => { abortRef.current?.abort(); }, []);

  return { state, fraction, sizeBytes, error, signedIn, start, cancel };
}
