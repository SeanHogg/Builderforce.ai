/**
 * DebugCopyButton — one-click "copy everything needed to debug this generation"
 * affordance. Collects current config + last result + sample frames (base64,
 * thumbnail-resized so the paste stays manageable) into a markdown snapshot and
 * writes it to the clipboard.
 *
 * Single sink for "what does a debug paste look like" — every field needed to
 * reproduce / triage a generation lives in this one component. If a new
 * generation parameter lands, add it here too so the debug paste stays
 * authoritative.
 */

import { useCallback, useState } from 'react';
import type {
  CoherenceMode,
  DiffusionModelId,
  GenerateResult,
  ProbedDevice,
  QualityMode,
} from '@seanhogg/builderforce-studio';

export interface DebugSnapshotProps {
  prompt: string;
  expandedPrompt: string;
  /** The Quality tier the user picked (simple mode), for triage context. */
  quality: QualityMode;
  /** RESOLVED primary model that actually ran — the tier's primary OR the
   *  Advanced override — never the stale Advanced picker default. */
  model: DiffusionModelId;
  /** RESOLVED refinement model (two-pass tier), else null. Without this a
   *  "Refined" capture read `Model: lcm-tiny-sd` with no sign a second pass ran. */
  refinementModel: DiffusionModelId | null;
  resolution: number;
  frames: number;
  fps: number;
  /** Keyframe interpolation factor (1 = every frame fully generated). */
  interpolationFactor: number;
  coherenceMode: CoherenceMode;
  coherenceStrength: number;
  motionAmount: number;
  imgToImgStrength: number;
  /** Anchor-refresh interval (0 = never) bounding img2img recursion drift. */
  anchorRefreshInterval: number;
  cameraMotion: { dx: number; dy: number } | null;
  device: ProbedDevice | null;
  progressLabel: string;
  error: string | null;
  result: GenerateResult | null;
  previewFrames: ImageBitmap[];
  currentVersionId: string | null;
  /** Set true to write JSON instead of markdown — useful for machine ingest. */
  asJson?: boolean;
}

/** One-line model-chain readout for the snapshot — mirrors the panel's badge so
 *  a debug paste states exactly which model(s) ran, not a stale picker value. */
function describeModelChain(p: DebugSnapshotProps): string {
  return p.refinementModel
    ? `${p.model} → ${p.refinementModel} (two-pass)`
    : `${p.model} (single pass)`;
}

/**
 * Encode an ImageBitmap to a base64 JPEG data URL, downscaled so the longest
 * edge is at most `maxSize` pixels. Keeps the debug paste small (~5–15 KB
 * per sampled frame) while preserving enough detail to eyeball whether the
 * output drifted, lost colors, or hit a different scene per frame.
 */
async function bitmapToBase64(
  bitmap: ImageBitmap,
  maxSize = 128,
  quality = 0.6,
): Promise<string> {
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  // OffscreenCanvas works on the same WebGPU/Workers-capable browsers the
  // studio already requires (Chrome 113+ / Edge 113+), so no fallback needed.
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2d context for debug snapshot');
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  const buf = await blob.arrayBuffer();
  // btoa requires a binary string, so walk the bytes manually instead of
  // String.fromCharCode(...new Uint8Array(buf)) which blows the call stack
  // on larger buffers.
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

/** Sample first / middle / last frame so the paste shows trajectory, not just
 *  one frame. Skip when fewer than 3 frames exist — every available frame goes in. */
function pickSampleFrames(frames: ImageBitmap[]): { idx: number; bitmap: ImageBitmap }[] {
  if (frames.length === 0) return [];
  if (frames.length <= 3) return frames.map((bitmap, idx) => ({ idx, bitmap }));
  const last = frames.length - 1;
  const mid = Math.floor(last / 2);
  return [
    { idx: 0, bitmap: frames[0] },
    { idx: mid, bitmap: frames[mid] },
    { idx: last, bitmap: frames[last] },
  ];
}

async function buildMarkdownSnapshot(p: DebugSnapshotProps): Promise<string> {
  const samples = pickSampleFrames(p.previewFrames);
  const sampleLines: string[] = [];
  for (const s of samples) {
    try {
      const dataUrl = await bitmapToBase64(s.bitmap);
      sampleLines.push(`- **frame ${s.idx}** (${s.bitmap.width}×${s.bitmap.height}): ${dataUrl}`);
    } catch (err) {
      sampleLines.push(`- **frame ${s.idx}**: encode failed (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  const lines = [
    '## Builderforce Studio Debug Snapshot',
    '',
    `**Captured:** ${new Date().toISOString()}`,
    '',
    '### Hardware',
    p.device
      ? `- Device: ${p.device.kind.toUpperCase()} (${p.device.label})`
      : '- Device: (not probed yet)',
    p.device?.approxMemoryMb != null
      ? `- Approx memory: ${(p.device.approxMemoryMb / 1024).toFixed(1)} GB`
      : '- Approx memory: unknown',
    '',
    '### Configuration',
    `- Quality tier: \`${p.quality}\``,
    `- Model chain: \`${describeModelChain(p)}\``,
    `- Resolution: ${p.resolution}×${p.resolution}`,
    `- Frames: ${p.frames}, FPS: ${p.fps}, Duration: ${(p.frames / p.fps).toFixed(2)}s`,
    `- Keyframe interpolation: ${p.interpolationFactor === 1 ? 'off' : `${p.interpolationFactor}×`}`,
    '',
    '### Prompt',
    p.prompt ? `> ${p.prompt.replace(/\n/g, '\n> ')}` : '> (empty)',
    p.expandedPrompt
      ? `\n**LLM-expanded:** ${p.expandedPrompt}`
      : '',
    '',
    '### Continuity',
    `- Mamba mode: \`${p.coherenceMode}\` (strength ${p.coherenceStrength.toFixed(2)})`,
    `- motionAmount: ${p.motionAmount.toFixed(2)}`,
    `- imgToImgStrength: ${p.imgToImgStrength.toFixed(2)}`,
    `- anchorRefreshInterval: ${p.anchorRefreshInterval > 0 ? `${p.anchorRefreshInterval} keyframes` : 'off'}`,
    `- cameraMotion: ${p.cameraMotion ? `dx=${p.cameraMotion.dx}, dy=${p.cameraMotion.dy}` : 'none'}`,
    '',
    '### Version chain',
    p.currentVersionId ? `- Current: \`${p.currentVersionId}\`` : '- Current: (unsaved)',
    '',
    '### Status',
    `- Progress: ${p.progressLabel || '(idle)'}`,
    `- Error: ${p.error ?? 'none'}`,
    '',
    '### Result',
    p.result
      ? [
          `- Elapsed: ${(p.result.elapsedMs / 1000).toFixed(2)}s on ${p.result.activeDevice.toUpperCase()}`,
          `- Final frames: ${p.result.frames.length}`,
          `- Mamba step: ${p.result.mambaState.step}`,
        ].join('\n')
      : '- (no completed result yet)',
    '',
    `### Frame samples (${samples.length} of ${p.previewFrames.length}, base64 JPEG @ 128px q=0.6)`,
    ...(sampleLines.length > 0 ? sampleLines : ['- (no frames rendered)']),
  ].filter((l) => l !== '');
  return lines.join('\n');
}

async function buildJsonSnapshot(p: DebugSnapshotProps): Promise<string> {
  const samples = pickSampleFrames(p.previewFrames);
  const sampleData: { idx: number; width: number; height: number; dataUrl?: string; error?: string }[] = [];
  for (const s of samples) {
    try {
      const dataUrl = await bitmapToBase64(s.bitmap);
      sampleData.push({ idx: s.idx, width: s.bitmap.width, height: s.bitmap.height, dataUrl });
    } catch (err) {
      sampleData.push({
        idx: s.idx,
        width: s.bitmap.width,
        height: s.bitmap.height,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      device: p.device
        ? { kind: p.device.kind, label: p.device.label, approxMemoryMb: p.device.approxMemoryMb }
        : null,
      config: {
        quality: p.quality,
        model: p.model,
        refinementModel: p.refinementModel,
        modelChain: describeModelChain(p),
        resolution: p.resolution,
        frames: p.frames,
        fps: p.fps,
        interpolationFactor: p.interpolationFactor,
      },
      prompt: { user: p.prompt, expanded: p.expandedPrompt || null },
      continuity: {
        mambaMode: p.coherenceMode,
        coherenceStrength: p.coherenceStrength,
        motionAmount: p.motionAmount,
        imgToImgStrength: p.imgToImgStrength,
        anchorRefreshInterval: p.anchorRefreshInterval,
        cameraMotion: p.cameraMotion,
      },
      version: { currentId: p.currentVersionId },
      status: { progress: p.progressLabel || null, error: p.error },
      result: p.result
        ? {
            elapsedMs: p.result.elapsedMs,
            activeDevice: p.result.activeDevice,
            frames: p.result.frames.length,
            mambaStep: p.result.mambaState.step,
          }
        : null,
      frameSamples: sampleData,
    },
    null,
    2,
  );
}

export function DebugCopyButton(props: DebugSnapshotProps) {
  // 'idle' → click to copy. 'copying' → snapshot being built (can be slow if
  // many frames need encoding). 'copied' → confirmation badge for ~2s.
  const [state, setState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleCopy = useCallback(async () => {
    setState('copying');
    setErrorMsg(null);
    try {
      const snapshot = props.asJson
        ? await buildJsonSnapshot(props)
        : await buildMarkdownSnapshot(props);
      await navigator.clipboard.writeText(snapshot);
      setState('copied');
      setTimeout(() => setState('idle'), 2000);
    } catch (err) {
      setState('failed');
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setTimeout(() => setState('idle'), 4000);
    }
  }, [props]);

  const label =
    state === 'copying'
      ? 'Building snapshot…'
      : state === 'copied'
        ? '✓ Copied to clipboard'
        : state === 'failed'
          ? `Copy failed${errorMsg ? `: ${errorMsg}` : ''}`
          : 'Copy debug snapshot';

  return (
    <button
      type="button"
      className="bfs-btn bfs-btn-secondary"
      onClick={handleCopy}
      disabled={state === 'copying'}
      title="Copies prompt, all config sliders, device info, result stats, and 3 base64-encoded sample frames (first / middle / last) to the clipboard as a markdown snapshot you can paste into a debug chat."
      style={{ width: '100%' }}
    >
      {label}
    </button>
  );
}
