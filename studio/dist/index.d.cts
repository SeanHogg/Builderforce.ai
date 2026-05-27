import { a as DiffusionModelId, C as CoherenceMode, c as MambaStateSnapshot, P as ProbedDevice } from './index-5vZh6pTw.cjs';
export { A as ActiveDevice, D as DeviceTarget, G as GenerateOptions, b as GenerateResult, M as MODEL_REGISTRY, d as ModelDescriptor, V as VideoEngine, e as VideoEngineOptions, W as WeightSource, h as hasWebGPUSupport, p as probeDevice } from './index-5vZh6pTw.cjs';
import * as react_jsx_runtime from 'react/jsx-runtime';

interface StudioPanelProps {
    /** Builderforce API key. Used both for LLM prompt expansion and R2 weight fetches. */
    apiKey: string;
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
}
declare function StudioPanel({ apiKey, baseUrl, defaultModel, defaultCoherence, defaultFrames, defaultFps, onVideoGenerated, initialMambaState, }: StudioPanelProps): react_jsx_runtime.JSX.Element;

interface ModelPickerProps {
    value: DiffusionModelId;
    onChange: (next: DiffusionModelId) => void;
    disabled?: boolean;
}
declare function ModelPicker({ value, onChange, disabled }: ModelPickerProps): react_jsx_runtime.JSX.Element;

interface CoherenceControlsProps {
    mode: CoherenceMode;
    strength: number;
    onModeChange: (mode: CoherenceMode) => void;
    onStrengthChange: (strength: number) => void;
    disabled?: boolean;
}
declare function CoherenceControls({ mode, strength, onModeChange, onStrengthChange, disabled, }: CoherenceControlsProps): react_jsx_runtime.JSX.Element;

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

export { CoherenceControls, CoherenceMode, DiffusionModelId, type EngineStatus, MambaStateSnapshot, ModelPicker, StudioPanel, type StudioPanelProps, VideoPreview, useEngineStatus };
