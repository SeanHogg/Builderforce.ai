import * as react_jsx_runtime from 'react/jsx-runtime';
import { DiffusionModelId, CoherenceMode, MambaStateSnapshot, QualityMode, InterpolationBackend, Storyboard, ProbedDevice, GenerateResult, ShotValidation } from '@seanhogg/builderforce-studio';
export { ActiveDevice, CAMERA_MOVES, CameraMove, CharacterBible, CoherenceMode, DeviceTarget, DiffusionModelId, FrameValidation, GenerateOptions, GenerateResult, InterpolationBackend, MODEL_REGISTRY, MambaStateSnapshot, ModelDescriptor, OnnxFile, OnnxRuntimeConfigOptions, PlannedShot, ProbedDevice, QualityMode, ScenePlanOptions, ShotValidation, Storyboard, StoryboardGenerateOptions, StoryboardGenerateResult, VideoEngine, VideoEngineOptions, WeightSource, configureOnnxRuntime, hasWebGPUSupport, planScene, probeDevice } from '@seanhogg/builderforce-studio';

/** Parameters that fully describe ONE generated version, for the host to persist
 *  alongside the MP4 blob. Enough information to re-generate the same video AND
 *  to seed an edit-on-top pass. */
interface VideoVersionParams {
    prompt: string;
    /** The quality tier the user picked (simple mode). Source of truth for the
     *  model pair — `model`/`refinementModel` below are the RESOLVED ids it maps
     *  to, recorded so a saved version reproduces exactly even if the tier→model
     *  mapping changes later. */
    quality: QualityMode;
    /** Resolved primary model (tier.primary in simple mode, or the explicit
     *  Advanced override). NOT the stale picker default. */
    model: DiffusionModelId;
    /** Resolved refinement model for the two-pass tier, else null. */
    refinementModel: DiffusionModelId | null;
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
    cameraMotion: {
        dx: number;
        dy: number;
    } | null;
    mambaState: MambaStateSnapshot;
    elapsedMs: number;
    /** Set when this version was generated as an edit of an existing version. */
    parentVersionId?: string;
}
/** Summary the host hands back so the panel can list prior versions. */
interface VideoVersionEntry {
    id: string;
    /** Human-readable label — typically "v1", "v2", or a timestamp. */
    label: string;
    /** Saved generation params (so "load version" can restore prompt + sliders). */
    params: VideoVersionParams;
    /** Optional thumbnail (first frame) bitmap URL. */
    thumbnailUrl?: string;
}
interface StudioPanelProps {
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
declare function StudioPanel({ authToken, apiKey, baseUrl, defaultModel, defaultCoherence, defaultFrames, defaultFps, onVideoGenerated, initialMambaState, hideHeader, promptValue, onPromptChange, onSaveVersion, versions, onLoadVersion, }: StudioPanelProps): react_jsx_runtime.JSX.Element;

interface ModelPickerProps {
    value: DiffusionModelId;
    onChange: (next: DiffusionModelId) => void;
    disabled?: boolean;
}
declare function ModelPicker({ value, onChange, disabled }: ModelPickerProps): react_jsx_runtime.JSX.Element;

interface CoherenceControlsProps {
    mode: CoherenceMode;
    strength: number;
    motionAmount: number;
    imgToImgStrength: number;
    cameraDx: number;
    cameraDy: number;
    onModeChange: (mode: CoherenceMode) => void;
    onStrengthChange: (strength: number) => void;
    onMotionAmountChange: (amount: number) => void;
    onImgToImgStrengthChange: (strength: number) => void;
    onCameraDxChange: (dx: number) => void;
    onCameraDyChange: (dy: number) => void;
    disabled?: boolean;
}
declare function CoherenceControls({ mode, strength, motionAmount, imgToImgStrength, cameraDx, cameraDy, onModeChange, onStrengthChange, onMotionAmountChange, onImgToImgStrengthChange, onCameraDxChange, onCameraDyChange, disabled, }: CoherenceControlsProps): react_jsx_runtime.JSX.Element;

interface VideoPreviewProps {
    frames: ImageBitmap[];
    videoUrl: string | null;
    width: number;
    height: number;
    /** Renders the loading state (progress bar + label) during generation. When
     *  null, the preview shows either the final video or the empty hint. */
    loading?: {
        label: string;
        framesDone: number;
        framesTotal: number;
    } | null;
}
/**
 * Three states, one component (DRY — consumer never branches on which one):
 *
 *   1. loading != null            → progress bar + label, no per-frame preview.
 *                                    Per-frame canvas was visually noisy
 *                                    (frames pop in at varying quality during
 *                                    LCM denoise, looks like a glitch). The
 *                                    progress bar reads as "the engine is
 *                                    working" without distracting noise.
 *   2. videoUrl set               → <video> player + clickable thumbnail strip
 *                                    so the user can scrub the result.
 *   3. neither                    → empty hint.
 *
 * Click a thumbnail → seeks the video to that frame. Lets the user inspect
 * any single frame without scrubbing the timeline pixel-perfectly.
 */
declare function VideoPreview({ frames, videoUrl, width, height, loading }: VideoPreviewProps): react_jsx_runtime.JSX.Element;

/**
 * ProgressFeedback — single rendering site for the studio's per-phase progress
 * label + per-run error message.
 *
 * Self-gating per DRY rule: returns `null` when there is nothing to show, so
 * consumers do not branch on `{progress || error ? <ProgressFeedback .../> : null}`
 * — they just always mount it. One source of truth for "what does in-flight
 * feedback look like in this panel," used wherever feedback needs to surface
 * (today: right-column under the video preview; previously: left column under
 * Generate Video; future: a status toast).
 */
interface ProgressFeedbackProps {
    progressLabel: string;
    error: string | null;
}
declare function ProgressFeedback({ progressLabel, error }: ProgressFeedbackProps): react_jsx_runtime.JSX.Element | null;

interface DebugSnapshotProps {
    prompt: string;
    expandedPrompt: string;
    model: DiffusionModelId;
    resolution: number;
    frames: number;
    fps: number;
    coherenceMode: CoherenceMode;
    coherenceStrength: number;
    motionAmount: number;
    imgToImgStrength: number;
    cameraMotion: {
        dx: number;
        dy: number;
    } | null;
    device: ProbedDevice | null;
    progressLabel: string;
    error: string | null;
    result: GenerateResult | null;
    previewFrames: ImageBitmap[];
    currentVersionId: string | null;
    /** Set true to write JSON instead of markdown — useful for machine ingest. */
    asJson?: boolean;
}
declare function DebugCopyButton(props: DebugSnapshotProps): react_jsx_runtime.JSX.Element;

interface QualityTierDef {
    id: QualityMode;
    label: string;
    primary: DiffusionModelId;
    refinement?: DiffusionModelId;
    description: string;
}
declare const QUALITY_TIERS: readonly QualityTierDef[];
/** Resolve a tier id to (primary, refinement) so the consumer can pass them
 *  to `VideoEngine.create`. Falls back to fast if the id is unknown. */
declare function resolveQualityTier(tier: QualityMode): {
    primary: DiffusionModelId;
    refinement: DiffusionModelId | undefined;
};
interface QualityTierPickerProps {
    value: QualityMode;
    onChange: (mode: QualityMode) => void;
    disabled?: boolean;
}
declare function QualityTierPicker({ value, onChange, disabled }: QualityTierPickerProps): react_jsx_runtime.JSX.Element;

interface StoryboardEditorProps {
    storyboard: Storyboard;
    onChange: (next: Storyboard) => void;
    onRender: () => void;
    onReplan: () => void;
    /** Validation verdicts keyed by shot id, shown as badges after a render. */
    validations?: ShotValidation[];
    /** True while planning or rendering — disables editing + buttons. */
    busy?: boolean;
}
declare function StoryboardEditor({ storyboard, onChange, onRender, onReplan, validations, busy, }: StoryboardEditorProps): react_jsx_runtime.JSX.Element;

/**
 * Shared engine-readiness hook — the single source of "can the host run the studio?"
 * Both StudioPanel and any third-party consumer using engine-only mode should
 * read engine status through this hook. Eliminates duplicated WebGPU/WebNN
 * detection branching (DRY) and matches the project's "no canX prop" rule.
 */

type EngineStatus = {
    state: 'probing';
} | {
    state: 'ready';
    device: ProbedDevice;
} | {
    state: 'unsupported';
    reason: string;
};
declare function useEngineStatus(): EngineStatus;

export { CoherenceControls, DebugCopyButton, type DebugSnapshotProps, type EngineStatus, ModelPicker, ProgressFeedback, QUALITY_TIERS, QualityTierPicker, StoryboardEditor, StudioPanel, type StudioPanelProps, VideoPreview, type VideoVersionEntry, type VideoVersionParams, resolveQualityTier, useEngineStatus };
