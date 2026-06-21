/**
 * StudioPanel — the embeddable "Video Project" workspace.
 *
 * Self-gating per DRY rule: probes hardware via useEngineStatus and renders
 * an unsupported state when no WebGPU / WebNN path is reachable. Consumers
 * do not pass `hasWebGPU` or `canUseStudio` props; the panel decides.
 *
 * Composition matches the user's described flow:
 *   "Open the studio as a Video Project => see the prompt and enter what
 *    video you want to generate"
 *
 * Prompt input at the top, controls below, preview on the side, generate
 * button bottom-right. One screen, one task.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  VideoEngine,
  planScene,
  storyboardFrameCount,
  type CoherenceMode,
  type DiffusionModelId,
  type GenerateResult,
  type InterpolationBackend,
  type MambaStateSnapshot,
  type QualityMode,
  type ShotValidation,
  type Storyboard,
} from '@seanhogg/builderforce-studio';
import { ModelPicker } from './ModelPicker';
import { CoherenceControls } from './CoherenceControls';
import { VideoPreview } from './VideoPreview';
import { ProgressFeedback } from './ProgressFeedback';
import { DebugCopyButton } from './DebugCopyButton';
import {
  QualityTierPicker,
  resolveEffectiveChain,
  EffectiveChainBadge,
  CustomRefinementPicker,
} from './QualityTierPicker';
import { StoryboardEditor } from './StoryboardEditor';
import { useEngineStatus } from './useEngineStatus';

/** Parameters that fully describe ONE generated version, for the host to persist
 *  alongside the MP4 blob. Enough information to re-generate the same video AND
 *  to seed an edit-on-top pass. */
export interface VideoVersionParams {
  prompt: string;
  /** The quality tier the user picked (simple mode). Source of truth for the
   *  model pair — `model`/`refinementModel` below are the RESOLVED ids it maps
   *  to, recorded so a saved version reproduces exactly even if the tier→model
   *  mapping changes later. */
  quality: QualityMode;
  /** Resolved primary model (tier.primary in simple mode, or the explicit
   *  Advanced override). NOT the stale picker default. */
  model: DiffusionModelId;
  /** Resolved refinement model for the two-pass tier OR the Advanced custom
   *  draft→refine pair, else null. */
  refinementModel: DiffusionModelId | null;
  /** True when this version's chain came from the Advanced model override (so
   *  `refinementModel` is a CUSTOM pair, not a tier-derived one). Optional for
   *  legacy sidecars that predate the custom-chain control. */
  advanced?: boolean;
  width: number;
  height: number;
  frames: number;
  fps: number;
  /** Keyframe interpolation factor used (1 = every frame fully generated). */
  interpolationFactor: number;
  /** Interpolation backend used for tween frames — round-tripped so a saved
   *  'motion' version doesn't reload as 'latent-slerp'. */
  interpolationBackend: InterpolationBackend;
  /** True when this version was generated via the cinematic auto-storyboard path. */
  cinematic: boolean;
  /** The (possibly edited) storyboard a cinematic version rendered. Persisted so
   *  loading the version reproduces the exact shot list / cast / camera / order
   *  instead of re-planning from scratch. Null for single-clip versions. */
  storyboard: Storyboard | null;
  /** Whether VLM shot validation + self-heal was on (cinematic). */
  validate: boolean;
  coherence: CoherenceMode;
  coherenceStrength: number;
  motionAmount: number;
  imgToImgStrength: number;
  /** Anchor-refresh interval used (0 = never) to bound img2img recursion drift. */
  anchorRefreshInterval: number;
  cameraMotion: { dx: number; dy: number } | null;
  mambaState: MambaStateSnapshot;
  elapsedMs: number;
  /** Set when this version was generated as an edit of an existing version. */
  parentVersionId?: string;
}

/** Summary the host hands back so the panel can list prior versions. */
export interface VideoVersionEntry {
  id: string;
  /** Human-readable label — typically "v1", "v2", or a timestamp. */
  label: string;
  /** Saved generation params (so "load version" can restore prompt + sliders). */
  params: VideoVersionParams;
  /** Optional thumbnail (first frame) bitmap URL. */
  thumbnailUrl?: string;
}

export interface StudioPanelProps {
  /** Builderforce auth credential for the LLM gateway + R2 weight fetches.
   *  Accepts either a minted `bfk_*` API key (external npm consumers) or a
   *  tenant JWT (in-app embedders). Sent as `Authorization: Bearer <token>`. */
  authToken?: string;
  /** @deprecated Use `authToken`. Kept as an alias for 0.1.x consumers. */
  apiKey?: string;
  /** Override gateway base URL (defaults to https://api.builderforce.ai). */
  baseUrl?: string;
  /** Default diffusion backbone. Users can switch via the model picker. */
  defaultModel?: DiffusionModelId;
  /** Default coherence mode. */
  defaultCoherence?: CoherenceMode;
  /** Default frame count. */
  defaultFrames?: number;
  /** Default playback FPS. */
  defaultFps?: number;
  /** Fired when an MP4 is fully generated. */
  onVideoGenerated?: (blob: Blob, mambaState: MambaStateSnapshot) => void;
  /** Optional initial Mamba state — pass a resumed snapshot to continue a session. */
  initialMambaState?: MambaStateSnapshot;
  /** Hide the panel's own title header — for embedding inside a host that
   *  already shows project chrome (e.g. the Builderforce IDE video modality). */
  hideHeader?: boolean;
  /** Optional prompt supplied by the host (e.g. the IDE Brain). When it changes,
   *  the panel adopts it as the current prompt without auto-generating. */
  promptValue?: string;
  onPromptChange?: (prompt: string) => void;
  /** Persist a finished video version. The host owns storage (project file
   *  store, R2, IndexedDB — whatever fits). Called once per successful
   *  `generate()`. When omitted, the panel still runs but skips versioning UI. */
  onSaveVersion?: (blob: Blob, params: VideoVersionParams) => Promise<string> | string;
  /** Existing versions the host has persisted, listed in the panel's right
   *  column so the user can switch back / edit on top. Omit when versioning
   *  isn't wired — the version list and "edit on top" affordance hide. */
  versions?: VideoVersionEntry[];
  /** Called when the user picks an existing version. The host should fetch
   *  the saved MP4 blob and return it; the panel reloads its preview and
   *  restores the saved params (prompt, sliders) so the user can edit on top. */
  onLoadVersion?: (id: string) => Promise<Blob>;
}

// Square resolutions only — every supported diffusion backbone trains square.
// Ordered low → high so the lowest is always the safe default for weak GPUs
// (avoids Windows D3D12 TDR on cards that can't finish a 512×512 UNet step
// in ~2 s). Lower res = quadratically less compute per denoise step.
const RESOLUTION_PRESETS = [256, 384, 512, 768] as const;
type Resolution = (typeof RESOLUTION_PRESETS)[number];
const DEFAULT_RESOLUTION: Resolution = 256;

export function StudioPanel({
  authToken,
  apiKey,
  baseUrl,
  defaultModel = 'lcm-tiny-sd',
  defaultCoherence = 'prompt-bias',
  defaultFrames = 16,
  defaultFps = 8,
  onVideoGenerated,
  initialMambaState,
  hideHeader = false,
  promptValue,
  onPromptChange,
  onSaveVersion,
  versions,
  onLoadVersion,
}: StudioPanelProps) {
  const token = authToken ?? apiKey ?? '';
  const status = useEngineStatus();
  const engineRef = useRef<VideoEngine | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [prompt, setPrompt] = useState('');
  // Quality is the primary user-facing knob in simple mode. The picker maps
  // to (primary model, optional refinement model) via QUALITY_TIERS, so the
  // user picks "Refined" without knowing it means lcm-tiny-sd → dreamshaper.
  const [quality, setQuality] = useState<QualityMode>('fast');
  const [model, setModel] = useState<DiffusionModelId>(defaultModel);
  // Advanced-only custom refinement override. null = single pass. When set (and
  // Advanced is open) it builds an arbitrary draft → refine pair on top of the
  // Advanced `model`, generalising the fixed "Refined" tier. Resolved through
  // resolveEffectiveChain so the engine, badge, and saved params all agree.
  const [refinementOverride, setRefinementOverride] = useState<DiffusionModelId | null>(null);
  // Whether to expose the Advanced controls (model picker, sliders, coherence
  // mode, camera motion). Collapsed by default to deliver the "user just enters
  // a prompt" experience.
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [resolution, setResolution] = useState<Resolution>(DEFAULT_RESOLUTION);
  const [coherenceMode, setCoherenceMode] = useState<CoherenceMode>(defaultCoherence);
  const [coherenceStrength, setCoherenceStrength] = useState(0.5);
  // 0.15 mirrors the engine's DEFAULT_MOTION_AMOUNT — small enough that color
  // palette + composition stay locked across frames, large enough that frames
  // still evolve (subtle motion). Keep this in sync with VideoEngine's default.
  const [motionAmount, setMotionAmount] = useState(0.15);
  // Img2img recursion — off by default. When > 0, frames > 0 start from the
  // previous frame's clean latent re-noised partway through the schedule. The
  // only path inside the existing UNet weights that produces actual scene
  // PROGRESSION (camera moving, content flowing) rather than just "same shot
  // wobbling" — anchor-walk alone can't deliver "walking forward through a
  // forest path" because the model has no temporal training.
  const [imgToImgStrength, setImgToImgStrength] = useState(0);
  // Anchor-refresh interval — only meaningful with img2img recursion on. 0 =
  // never refresh (carry content forward indefinitely, may blur past ~30 frames);
  // N = restart from fresh noise every N keyframes to bound the accumulated drift.
  const [anchorRefreshInterval, setAnchorRefreshInterval] = useState(0);
  const [cameraDx, setCameraDx] = useState(0);
  const [cameraDy, setCameraDy] = useState(0);
  const [frames, setFrames] = useState(defaultFrames);
  const [fps, setFps] = useState(defaultFps);
  // Keyframe interpolation: 1 = generate every frame (slow, sharpest motion),
  // 2/4 = generate keyframes and slerp-interpolate the rest (≈Nx fewer denoise
  // passes). The feedback's "generate major scene states, interpolate between".
  const [interpolationFactor, setInterpolationFactor] = useState(1);
  // Cinematic mode: instead of one prompt → one clip, the prompt is sent to the
  // Director / Shot-Planner (planScene) which returns a multi-shot storyboard;
  // the engine renders each shot with its own camera move and threads character
  // consistency + Mamba state across shots. Off = the classic single-clip path.
  const [cinematic, setCinematic] = useState(false);
  // The planned (and user-edited) storyboard, set after the PLAN phase of
  // cinematic mode. Rendering reads from this, so edits in the StoryboardEditor
  // take effect. Cleared when cinematic is toggled off or a fresh plan starts.
  const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
  // Per-shot VLM verdicts from the last storyboard render (badges in the editor).
  const [validations, setValidations] = useState<ShotValidation[]>([]);
  // Run the VLM frame validator (+ self-healing retry) on each shot.
  const [validate, setValidate] = useState(false);
  // Which interpolation backend fills tween frames when interpolation is on.
  const [interpolationBackend, setInterpolationBackend] =
    useState<InterpolationBackend>('latent-slerp');

  // Changing the resolved model chain OR resolution invalidates the cached
  // engine — the engine is bound to (primary, refinement, resolution) at create
  // time. Dispose the old engine (releases multi-GB ORT sessions + GPUDevice) so
  // the next generate re-creates with the new params. Weights stay in IndexedDB
  // so re-init is fast. `model`/`showAdvanced`/`refinementOverride` are inputs to
  // resolveEffectiveChain, so a change to any of them must rebuild the engine.
  useEffect(() => {
    disposeEngineAndOutputs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality, resolution, model, showAdvanced, refinementOverride]);

  const [isGenerating, setIsGenerating] = useState(false);
  const [progressLabel, setProgressLabel] = useState('');
  // Frames completed in the current generation — drives the LoadingState bar
  // inside VideoPreview. Separate from previewFrames.length so we can update
  // it without forcing a bitmap render.
  const [framesDone, setFramesDone] = useState(0);
  const [expandedPrompt, setExpandedPrompt] = useState('');
  const [previewFrames, setPreviewFrames] = useState<ImageBitmap[]>([]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Tracks which existing version is currently shown / used as the edit base
  // so a new generate() saves with `parentVersionId: <currentVersionId>`.
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);

  // Adopt a host-supplied prompt (e.g. the IDE Brain hands one over).
  useEffect(() => {
    if (promptValue !== undefined && promptValue !== prompt) {
      setPrompt(promptValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptValue]);

  // Mirror state into refs so the unmount cleanup can release resources
  // without depending on stale closures.
  const previewFramesRef = useRef<ImageBitmap[]>([]);
  const resultRef = useRef<GenerateResult | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  useEffect(() => { previewFramesRef.current = previewFrames; }, [previewFrames]);
  useEffect(() => { resultRef.current = result; }, [result]);
  useEffect(() => { videoUrlRef.current = videoUrl; }, [videoUrl]);

  // Single resource-release sink — used at the start of every regenerate AND
  // on unmount. Closes ImageBitmaps (each holds GPU/CPU memory until close()),
  // revokes the MP4 blob URL, and clears the result holding the Blob.
  const releaseVideoOutputs = useCallback(() => {
    for (const bm of previewFramesRef.current) {
      try { bm.close(); } catch { /* already closed */ }
    }
    previewFramesRef.current = [];
    setPreviewFrames([]);

    const r = resultRef.current;
    if (r) {
      for (const bm of r.frames) {
        try { bm.close(); } catch { /* already closed */ }
      }
    }
    resultRef.current = null;
    setResult(null);

    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current);
      videoUrlRef.current = null;
    }
    setVideoUrl(null);
  }, []);

  // Releases all video resources AND disposes the engine (the big one —
  // multi-GB ORT sessions + GPUDevice). Fires on unmount (modality switch
  // away from video, route change) and on model/resolution change.
  const disposeEngineAndOutputs = useCallback(() => {
    releaseVideoOutputs();
    const engine = engineRef.current;
    engineRef.current = null;
    if (engine) void engine.dispose();
  }, [releaseVideoOutputs]);

  // Unmount cleanup — runs once when the StudioPanel leaves the tree.
  useEffect(() => {
    return () => {
      disposeEngineAndOutputs();
    };
  }, [disposeEngineAndOutputs]);

  const handleProgress = useCallback((label: string) => setProgressLabel(label), []);

  // Per-frame sink shared by every render path. The engine emits one onFrame
  // per finished frame (global index across shots in cinematic mode); the
  // loading bar tracks completed-frame count.
  const handleFrame = useCallback((idx: number, bitmap: ImageBitmap) => {
    setPreviewFrames((prev) => [...prev, bitmap]);
    setFramesDone(idx + 1);
  }, []);

  // Lazily create the engine, bound to the current quality tier + resolution.
  // Source of truth for tier → model id lives in QualityTierPicker.
  const ensureEngine = useCallback(async (): Promise<VideoEngine> => {
    if (engineRef.current) return engineRef.current;
    const chain = resolveEffectiveChain({
      showAdvanced,
      advancedModel: model,
      quality,
      customRefinement: refinementOverride,
    });
    const engine = await VideoEngine.create({
      apiKey: token,
      baseUrl,
      model: chain.primary,
      refinementModel: chain.refinement ?? undefined,
      mambaState: initialMambaState,
      width: resolution,
      height: resolution,
      onProgress: handleProgress,
    });
    if (!engine) throw new Error('Engine refused to start on this device.');
    engineRef.current = engine;
    return engine;
  }, [token, baseUrl, quality, showAdvanced, model, refinementOverride, initialMambaState, resolution, handleProgress]);

  // Single post-generation sink (DRY across single-clip + storyboard paths):
  // publish the video, reconcile previewFrames onto the canonical final set,
  // notify the host, and persist a version.
  const finishGeneration = useCallback(
    async (generated: GenerateResult, wasCinematic: boolean) => {
      const url = URL.createObjectURL(generated.blob);
      setVideoUrl(url);
      setResult(generated);
      // Collapse the live-accumulated previewFrames onto the canonical final
      // set. Required for the two-pass "Refined" tier (and cinematic retries):
      // onFrame fires more times than there are final frames, and the engine
      // closes the superseded bitmaps — so previewFrames can hold closed
      // bitmaps that VideoPreview's thumbnail loop would drawImage() and throw.
      // generated.frames is exactly the final set.
      setPreviewFrames(generated.frames);
      onVideoGenerated?.(generated.blob, generated.mambaState);

      if (onSaveVersion) {
        try {
          // Record the RESOLVED model pair (not the stale picker default) via
          // the same chain resolver the engine used.
          const chain = resolveEffectiveChain({
            showAdvanced,
            advancedModel: model,
            quality,
            customRefinement: refinementOverride,
          });
          const params: VideoVersionParams = {
            prompt,
            quality,
            model: chain.primary,
            refinementModel: chain.refinement,
            advanced: showAdvanced,
            width: resolution,
            height: resolution,
            frames,
            fps,
            interpolationFactor,
            interpolationBackend,
            cinematic: wasCinematic,
            // Persist the rendered storyboard so a cinematic version reloads its
            // exact edited shot list rather than re-planning.
            storyboard: wasCinematic ? storyboard : null,
            validate,
            coherence: coherenceMode,
            coherenceStrength,
            motionAmount,
            imgToImgStrength,
            anchorRefreshInterval,
            cameraMotion: imgToImgStrength > 0 && (cameraDx !== 0 || cameraDy !== 0)
              ? { dx: cameraDx, dy: cameraDy }
              : null,
            mambaState: generated.mambaState,
            elapsedMs: generated.elapsedMs,
            parentVersionId: currentVersionId ?? undefined,
          };
          const newId = await onSaveVersion(generated.blob, params);
          setCurrentVersionId(newId);
        } catch (saveErr) {
          const m = saveErr instanceof Error ? saveErr.message : String(saveErr);
          setProgressLabel((prev) => `${prev}  (version save failed: ${m})`);
        }
      }
      setProgressLabel(
        `Done in ${(generated.elapsedMs / 1000).toFixed(1)}s on ${generated.activeDevice.toUpperCase()}.`,
      );
    },
    [
      onVideoGenerated, onSaveVersion, quality, showAdvanced, model, refinementOverride, resolution, prompt,
      frames, fps, interpolationFactor, interpolationBackend, coherenceMode, coherenceStrength,
      motionAmount, imgToImgStrength, anchorRefreshInterval, cameraDx, cameraDy, currentVersionId,
      storyboard, validate,
    ],
  );

  // Shared scaffolding for any render: guards, reset, abort wiring, engine
  // create, the post-finish handler, and uniform error/cancel handling. The
  // `produce` callback is the only thing that differs between paths.
  const runGeneration = useCallback(
    async (
      produce: (engine: VideoEngine, signal: AbortSignal) => Promise<GenerateResult>,
      wasCinematic: boolean,
    ) => {
      if (status.state !== 'ready' || !token) {
        if (!token) setError('Missing Builderforce auth token (pass authToken).');
        return;
      }
      setError(null);
      setIsGenerating(true);
      setFramesDone(0);
      setProgressLabel('Initialising engine…');
      releaseVideoOutputs();
      const abort = new AbortController();
      abortRef.current = abort;
      try {
        const engine = await ensureEngine();
        const generated = await produce(engine, abort.signal);
        await finishGeneration(generated, wasCinematic);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === 'Generation aborted' || message === 'Mux aborted') {
          setProgressLabel('Cancelled.');
        } else {
          setError(message);
          setProgressLabel('');
        }
      } finally {
        setIsGenerating(false);
        abortRef.current = null;
      }
    },
    [status.state, token, releaseVideoOutputs, ensureEngine, finishGeneration],
  );

  // PLAN phase of cinematic mode: run the Director / Shot-Planner only and show
  // the editable storyboard. Rendering is a separate, explicit step so the user
  // can review/edit the plan before spending GPU time.
  const handlePlan = useCallback(async () => {
    if (status.state !== 'ready') return;
    if (!prompt.trim()) {
      setError('Enter a prompt before planning.');
      return;
    }
    if (!token) {
      setError('Missing Builderforce auth token (pass authToken).');
      return;
    }
    setError(null);
    setIsGenerating(true);
    setStoryboard(null);
    setValidations([]);
    setProgressLabel('Planning storyboard via Director + Shot Planner…');
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const planned = await planScene({
        apiKey: token,
        baseUrl,
        request: prompt,
        totalFrames: frames,
        signal: abort.signal,
      });
      setStoryboard(planned);
      setExpandedPrompt(planned.treatment);
      setProgressLabel(`Storyboard ready — ${planned.shots.length} shots. Review, then Render.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setProgressLabel('');
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [status.state, prompt, token, baseUrl, frames]);

  // RENDER phase of cinematic mode: render the (possibly edited) storyboard.
  const handleRenderStoryboard = useCallback(async () => {
    if (!storyboard) return;
    setValidations([]);
    await runGeneration(async (engine, signal) => {
      const sb = await engine.generateStoryboard({
        storyboard,
        fps,
        coherence: coherenceMode,
        coherenceStrength,
        motionAmount,
        interpolationFactor,
        interpolationBackend,
        validate,
        validatorModel: undefined,
        signal,
        onProgress: handleProgress,
        onFrame: handleFrame,
      });
      // Badges appear once render completes — the engine returns one verdict per
      // shot (first + last keyframe, after any self-healing retries).
      setValidations(sb.validations);
      return {
        blob: sb.blob,
        mambaState: sb.mambaState,
        frames: sb.frames,
        activeDevice: sb.activeDevice,
        resolvedPrompt: sb.storyboard.treatment,
        elapsedMs: sb.elapsedMs,
      };
    }, true);
  }, [
    storyboard, runGeneration, fps, coherenceMode, coherenceStrength, motionAmount,
    interpolationFactor, interpolationBackend, validate, handleProgress, handleFrame,
  ]);

  // Main Generate button. In cinematic mode it PLANS (then the editor renders);
  // otherwise it generates a single clip directly.
  const handleGenerate = useCallback(async () => {
    if (cinematic) {
      await handlePlan();
      return;
    }
    if (!prompt.trim()) {
      setError('Enter a prompt before generating.');
      return;
    }
    await runGeneration(
      (engine, signal) =>
        engine.generate({
          prompt,
          frames,
          fps,
          coherence: coherenceMode,
          coherenceStrength,
          motionAmount,
          imgToImgStrength,
          anchorRefreshInterval,
          interpolationFactor,
          interpolationBackend,
          cameraMotion:
            imgToImgStrength > 0 && (cameraDx !== 0 || cameraDy !== 0)
              ? { dx: cameraDx, dy: cameraDy }
              : undefined,
          signal,
          onPromptExpanded: setExpandedPrompt,
          onProgress: handleProgress,
          onFrame: handleFrame,
        }),
      false,
    );
  }, [
    cinematic, handlePlan, prompt, runGeneration, frames, fps, coherenceMode,
    coherenceStrength, motionAmount, imgToImgStrength, anchorRefreshInterval,
    interpolationFactor, interpolationBackend, cameraDx, cameraDy, handleProgress, handleFrame,
  ]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /**
   * Start a fresh video project: wipe the in-session continuity ("memory") and
   * working state, but KEEP saved versions on disk. Disposing the engine drops
   * its accumulated Mamba state, so the next generate re-creates from empty
   * continuity (the IDE passes no `initialMambaState`). Detaching
   * `currentVersionId` means the next save starts a new lineage with no parent,
   * instead of chaining onto whatever version was last loaded.
   *
   * Non-destructive by design: the version list (videos/v*.json + IDB blobs) is
   * the host's source of truth and is untouched here.
   */
  const handleNewProject = useCallback(() => {
    if (isGenerating) return;
    // Guard against nuking unsaved typed work / a just-generated clip.
    if (
      (prompt.trim() || result) &&
      typeof window !== 'undefined' &&
      !window.confirm(
        'Start a new video project? This clears the current prompt, preview, and continuity memory. Saved versions are kept.',
      )
    ) {
      return;
    }
    disposeEngineAndOutputs();
    setPrompt('');
    onPromptChange?.('');
    setExpandedPrompt('');
    setError(null);
    setCurrentVersionId(null);
    setFramesDone(0);
    setProgressLabel('New project — continuity memory cleared. Enter a prompt to generate v1.');
  }, [isGenerating, prompt, result, disposeEngineAndOutputs, onPromptChange]);

  const handleDownload = useCallback(() => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(result.blob);
    a.download = `builderforce-video-${Date.now()}.mp4`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, [result]);

  /**
   * Load an existing version: pull its saved blob from the host, restore its
   * params into the form (so any edit-and-regenerate starts from the same
   * settings), and mark it as the current parent so the next save chains.
   */
  const handleLoadVersion = useCallback(async (entry: VideoVersionEntry) => {
    if (!onLoadVersion) return;
    setError(null);
    setProgressLabel(`Loading ${entry.label}…`);
    try {
      const blob = await onLoadVersion(entry.id);
      releaseVideoOutputs();
      const url = URL.createObjectURL(blob);
      setVideoUrl(url);
      // Restore generation params so any subsequent re-generate / edit-on-top
      // starts from the same controls. Resolution is gated to the supported
      // preset list — fall back to the panel's current setting if the saved
      // resolution isn't one of the four presets.
      const p = entry.params;
      setPrompt(p.prompt);
      setModel(p.model);
      // Restore the Advanced disclosure + custom refinement pair so an
      // Advanced-chain version reloads with the exact (primary, refinement) pair
      // it ran. For tier-derived versions (`advanced` falsy) the refinement came
      // from the tier, so the override stays null and the tier drives the chain.
      setShowAdvanced(p.advanced ?? false);
      setRefinementOverride(p.advanced ? (p.refinementModel ?? null) : null);
      // Fields added after the first release — guard for legacy sidecars that
      // predate them (`?? default`), so loading an old version doesn't crash.
      if (p.quality) setQuality(p.quality);
      setInterpolationFactor(p.interpolationFactor ?? 1);
      setInterpolationBackend(p.interpolationBackend ?? 'latent-slerp');
      setCinematic(p.cinematic ?? false);
      setValidate(p.validate ?? false);
      // Restore the edited storyboard for cinematic versions so the editor shows
      // the exact plan that was rendered (re-render reproduces, not re-plans).
      setStoryboard(p.storyboard ?? null);
      setValidations([]);
      const knownRes = RESOLUTION_PRESETS.find((r) => r === p.width) as Resolution | undefined;
      if (knownRes) setResolution(knownRes);
      setFrames(p.frames);
      setFps(p.fps);
      setCoherenceMode(p.coherence);
      setCoherenceStrength(p.coherenceStrength);
      setMotionAmount(p.motionAmount);
      setImgToImgStrength(p.imgToImgStrength);
      // Field added after the first release — guard legacy sidecars.
      setAnchorRefreshInterval(p.anchorRefreshInterval ?? 0);
      setCameraDx(p.cameraMotion?.dx ?? 0);
      setCameraDy(p.cameraMotion?.dy ?? 0);
      setCurrentVersionId(entry.id);
      setProgressLabel(`Loaded ${entry.label} — adjust controls and Generate to make v${(versions?.length ?? 0) + 1}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Failed to load ${entry.label}: ${message}`);
      setProgressLabel('');
    }
  }, [onLoadVersion, releaseVideoOutputs, versions]);

  if (status.state === 'probing') {
    return (
      <div className="bfs-root bfs-state-probing">
        <div className="bfs-spinner" />
        <p>Probing hardware (WebNN → WebGPU → CPU)…</p>
      </div>
    );
  }

  if (status.state === 'unsupported') {
    return (
      <div className="bfs-root bfs-state-unsupported">
        <h2>AI Video Studio unavailable</h2>
        <p>{status.reason}</p>
        <p className="bfs-hint">
          Open this page in Chrome 113+ or Edge 113+ with hardware acceleration enabled.
        </p>
      </div>
    );
  }

  const device = status.device;
  // The model chain that will actually run — shared by the debug snapshot and
  // (internally) the EffectiveChainBadge, so every readout agrees.
  const effectiveChain = resolveEffectiveChain({
    showAdvanced,
    advancedModel: model,
    quality,
    customRefinement: refinementOverride,
  });

  return (
    <div className="bfs-root">
      {!hideHeader && (
        <header className="bfs-header">
          <div>
            <h1 className="bfs-title">AI Video Studio</h1>
            <p className="bfs-subtitle">
              Running on <strong>{device.label}</strong>
              {device.approxMemoryMb ? ` · ~${(device.approxMemoryMb / 1024).toFixed(1)} GB available` : ''}
            </p>
          </div>
        </header>
      )}

      <div className="bfs-grid">
        <section className="bfs-controls">
          {/* New-project / clear-memory affordance. Always visible (even when
              the host hides the header) so the user can start a fresh project —
              wiping continuity memory + working state but keeping saved versions —
              at any point. */}
          <div
            style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}
          >
            <button
              type="button"
              className="bfs-btn bfs-btn-secondary"
              onClick={handleNewProject}
              disabled={isGenerating}
              title="Clear the current prompt, preview, and continuity (Mamba) memory and start a fresh project. Saved versions are kept."
              style={{ fontSize: '0.8rem', padding: '4px 10px' }}
            >
              ＋ New project
            </button>
          </div>

          <div className="bfs-field">
            <label className="bfs-label" htmlFor="bfs-prompt">
              What video do you want to generate?
            </label>
            <textarea
              id="bfs-prompt"
              className="bfs-prompt"
              rows={4}
              placeholder="e.g. a fox running through autumn forest at golden hour, slow motion, cinematic"
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                onPromptChange?.(e.target.value);
              }}
              disabled={isGenerating}
            />
            {expandedPrompt && (
              <p className="bfs-hint">
                <strong>Expanded:</strong> {expandedPrompt}
              </p>
            )}
          </div>

          {/* Simple mode: Quality preset is the only required choice. The user
              picks "Fast / Balanced / Refined" and the engine resolves it to a
              concrete model (or two for the Refined two-pass chain). Disabled
              while an Advanced model override is in effect so the two surfaces
              can't silently contradict — the badge below states what runs. */}
          <QualityTierPicker
            value={quality}
            onChange={setQuality}
            disabled={isGenerating || showAdvanced}
          />
          {/* Single authoritative readout of the model chain that will actually
              run, flagging when Advanced has overridden the Quality tier. */}
          <EffectiveChainBadge
            showAdvanced={showAdvanced}
            advancedModel={model}
            quality={quality}
            customRefinement={refinementOverride}
          />

          {/* Cinematic mode — routes the prompt through the Director / Shot-
              Planner (planScene) into a multi-shot storyboard with per-shot
              camera moves and cross-shot character + Mamba continuity, instead
              of one prompt → one static-camera clip. */}
          <label
            className="bfs-field"
            style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={cinematic}
              onChange={(e) => {
                setCinematic(e.target.checked);
                // Toggling off clears the planned storyboard so the editor hides.
                if (!e.target.checked) {
                  setStoryboard(null);
                  setValidations([]);
                }
              }}
              disabled={isGenerating}
              style={{ marginTop: 3 }}
            />
            <span>
              <span className="bfs-label" style={{ display: 'block' }}>
                Cinematic (auto-storyboard)
              </span>
              <span className="bfs-hint">
                Plans a multi-shot scene with characters and camera moves, then renders each shot.
              </span>
            </span>
          </label>

          {/* The planned storyboard — editable before render, with per-shot VLM
              validation badges after. Only shown once a plan exists. */}
          {cinematic && storyboard && (
            <StoryboardEditor
              storyboard={storyboard}
              onChange={setStoryboard}
              onRender={handleRenderStoryboard}
              onReplan={handlePlan}
              validations={validations}
              busy={isGenerating}
            />
          )}

          {/* Advanced disclosure — power-user controls collapsed by default
              to keep the simple-mode flow uncluttered. Toggle persists per
              session via local state; could promote to a prop later. */}
          <details
            className="bfs-field"
            open={showAdvanced}
            onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
          >
            <summary
              style={{
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.85rem',
                padding: '8px 0',
                userSelect: 'none',
              }}
            >
              Advanced controls
            </summary>

            <div style={{ marginTop: 12 }}>
              <ModelPicker value={model} onChange={setModel} disabled={isGenerating} />
              <p className="bfs-hint">
                Overrides the Quality preset above. When this is set, the engine
                uses this model directly — add a refinement model below for a
                custom two-pass chain.
              </p>
            </div>

            {/* Custom two-pass override — build an arbitrary draft → refine pair
                on top of the Advanced model, generalising the fixed "Refined"
                tier (lcm-tiny-sd → lcm-dreamshaper-v7). "None" = single pass. */}
            <div style={{ marginTop: 12 }}>
              <CustomRefinementPicker
                primary={model}
                value={refinementOverride}
                onChange={setRefinementOverride}
                disabled={isGenerating}
              />
            </div>

            <div className="bfs-field" style={{ marginTop: 12 }}>
              <label className="bfs-label">Resolution</label>
              <div className="bfs-radio-row">
                {RESOLUTION_PRESETS.map((px) => {
                  const active = resolution === px;
                  return (
                    <button
                      key={px}
                      type="button"
                      onClick={() => setResolution(px)}
                      disabled={isGenerating}
                      className="bfs-btn bfs-btn-secondary"
                      aria-pressed={active}
                      style={{
                        flex: 1,
                        padding: '6px 8px',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        background: active ? 'var(--bfs-accent)' : 'transparent',
                        color: active ? 'white' : 'var(--bfs-fg)',
                        borderColor: active ? 'var(--bfs-accent)' : 'var(--bfs-border)',
                      }}
                    >
                      {px}×{px}
                    </button>
                  );
                })}
              </div>
              <p className="bfs-hint">
                Lower = faster + fits weaker GPUs (4× less compute per step at 256). Higher = sharper, more VRAM, may trip Windows GPU timeouts.
              </p>
            </div>

            <div className="bfs-row" style={{ marginTop: 12 }}>
              <div className="bfs-field bfs-flex">
                <label className="bfs-label">Frames</label>
                <input
                  type="number"
                  className="bfs-input"
                  min={1}
                  max={120}
                  value={frames}
                  onChange={(e) => setFrames(Math.max(1, Math.min(120, Number(e.target.value) || 1)))}
                  disabled={isGenerating}
                />
              </div>
              <div className="bfs-field bfs-flex">
                <label className="bfs-label">FPS</label>
                <input
                  type="number"
                  className="bfs-input"
                  min={1}
                  max={60}
                  value={fps}
                  onChange={(e) => setFps(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
                  disabled={isGenerating}
                />
              </div>
              <div className="bfs-field bfs-flex">
                <label className="bfs-label">Duration</label>
                <div className="bfs-readout">{(frames / fps).toFixed(2)}s</div>
              </div>
            </div>

            <div className="bfs-field" style={{ marginTop: 12 }}>
              <label className="bfs-label">Keyframe interpolation</label>
              <div className="bfs-radio-row">
                {[1, 2, 4].map((f) => {
                  const active = interpolationFactor === f;
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setInterpolationFactor(f)}
                      disabled={isGenerating}
                      className="bfs-btn bfs-btn-secondary"
                      aria-pressed={active}
                      style={{
                        flex: 1,
                        padding: '6px 8px',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        background: active ? 'var(--bfs-accent)' : 'transparent',
                        color: active ? 'white' : 'var(--bfs-fg)',
                        borderColor: active ? 'var(--bfs-accent)' : 'var(--bfs-border)',
                      }}
                    >
                      {f === 1 ? 'Off' : `${f}×`}
                    </button>
                  );
                })}
              </div>
              <p className="bfs-hint">
                Off = every frame fully generated (sharpest, slowest). 2×/4× generate keyframes and
                interpolate the rest — roughly N× fewer denoise passes for smooth motion.
              </p>
            </div>

            {interpolationFactor > 1 && (
              <div className="bfs-field" style={{ marginTop: 12 }}>
                <label className="bfs-label">Interpolation backend</label>
                <div className="bfs-radio-row">
                  {([
                    ['latent-slerp', 'Latent (smooth)'],
                    ['motion', 'Motion (optical flow)'],
                  ] as const).map(([id, lbl]) => {
                    const active = interpolationBackend === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setInterpolationBackend(id)}
                        disabled={isGenerating}
                        className="bfs-btn bfs-btn-secondary"
                        aria-pressed={active}
                        style={{
                          flex: 1,
                          padding: '6px 8px',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          background: active ? 'var(--bfs-accent)' : 'transparent',
                          color: active ? 'white' : 'var(--bfs-fg)',
                          borderColor: active ? 'var(--bfs-accent)' : 'var(--bfs-border)',
                        }}
                      >
                        {lbl}
                      </button>
                    );
                  })}
                </div>
                <p className="bfs-hint">
                  Latent = morph between keyframes (smooth, no motion). Motion = block optical-flow warp
                  so moving subjects actually slide between keyframes.
                </p>
              </div>
            )}

            {cinematic && (
              <label
                className="bfs-field"
                style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', marginTop: 12 }}
              >
                <input
                  type="checkbox"
                  checked={validate}
                  onChange={(e) => setValidate(e.target.checked)}
                  disabled={isGenerating}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <span className="bfs-label" style={{ display: 'block' }}>
                    Validate shots (VLM) + self-heal
                  </span>
                  <span className="bfs-hint">
                    Checks each shot's first/last keyframe against the prompt + characters via a vision
                    model, and re-renders a failing shot once with a fresh seed.
                  </span>
                </span>
              </label>
            )}

            <CoherenceControls
              mode={coherenceMode}
              strength={coherenceStrength}
              motionAmount={motionAmount}
              imgToImgStrength={imgToImgStrength}
              cameraDx={cameraDx}
              cameraDy={cameraDy}
              onModeChange={setCoherenceMode}
              onStrengthChange={setCoherenceStrength}
              onMotionAmountChange={setMotionAmount}
              onImgToImgStrengthChange={setImgToImgStrength}
              onCameraDxChange={setCameraDx}
              onCameraDyChange={setCameraDy}
              disabled={isGenerating}
            />

            {/* Anchor refresh — only relevant once img2img recursion is on,
                since it bounds THAT path's accumulating blur. Hidden otherwise
                to keep the simple cases uncluttered. */}
            {imgToImgStrength > 0 && (
              <div className="bfs-field" style={{ marginTop: 12 }}>
                <label className="bfs-label" htmlFor="bfs-anchor-refresh">
                  Anchor refresh (img2img drift bound)
                </label>
                <input
                  id="bfs-anchor-refresh"
                  type="number"
                  className="bfs-input"
                  min={0}
                  max={120}
                  value={anchorRefreshInterval}
                  onChange={(e) =>
                    setAnchorRefreshInterval(Math.max(0, Math.min(120, Number(e.target.value) || 0)))
                  }
                  disabled={isGenerating}
                />
                <p className="bfs-hint">
                  Restart from fresh noise every N keyframes so long clips don't progressively
                  blur as img2img recursion accumulates VAE round-trip error. 0 = never refresh
                  (carry content forward indefinitely). Try 8–12 for clips past ~30 frames.
                </p>
              </div>
            )}
          </details>

          <div className="bfs-actions">
            {isGenerating ? (
              <button type="button" className="bfs-btn bfs-btn-danger" onClick={handleCancel}>
                Cancel
              </button>
            ) : (
              <button
                type="button"
                className="bfs-btn bfs-btn-primary"
                onClick={handleGenerate}
                disabled={!prompt.trim()}
              >
                {cinematic
                  ? 'Plan storyboard'
                  : currentVersionId
                    ? `Generate v${(versions?.length ?? 0) + 1} (edit of current)`
                    : 'Generate video'}
              </button>
            )}
            {result && !isGenerating && (
              <button type="button" className="bfs-btn bfs-btn-secondary" onClick={handleDownload}>
                Download MP4
              </button>
            )}
          </div>
        </section>

        <section className="bfs-preview-pane">
          <VideoPreview
            frames={previewFrames}
            videoUrl={videoUrl}
            width={resolution}
            height={resolution}
            loading={
              isGenerating
                ? {
                    label: progressLabel || 'Initialising…',
                    framesDone,
                    // Cinematic mode renders the storyboard's total (sum of every
                    // shot's durationFrames), NOT the single-clip `frames` input —
                    // the engine emits one onFrame per storyboard frame, so a 50-
                    // frame storyboard would otherwise read "28 / 16". Falls back
                    // to `frames` for the single-clip path / pre-plan phase.
                    framesTotal:
                      cinematic && storyboard ? storyboardFrameCount(storyboard) : frames,
                  }
                : null
            }
          />

          {/* Single source of truth for in-flight feedback — the component
              returns null when there is nothing to show, so the row collapses
              cleanly. Moved here from under the Generate button per the
              user's "feedback belongs by the preview" UX call. */}
          <ProgressFeedback progressLabel={progressLabel} error={error} />

          {/* One-click "copy everything I'd need to debug this generation"
              snapshot — prompt + every slider + device info + result stats +
              base64 thumbnails of first/mid/last preview frames. Always
              visible so the user can grab the current config even before a
              first run completes. */}
          <div style={{ marginTop: 12 }}>
            <DebugCopyButton
              prompt={prompt}
              expandedPrompt={expandedPrompt}
              quality={quality}
              model={effectiveChain.primary}
              refinementModel={effectiveChain.refinement}
              resolution={resolution}
              frames={frames}
              fps={fps}
              interpolationFactor={interpolationFactor}
              coherenceMode={coherenceMode}
              coherenceStrength={coherenceStrength}
              motionAmount={motionAmount}
              imgToImgStrength={imgToImgStrength}
              anchorRefreshInterval={anchorRefreshInterval}
              cameraMotion={
                imgToImgStrength > 0 && (cameraDx !== 0 || cameraDy !== 0)
                  ? { dx: cameraDx, dy: cameraDy }
                  : null
              }
              device={status.state === 'ready' ? status.device : null}
              progressLabel={progressLabel}
              error={error}
              result={result}
              previewFrames={previewFrames}
              currentVersionId={currentVersionId}
            />
          </div>

          {result && (
            <dl className="bfs-meta">
              <dt>Device</dt>
              <dd>{result.activeDevice.toUpperCase()}</dd>
              <dt>Frames</dt>
              <dd>{result.frames.length}</dd>
              <dt>Mamba step</dt>
              <dd>{result.mambaState.step}</dd>
              <dt>Elapsed</dt>
              <dd>{(result.elapsedMs / 1000).toFixed(2)}s</dd>
            </dl>
          )}

          {/* Version history — only when the host wired persistence. The list
              is the host's source of truth, so the panel just renders it. */}
          {versions && versions.length > 0 ? (
            <div className="bfs-field" style={{ marginTop: 16 }}>
              <label className="bfs-label">Versions ({versions.length})</label>
              <div className="bfs-version-list">
                {versions.map((v) => {
                  const isCurrent = v.id === currentVersionId;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      className="bfs-btn bfs-btn-secondary"
                      onClick={() => handleLoadVersion(v)}
                      disabled={isGenerating || isCurrent}
                      aria-pressed={isCurrent}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        textAlign: 'left',
                        padding: '6px 10px',
                        background: isCurrent ? 'var(--bfs-accent)' : 'transparent',
                        color: isCurrent ? 'white' : 'var(--bfs-fg)',
                      }}
                    >
                      {v.thumbnailUrl ? (
                        <img
                          src={v.thumbnailUrl}
                          alt=""
                          width={32}
                          height={32}
                          style={{ borderRadius: 4, objectFit: 'cover' }}
                        />
                      ) : null}
                      <span style={{ flex: 1 }}>{v.label}</span>
                      {v.params.parentVersionId ? (
                        <span className="bfs-mono" style={{ fontSize: '0.7rem', opacity: 0.7 }}>
                          ↪ edit
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <p className="bfs-hint">
                Click a version to load it as the base. Generating again creates
                a new version with this one as parent (edit-on-top).
              </p>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
