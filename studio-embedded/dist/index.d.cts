import * as react_jsx_runtime from 'react/jsx-runtime';
import { DiffusionModelId, CoherenceMode, MambaStateSnapshot, ProbedDevice } from '@seanhogg/builderforce-studio';
export { ActiveDevice, CoherenceMode, DeviceTarget, DiffusionModelId, GenerateOptions, GenerateResult, MODEL_REGISTRY, MambaStateSnapshot, ModelDescriptor, OnnxFile, OnnxRuntimeConfigOptions, ProbedDevice, VideoEngine, VideoEngineOptions, WeightSource, configureOnnxRuntime, hasWebGPUSupport, probeDevice } from '@seanhogg/builderforce-studio';

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
}
declare function StudioPanel({ authToken, apiKey, baseUrl, defaultModel, defaultCoherence, defaultFrames, defaultFps, onVideoGenerated, initialMambaState, hideHeader, promptValue, onPromptChange, }: StudioPanelProps): react_jsx_runtime.JSX.Element;

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
    onModeChange: (mode: CoherenceMode) => void;
    onStrengthChange: (strength: number) => void;
    onMotionAmountChange: (amount: number) => void;
    disabled?: boolean;
}
declare function CoherenceControls({ mode, strength, motionAmount, onModeChange, onStrengthChange, onMotionAmountChange, disabled, }: CoherenceControlsProps): react_jsx_runtime.JSX.Element;

interface VideoPreviewProps {
    frames: ImageBitmap[];
    videoUrl: string | null;
    width: number;
    height: number;
}
/**
 * Live preview canvas + final-video player.
 * - During generation: renders the most recent ImageBitmap onto a canvas.
 * - After generation: shows an HTML5 <video> bound to the muxed MP4 URL.
 *
 * Single component handles both states so we don't end up with two parallel
 * "render frames" code paths.
 */
declare function VideoPreview({ frames, videoUrl, width, height }: VideoPreviewProps): react_jsx_runtime.JSX.Element;

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

export { CoherenceControls, type EngineStatus, ModelPicker, StudioPanel, type StudioPanelProps, VideoPreview, useEngineStatus };
