/**
 * useSceneGeneration — orchestration for a `scene` canvas object's AI generation.
 *
 * Owns everything `CanvasSceneGeneratorPanel.tsx` would otherwise have to inline: the
 * studio engine's lifecycle (lazily imported, cached across generations, disposed when
 * the model changes or the panel unmounts), the in-flight progress/error/preview state,
 * and persisting a finished clip through the SAME storage primitive every other canvas
 * object's media uses (`storeCanvasMedia` — see its own header). This is the
 * "hook owns orchestration, component stays presentational" split the plan calls for,
 * matching how `useVideoVersions.ts` used to separate persistence from
 * `BuilderWorkspace.tsx`'s rendering for the (now retired) legacy video modality.
 *
 * Deliberately NOT `useVideoVersions`: that hook is scoped to the legacy
 * `IdeProject`/storage-project file-tree shape (`videos/v<n>.json` sidecars + an
 * IndexedDB blob store keyed by project id) and has no equivalent for a canvas object,
 * which persists its own data as a JSON patch through `onEdit`. A `scene` object's
 * generated clip is canvas MEDIA, so it is stored the way every other canvas object's
 * media is stored — `storeCanvasMedia`, uploaded into the tenant's own R2 — not
 * reinvented as a third convention.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasSceneSpec, CanvasVideoSource } from '@builderforce/creation-canvas-contract';
import { getStoredTenantToken } from '@/lib/auth';
import { getApiBaseUrl } from '@/lib/apiClient';
import { storeCanvasMedia } from '@/lib/canvasMediaStore';
// Type-only: never pulls the engine module into whatever bundle this hook lands in.
// The runtime side is a lazy `import()` inside `generate()`, below.
import type {
  DiffusionModelId,
  MambaStateSnapshot,
  VideoEngine as VideoEngineInstance,
} from '@seanhogg/builderforce-studio';

export interface UseSceneGenerationResult {
  prompt: string;
  setPrompt: (value: string) => void;
  modelId: string;
  setModelId: (value: string) => void;
  frames: number;
  setFrames: (value: number) => void;
  fps: number;
  setFps: (value: number) => void;
  isGenerating: boolean;
  progressLabel: string;
  error: string | null;
  previewFrames: ImageBitmap[];
  /** The clip to show — a fresh in-session generation if one exists this session,
   *  otherwise the object's already-persisted `output`. Never both at once. */
  videoUrl: string | null;
  output: CanvasVideoSource | undefined;
  canGenerate: boolean;
  generate: () => Promise<void>;
  cancel: () => void;
}

/** Every field `VideoEngineOptions`/`GenerateOptions` cares about that this hook does
 *  not otherwise expose a control for, sourced straight from the persisted params so a
 *  loaded `scene` reproduces the same generation. */
function buildGenerateArgs(spec: CanvasSceneSpec, prompt: string, frames: number, fps: number) {
  return {
    prompt,
    frames,
    fps,
    ...(spec.params.steps !== undefined ? { steps: spec.params.steps } : {}),
    ...(spec.params.guidance !== undefined ? { guidance: spec.params.guidance } : {}),
    ...(spec.params.negativePrompt !== undefined ? { negativePrompt: spec.params.negativePrompt } : {}),
    ...(spec.params.seed !== undefined ? { seed: spec.params.seed } : {}),
  };
}

export function useSceneGeneration(
  objectId: string,
  spec: CanvasSceneSpec,
  onChange: ((patch: Partial<CanvasSceneSpec>) => void) | undefined,
): UseSceneGenerationResult {
  const editable = Boolean(onChange);
  // Fully controlled by the bound object's own persisted state — the same convention
  // `CanvasWorldView`/`CanvasTimelineSurface` use for their own spec fields, and why
  // there is no local echo of `prompt`/`modelId`/`frames`/`fps` to keep in sync: the
  // object IS the source of truth, an edit writes through `onChange` immediately, and
  // a rebind to a different `scene` object (the surface can rebind without this
  // component unmounting) just reads that object's own fields on the next render.
  const { prompt, modelId, params: { frames, fps } } = spec;
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressLabel, setProgressLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [previewFrames, setPreviewFrames] = useState<ImageBitmap[]>([]);
  const [freshVideoUrl, setFreshVideoUrl] = useState<string | null>(null);

  // The generation-SESSION state above (preview frames, in-flight error, a fresh blob
  // URL) is NOT part of the object's persisted spec, so it does not clear itself just
  // because `spec` changed — only a genuine rebind to a DIFFERENT object should drop a
  // stale progress bar or a previous run's error.
  const boundObjectId = useRef(objectId);
  useEffect(() => {
    if (boundObjectId.current === objectId) return;
    boundObjectId.current = objectId;
    setPreviewFrames([]);
    setFreshVideoUrl(null);
    setError(null);
    setProgressLabel('');
  }, [objectId]);

  const engineRef = useRef<VideoEngineInstance | null>(null);
  const engineModelRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const freshVideoUrlRef = useRef<string | null>(null);
  useEffect(() => { freshVideoUrlRef.current = freshVideoUrl; }, [freshVideoUrl]);

  const disposeEngine = useCallback(() => {
    const engine = engineRef.current;
    engineRef.current = null;
    engineModelRef.current = null;
    if (engine) void engine.dispose();
  }, []);

  // Release the engine (multi-GB ORT session + GPU device) and the blob URL on
  // unmount — mirrors StudioPanel's own cleanup discipline.
  useEffect(() => () => {
    disposeEngine();
    if (freshVideoUrlRef.current) URL.revokeObjectURL(freshVideoUrlRef.current);
  }, [disposeEngine]);

  const commit = useCallback((patch: Partial<CanvasSceneSpec>) => onChange?.(patch), [onChange]);

  const setPrompt = useCallback((value: string) => commit({ prompt: value }), [commit]);
  const setModelId = useCallback((value: string) => commit({ modelId: value }), [commit]);
  const setFrames = useCallback((value: number) => commit({ params: { ...spec.params, frames: value } }), [commit, spec.params]);
  const setFps = useCallback((value: number) => commit({ params: { ...spec.params, fps: value } }), [commit, spec.params]);

  const cancel = useCallback(() => { abortRef.current?.abort(); }, []);

  const generate = useCallback(async () => {
    if (!editable || isGenerating || !prompt.trim() || !modelId) return;
    setError(null);
    setIsGenerating(true);
    setProgressLabel('Initialising engine…');
    setPreviewFrames([]);
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      // Lazy — never in the main bundle unless Generate is actually pressed. Loading
      // it here (rather than only at module scope) is what keeps the multi-hundred-MB
      // engine + weight-cache machinery out of every canvas session that never opens a
      // `scene` object, matching the code-split discipline `webdit-engine.ts` uses for
      // its own runtime import (Layer 1).
      const { VideoEngine } = await import('@seanhogg/builderforce-studio');

      if (engineRef.current && engineModelRef.current !== modelId) disposeEngine();
      let engine = engineRef.current;
      if (!engine) {
        engine = await VideoEngine.create({
          apiKey: getStoredTenantToken() ?? '',
          baseUrl: getApiBaseUrl(),
          model: modelId as DiffusionModelId,
          // Opaque at the contract layer (`unknown`) — narrowed here, at the one
          // boundary that actually knows the shape, rather than widening the
          // contract's own type just to satisfy this call site.
          ...(spec.mambaState !== undefined ? { mambaState: spec.mambaState as MambaStateSnapshot } : {}),
          onProgress: setProgressLabel,
        });
        if (!engine) throw new Error('This device cannot run AI generation — WebGPU is required.');
        engineRef.current = engine;
        engineModelRef.current = modelId;
      }

      const result = await engine.generate({
        ...buildGenerateArgs(spec, prompt, frames, fps),
        onFrame: (_frameIdx: number, bitmap: ImageBitmap) => setPreviewFrames((prev) => [...prev, bitmap]),
        onProgress: setProgressLabel,
        signal: abort.signal,
      });

      if (freshVideoUrlRef.current) URL.revokeObjectURL(freshVideoUrlRef.current);
      const url = URL.createObjectURL(result.blob);
      freshVideoUrlRef.current = url;
      setFreshVideoUrl(url);
      setPreviewFrames(result.frames);
      setProgressLabel(`Done in ${(result.elapsedMs / 1000).toFixed(1)}s.`);

      // Persist the clip the same way every other canvas object's media is stored —
      // never a second storage convention for this one kind.
      const label = spec.prompt.trim().slice(0, 40) || 'scene';
      const file = new File([result.blob], `${label}.mp4`, { type: result.blob.type || 'video/mp4' });
      const output = await storeCanvasMedia(file, 'ai');
      commit({ output, mambaState: result.mambaState });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'Generation aborted') setProgressLabel('Cancelled.');
      else { setError(message); setProgressLabel(''); }
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [editable, isGenerating, prompt, modelId, frames, fps, spec, disposeEngine, commit]);

  return {
    prompt, setPrompt,
    modelId, setModelId,
    frames, setFrames,
    fps, setFps,
    isGenerating, progressLabel, error, previewFrames,
    videoUrl: freshVideoUrl ?? spec.output?.url ?? null,
    output: spec.output,
    canGenerate: editable && !isGenerating && Boolean(prompt.trim()) && Boolean(modelId),
    generate, cancel,
  };
}
