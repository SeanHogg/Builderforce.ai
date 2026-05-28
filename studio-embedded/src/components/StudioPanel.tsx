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
  type CoherenceMode,
  type DiffusionModelId,
  type GenerateResult,
  type MambaStateSnapshot,
} from '@seanhogg/builderforce-studio';
import { ModelPicker } from './ModelPicker';
import { CoherenceControls } from './CoherenceControls';
import { VideoPreview } from './VideoPreview';
import { useEngineStatus } from './useEngineStatus';

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
}

const DEFAULT_WIDTH = 512;
const DEFAULT_HEIGHT = 512;

export function StudioPanel({
  authToken,
  apiKey,
  baseUrl,
  defaultModel = 'lcm-dreamshaper-v7',
  defaultCoherence = 'prompt-bias',
  defaultFrames = 16,
  defaultFps = 8,
  onVideoGenerated,
  initialMambaState,
  hideHeader = false,
  promptValue,
  onPromptChange,
}: StudioPanelProps) {
  const token = authToken ?? apiKey ?? '';
  const status = useEngineStatus();
  const engineRef = useRef<VideoEngine | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState<DiffusionModelId>(defaultModel);
  const [coherenceMode, setCoherenceMode] = useState<CoherenceMode>(defaultCoherence);
  const [coherenceStrength, setCoherenceStrength] = useState(0.5);
  const [frames, setFrames] = useState(defaultFrames);
  const [fps, setFps] = useState(defaultFps);

  const [isGenerating, setIsGenerating] = useState(false);
  const [progressLabel, setProgressLabel] = useState('');
  const [expandedPrompt, setExpandedPrompt] = useState('');
  const [previewFrames, setPreviewFrames] = useState<ImageBitmap[]>([]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Adopt a host-supplied prompt (e.g. the IDE Brain hands one over).
  useEffect(() => {
    if (promptValue !== undefined && promptValue !== prompt) {
      setPrompt(promptValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptValue]);

  // Revoke object URLs on unmount so we don't leak blob references.
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  const handleGenerate = useCallback(async () => {
    if (status.state !== 'ready') return;
    if (!prompt.trim()) {
      setError('Enter a prompt before generating.');
      return;
    }
    if (!token) {
      setError('Missing Builderforce auth token (pass authToken).');
      return;
    }

    setError(null);
    setIsGenerating(true);
    setProgressLabel('Initialising engine…');
    setPreviewFrames([]);
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
      setVideoUrl(null);
    }
    setResult(null);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      if (!engineRef.current) {
        const engine = await VideoEngine.create({
          apiKey: token,
          baseUrl,
          model,
          mambaState: initialMambaState,
          width: DEFAULT_WIDTH,
          height: DEFAULT_HEIGHT,
        });
        if (!engine) {
          throw new Error('Engine refused to start on this device.');
        }
        engineRef.current = engine;
      }

      setProgressLabel('Expanding prompt via Builderforce LLM…');
      const generated = await engineRef.current.generate({
        prompt,
        frames,
        fps,
        coherence: coherenceMode,
        coherenceStrength,
        signal: abort.signal,
        onPromptExpanded: (expanded) => {
          setExpandedPrompt(expanded);
          setProgressLabel('Generating frames…');
        },
        onFrame: (idx, bitmap) => {
          setPreviewFrames((prev) => [...prev, bitmap]);
          setProgressLabel(`Frame ${idx + 1} / ${frames}`);
        },
      });

      const url = URL.createObjectURL(generated.blob);
      setVideoUrl(url);
      setResult(generated);
      onVideoGenerated?.(generated.blob, generated.mambaState);
      setProgressLabel(`Done in ${(generated.elapsedMs / 1000).toFixed(1)}s on ${generated.activeDevice.toUpperCase()}.`);
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
  }, [
    token,
    baseUrl,
    coherenceMode,
    coherenceStrength,
    fps,
    frames,
    initialMambaState,
    model,
    onVideoGenerated,
    prompt,
    status.state,
    videoUrl,
  ]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleDownload = useCallback(() => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(result.blob);
    a.download = `builderforce-video-${Date.now()}.mp4`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, [result]);

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

          <ModelPicker value={model} onChange={setModel} disabled={isGenerating} />

          <div className="bfs-row">
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

          <CoherenceControls
            mode={coherenceMode}
            strength={coherenceStrength}
            onModeChange={setCoherenceMode}
            onStrengthChange={setCoherenceStrength}
            disabled={isGenerating}
          />

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
                Generate video
              </button>
            )}
            {result && !isGenerating && (
              <button type="button" className="bfs-btn bfs-btn-secondary" onClick={handleDownload}>
                Download MP4
              </button>
            )}
          </div>

          {progressLabel && <p className="bfs-progress">{progressLabel}</p>}
          {error && <p className="bfs-error">{error}</p>}
        </section>

        <section className="bfs-preview-pane">
          <VideoPreview
            frames={previewFrames}
            videoUrl={videoUrl}
            width={DEFAULT_WIDTH}
            height={DEFAULT_HEIGHT}
          />
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
        </section>
      </div>
    </div>
  );
}
