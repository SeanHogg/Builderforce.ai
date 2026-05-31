// src/components/StudioPanel.tsx
import { useCallback as useCallback2, useEffect as useEffect3, useRef as useRef3, useState as useState3 } from "react";
import {
  VideoEngine
} from "@seanhogg/builderforce-studio";

// src/components/ModelPicker.tsx
import { MODEL_REGISTRY } from "@seanhogg/builderforce-studio";
import { jsx, jsxs } from "react/jsx-runtime";
var MODEL_LABELS = {
  "lcm-tiny-sd": "LCM Tiny SD \u2014 4-step, lightest (~2 GB, fp16)",
  "sd-turbo": "SD-Turbo \u2014 1-step, fastest (~4 GB)",
  "lcm-dreamshaper-v7": "LCM Dreamshaper v7 \u2014 4-step, best quality (~6 GB)"
};
function ModelPicker({ value, onChange, disabled }) {
  const entries = Object.keys(MODEL_REGISTRY);
  return /* @__PURE__ */ jsxs("div", { className: "bfs-field", children: [
    /* @__PURE__ */ jsx("label", { className: "bfs-label", children: "Diffusion model" }),
    /* @__PURE__ */ jsx(
      "select",
      {
        className: "bfs-select",
        value,
        onChange: (e) => onChange(e.target.value),
        disabled,
        children: entries.map((id) => /* @__PURE__ */ jsx("option", { value: id, children: MODEL_LABELS[id] }, id))
      }
    ),
    /* @__PURE__ */ jsxs("p", { className: "bfs-hint", children: [
      MODEL_REGISTRY[value].defaultSteps,
      " step",
      MODEL_REGISTRY[value].defaultSteps > 1 ? "s" : "",
      " ",
      "\xB7 ~",
      Math.round(MODEL_REGISTRY[value].minVramMb / 1024),
      " GB VRAM minimum"
    ] })
  ] });
}

// src/components/CoherenceControls.tsx
import { Fragment, jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var MODE_DESCRIPTIONS = {
  "prompt-bias": "Mamba state biases the prompt embedding. Lightweight, works with any U-Net.",
  "latent-residual": "Mamba state biases the initial latent noise. Stronger temporal lock, slightly more compute."
};
function LabeledRange(props) {
  return /* @__PURE__ */ jsxs2(Fragment, { children: [
    /* @__PURE__ */ jsxs2("label", { className: "bfs-label", style: props.marginTop ? { marginTop: props.marginTop } : void 0, children: [
      props.label,
      ": ",
      /* @__PURE__ */ jsx2("span", { className: "bfs-mono", children: props.value.toFixed(2) })
    ] }),
    /* @__PURE__ */ jsx2(
      "input",
      {
        type: "range",
        min: props.min,
        max: props.max,
        step: props.step,
        value: props.value,
        onChange: (e) => props.onChange(Number(e.target.value)),
        disabled: props.disabled,
        className: "bfs-range"
      }
    ),
    /* @__PURE__ */ jsx2("p", { className: "bfs-hint", children: props.hint })
  ] });
}
function CoherenceControls({
  mode,
  strength,
  motionAmount,
  imgToImgStrength,
  cameraDx,
  cameraDy,
  onModeChange,
  onStrengthChange,
  onMotionAmountChange,
  onImgToImgStrengthChange,
  onCameraDxChange,
  onCameraDyChange,
  disabled
}) {
  const img2imgOn = imgToImgStrength > 0;
  return /* @__PURE__ */ jsxs2("div", { className: "bfs-field", children: [
    /* @__PURE__ */ jsx2("label", { className: "bfs-label", children: "Temporal coherence (Mamba state)" }),
    /* @__PURE__ */ jsx2("div", { className: "bfs-radio-row", children: ["prompt-bias", "latent-residual"].map((m) => /* @__PURE__ */ jsxs2("label", { className: "bfs-radio", children: [
      /* @__PURE__ */ jsx2(
        "input",
        {
          type: "radio",
          name: "bfs-coherence",
          value: m,
          checked: mode === m,
          onChange: () => onModeChange(m),
          disabled
        }
      ),
      /* @__PURE__ */ jsx2("span", { children: m === "prompt-bias" ? "Prompt bias" : "Latent residual" })
    ] }, m)) }),
    /* @__PURE__ */ jsx2("p", { className: "bfs-hint", children: MODE_DESCRIPTIONS[mode] }),
    /* @__PURE__ */ jsx2(
      LabeledRange,
      {
        label: "Coherence strength",
        value: strength,
        min: 0,
        max: 1,
        step: 0.05,
        marginTop: 12,
        disabled,
        onChange: onStrengthChange,
        hint: "0 = i.i.d. frames \xB7 1 = maximum lock to previous frame."
      }
    ),
    /* @__PURE__ */ jsx2(
      LabeledRange,
      {
        label: `Motion amount${img2imgOn ? " (ignored \u2014 img2img on)" : ""}`,
        value: motionAmount,
        min: 0,
        max: 1,
        step: 0.05,
        marginTop: 12,
        disabled: disabled || img2imgOn,
        onChange: onMotionAmountChange,
        hint: "Per-frame noise mixed into the shared anchor latent. 0 = a still image looped \xB7 0.15 = subtle motion, stable colors (default) \xB7 1 = each frame is a fresh interpretation of the prompt (no continuity). Disabled when img2img recursion is on."
      }
    ),
    /* @__PURE__ */ jsx2(
      LabeledRange,
      {
        label: "Img2img recursion",
        value: imgToImgStrength,
        min: 0,
        max: 1,
        step: 0.05,
        marginTop: 12,
        disabled,
        onChange: onImgToImgStrengthChange,
        hint: "Frames > 0 start from the previous frame's clean latent re-noised partway through the schedule. 0 = off (anchor-walk only, no scene progression) \xB7 0.5 = strong continuity, slow evolution \xB7 0.7 = moderate continuity, more evolution. Use this for 'walking through a scene' prompts that anchor-walk alone can't deliver. Drifts/blurs after ~30 frames."
      }
    ),
    img2imgOn ? /* @__PURE__ */ jsxs2(Fragment, { children: [
      /* @__PURE__ */ jsx2("label", { className: "bfs-label", style: { marginTop: 12 }, children: "Camera motion (latent shift, 1 unit = 8 pixels)" }),
      /* @__PURE__ */ jsxs2("div", { className: "bfs-row", style: { gap: 12 }, children: [
        /* @__PURE__ */ jsxs2("label", { className: "bfs-label", style: { flex: 1 }, children: [
          "dx ",
          /* @__PURE__ */ jsx2("span", { className: "bfs-mono", children: cameraDx }),
          /* @__PURE__ */ jsx2(
            "input",
            {
              type: "number",
              value: cameraDx,
              min: -8,
              max: 8,
              step: 1,
              onChange: (e) => onCameraDxChange(Number(e.target.value) | 0),
              disabled,
              className: "bfs-input"
            }
          )
        ] }),
        /* @__PURE__ */ jsxs2("label", { className: "bfs-label", style: { flex: 1 }, children: [
          "dy ",
          /* @__PURE__ */ jsx2("span", { className: "bfs-mono", children: cameraDy }),
          /* @__PURE__ */ jsx2(
            "input",
            {
              type: "number",
              value: cameraDy,
              min: -8,
              max: 8,
              step: 1,
              onChange: (e) => onCameraDyChange(Number(e.target.value) | 0),
              disabled,
              className: "bfs-input"
            }
          )
        ] })
      ] }),
      /* @__PURE__ */ jsx2("p", { className: "bfs-hint", children: 'Per-frame shift on the prior latent before re-noising. For "walking forward on a path" try dy = -1 (slight upward tilt) or dy = 1 (looking slightly down at the ground passing under).' })
    ] }) : null
  ] });
}

// src/components/VideoPreview.tsx
import { useEffect, useRef } from "react";
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
function VideoPreview({ frames, videoUrl, width, height }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (videoUrl) return;
    const canvas = canvasRef.current;
    if (!canvas || frames.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const latest = frames[frames.length - 1];
    ctx.drawImage(latest, 0, 0, canvas.width, canvas.height);
  }, [frames, videoUrl]);
  return /* @__PURE__ */ jsxs3("div", { className: "bfs-preview", style: { aspectRatio: `${width} / ${height}` }, children: [
    videoUrl ? /* @__PURE__ */ jsx3("video", { src: videoUrl, controls: true, autoPlay: true, loop: true, className: "bfs-preview-video" }) : /* @__PURE__ */ jsx3("canvas", { ref: canvasRef, width, height, className: "bfs-preview-canvas" }),
    !videoUrl && frames.length === 0 && /* @__PURE__ */ jsx3("div", { className: "bfs-preview-empty", children: "Preview will appear here as frames generate." })
  ] });
}

// src/components/ProgressFeedback.tsx
import { jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
function ProgressFeedback({ progressLabel, error }) {
  if (!progressLabel && !error) return null;
  return /* @__PURE__ */ jsxs4("div", { className: "bfs-progress-feedback", children: [
    progressLabel ? /* @__PURE__ */ jsx4("p", { className: "bfs-progress", children: progressLabel }) : null,
    error ? /* @__PURE__ */ jsx4("p", { className: "bfs-error", children: error }) : null
  ] });
}

// src/components/DebugCopyButton.tsx
import { useCallback, useState } from "react";
import { jsx as jsx5 } from "react/jsx-runtime";
async function bitmapToBase64(bitmap, maxSize = 128, quality = 0.6) {
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2d context for debug snapshot");
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  const buf = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return `data:image/jpeg;base64,${btoa(binary)}`;
}
function pickSampleFrames(frames) {
  if (frames.length === 0) return [];
  if (frames.length <= 3) return frames.map((bitmap, idx) => ({ idx, bitmap }));
  const last = frames.length - 1;
  const mid = Math.floor(last / 2);
  return [
    { idx: 0, bitmap: frames[0] },
    { idx: mid, bitmap: frames[mid] },
    { idx: last, bitmap: frames[last] }
  ];
}
async function buildMarkdownSnapshot(p) {
  const samples = pickSampleFrames(p.previewFrames);
  const sampleLines = [];
  for (const s of samples) {
    try {
      const dataUrl = await bitmapToBase64(s.bitmap);
      sampleLines.push(`- **frame ${s.idx}** (${s.bitmap.width}\xD7${s.bitmap.height}): ${dataUrl}`);
    } catch (err) {
      sampleLines.push(`- **frame ${s.idx}**: encode failed (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  const lines = [
    "## Builderforce Studio Debug Snapshot",
    "",
    `**Captured:** ${(/* @__PURE__ */ new Date()).toISOString()}`,
    "",
    "### Hardware",
    p.device ? `- Device: ${p.device.kind.toUpperCase()} (${p.device.label})` : "- Device: (not probed yet)",
    p.device?.approxMemoryMb != null ? `- Approx memory: ${(p.device.approxMemoryMb / 1024).toFixed(1)} GB` : "- Approx memory: unknown",
    "",
    "### Configuration",
    `- Model: \`${p.model}\``,
    `- Resolution: ${p.resolution}\xD7${p.resolution}`,
    `- Frames: ${p.frames}, FPS: ${p.fps}, Duration: ${(p.frames / p.fps).toFixed(2)}s`,
    "",
    "### Prompt",
    p.prompt ? `> ${p.prompt.replace(/\n/g, "\n> ")}` : "> (empty)",
    p.expandedPrompt ? `
**LLM-expanded:** ${p.expandedPrompt}` : "",
    "",
    "### Continuity",
    `- Mamba mode: \`${p.coherenceMode}\` (strength ${p.coherenceStrength.toFixed(2)})`,
    `- motionAmount: ${p.motionAmount.toFixed(2)}`,
    `- imgToImgStrength: ${p.imgToImgStrength.toFixed(2)}`,
    `- cameraMotion: ${p.cameraMotion ? `dx=${p.cameraMotion.dx}, dy=${p.cameraMotion.dy}` : "none"}`,
    "",
    "### Version chain",
    p.currentVersionId ? `- Current: \`${p.currentVersionId}\`` : "- Current: (unsaved)",
    "",
    "### Status",
    `- Progress: ${p.progressLabel || "(idle)"}`,
    `- Error: ${p.error ?? "none"}`,
    "",
    "### Result",
    p.result ? [
      `- Elapsed: ${(p.result.elapsedMs / 1e3).toFixed(2)}s on ${p.result.activeDevice.toUpperCase()}`,
      `- Final frames: ${p.result.frames.length}`,
      `- Mamba step: ${p.result.mambaState.step}`
    ].join("\n") : "- (no completed result yet)",
    "",
    `### Frame samples (${samples.length} of ${p.previewFrames.length}, base64 JPEG @ 128px q=0.6)`,
    ...sampleLines.length > 0 ? sampleLines : ["- (no frames rendered)"]
  ].filter((l) => l !== "");
  return lines.join("\n");
}
async function buildJsonSnapshot(p) {
  const samples = pickSampleFrames(p.previewFrames);
  const sampleData = [];
  for (const s of samples) {
    try {
      const dataUrl = await bitmapToBase64(s.bitmap);
      sampleData.push({ idx: s.idx, width: s.bitmap.width, height: s.bitmap.height, dataUrl });
    } catch (err) {
      sampleData.push({
        idx: s.idx,
        width: s.bitmap.width,
        height: s.bitmap.height,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  return JSON.stringify(
    {
      capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
      device: p.device ? { kind: p.device.kind, label: p.device.label, approxMemoryMb: p.device.approxMemoryMb } : null,
      config: {
        model: p.model,
        resolution: p.resolution,
        frames: p.frames,
        fps: p.fps
      },
      prompt: { user: p.prompt, expanded: p.expandedPrompt || null },
      continuity: {
        mambaMode: p.coherenceMode,
        coherenceStrength: p.coherenceStrength,
        motionAmount: p.motionAmount,
        imgToImgStrength: p.imgToImgStrength,
        cameraMotion: p.cameraMotion
      },
      version: { currentId: p.currentVersionId },
      status: { progress: p.progressLabel || null, error: p.error },
      result: p.result ? {
        elapsedMs: p.result.elapsedMs,
        activeDevice: p.result.activeDevice,
        frames: p.result.frames.length,
        mambaStep: p.result.mambaState.step
      } : null,
      frameSamples: sampleData
    },
    null,
    2
  );
}
function DebugCopyButton(props) {
  const [state, setState] = useState("idle");
  const [errorMsg, setErrorMsg] = useState(null);
  const handleCopy = useCallback(async () => {
    setState("copying");
    setErrorMsg(null);
    try {
      const snapshot = props.asJson ? await buildJsonSnapshot(props) : await buildMarkdownSnapshot(props);
      await navigator.clipboard.writeText(snapshot);
      setState("copied");
      setTimeout(() => setState("idle"), 2e3);
    } catch (err) {
      setState("failed");
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setTimeout(() => setState("idle"), 4e3);
    }
  }, [props]);
  const label = state === "copying" ? "Building snapshot\u2026" : state === "copied" ? "\u2713 Copied to clipboard" : state === "failed" ? `Copy failed${errorMsg ? `: ${errorMsg}` : ""}` : "Copy debug snapshot";
  return /* @__PURE__ */ jsx5(
    "button",
    {
      type: "button",
      className: "bfs-btn bfs-btn-secondary",
      onClick: handleCopy,
      disabled: state === "copying",
      title: "Copies prompt, all config sliders, device info, result stats, and 3 base64-encoded sample frames (first / middle / last) to the clipboard as a markdown snapshot you can paste into a debug chat.",
      style: { width: "100%" },
      children: label
    }
  );
}

// src/components/useEngineStatus.ts
import { useEffect as useEffect2, useRef as useRef2, useState as useState2 } from "react";
import { probeDevice } from "@seanhogg/builderforce-studio";
function useEngineStatus() {
  const [status, setStatus] = useState2({ state: "probing" });
  const probedRef = useRef2(null);
  useEffect2(() => {
    let cancelled = false;
    probeDevice("auto").then((device) => {
      if (cancelled) {
        if (device?.kind === "webgpu" && device.gpuDevice) {
          try {
            device.gpuDevice.destroy();
          } catch {
          }
        }
        return;
      }
      if (!device) {
        setStatus({
          state: "unsupported",
          reason: "This browser cannot run the AI Video Studio. Requires WebGPU (Chrome 113+, Edge 113+) or WebNN."
        });
        return;
      }
      probedRef.current = device;
      setStatus({ state: "ready", device });
    }).catch((err) => {
      if (cancelled) return;
      setStatus({
        state: "unsupported",
        reason: err instanceof Error ? err.message : String(err)
      });
    });
    return () => {
      cancelled = true;
      const probed = probedRef.current;
      if (probed?.kind === "webgpu" && probed.gpuDevice) {
        try {
          probed.gpuDevice.destroy();
        } catch {
        }
      }
      probedRef.current = null;
    };
  }, []);
  return status;
}

// src/components/StudioPanel.tsx
import { jsx as jsx6, jsxs as jsxs5 } from "react/jsx-runtime";
var RESOLUTION_PRESETS = [256, 384, 512, 768];
var DEFAULT_RESOLUTION = 256;
function StudioPanel({
  authToken,
  apiKey,
  baseUrl,
  defaultModel = "lcm-tiny-sd",
  defaultCoherence = "prompt-bias",
  defaultFrames = 16,
  defaultFps = 8,
  onVideoGenerated,
  initialMambaState,
  hideHeader = false,
  promptValue,
  onPromptChange,
  onSaveVersion,
  versions,
  onLoadVersion
}) {
  const token = authToken ?? apiKey ?? "";
  const status = useEngineStatus();
  const engineRef = useRef3(null);
  const abortRef = useRef3(null);
  const [prompt, setPrompt] = useState3("");
  const [model, setModel] = useState3(defaultModel);
  const [resolution, setResolution] = useState3(DEFAULT_RESOLUTION);
  const [coherenceMode, setCoherenceMode] = useState3(defaultCoherence);
  const [coherenceStrength, setCoherenceStrength] = useState3(0.5);
  const [motionAmount, setMotionAmount] = useState3(0.15);
  const [imgToImgStrength, setImgToImgStrength] = useState3(0);
  const [cameraDx, setCameraDx] = useState3(0);
  const [cameraDy, setCameraDy] = useState3(0);
  const [frames, setFrames] = useState3(defaultFrames);
  const [fps, setFps] = useState3(defaultFps);
  useEffect3(() => {
    disposeEngineAndOutputs();
  }, [model, resolution]);
  const [isGenerating, setIsGenerating] = useState3(false);
  const [progressLabel, setProgressLabel] = useState3("");
  const [expandedPrompt, setExpandedPrompt] = useState3("");
  const [previewFrames, setPreviewFrames] = useState3([]);
  const [videoUrl, setVideoUrl] = useState3(null);
  const [result, setResult] = useState3(null);
  const [error, setError] = useState3(null);
  const [currentVersionId, setCurrentVersionId] = useState3(null);
  useEffect3(() => {
    if (promptValue !== void 0 && promptValue !== prompt) {
      setPrompt(promptValue);
    }
  }, [promptValue]);
  const previewFramesRef = useRef3([]);
  const resultRef = useRef3(null);
  const videoUrlRef = useRef3(null);
  useEffect3(() => {
    previewFramesRef.current = previewFrames;
  }, [previewFrames]);
  useEffect3(() => {
    resultRef.current = result;
  }, [result]);
  useEffect3(() => {
    videoUrlRef.current = videoUrl;
  }, [videoUrl]);
  const releaseVideoOutputs = useCallback2(() => {
    for (const bm of previewFramesRef.current) {
      try {
        bm.close();
      } catch {
      }
    }
    previewFramesRef.current = [];
    setPreviewFrames([]);
    const r = resultRef.current;
    if (r) {
      for (const bm of r.frames) {
        try {
          bm.close();
        } catch {
        }
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
  const disposeEngineAndOutputs = useCallback2(() => {
    releaseVideoOutputs();
    const engine = engineRef.current;
    engineRef.current = null;
    if (engine) void engine.dispose();
  }, [releaseVideoOutputs]);
  useEffect3(() => {
    return () => {
      disposeEngineAndOutputs();
    };
  }, [disposeEngineAndOutputs]);
  const handleGenerate = useCallback2(async () => {
    if (status.state !== "ready") return;
    if (!prompt.trim()) {
      setError("Enter a prompt before generating.");
      return;
    }
    if (!token) {
      setError("Missing Builderforce auth token (pass authToken).");
      return;
    }
    setError(null);
    setIsGenerating(true);
    setProgressLabel("Initialising engine\u2026");
    releaseVideoOutputs();
    const abort = new AbortController();
    abortRef.current = abort;
    const handleProgress = (label) => setProgressLabel(label);
    try {
      if (!engineRef.current) {
        const engine = await VideoEngine.create({
          apiKey: token,
          baseUrl,
          model,
          mambaState: initialMambaState,
          width: resolution,
          height: resolution,
          onProgress: handleProgress
        });
        if (!engine) {
          throw new Error("Engine refused to start on this device.");
        }
        engineRef.current = engine;
      }
      const generated = await engineRef.current.generate({
        prompt,
        frames,
        fps,
        coherence: coherenceMode,
        coherenceStrength,
        motionAmount,
        imgToImgStrength,
        cameraMotion: imgToImgStrength > 0 && (cameraDx !== 0 || cameraDy !== 0) ? { dx: cameraDx, dy: cameraDy } : void 0,
        signal: abort.signal,
        onPromptExpanded: setExpandedPrompt,
        onProgress: handleProgress,
        onFrame: (_idx, bitmap) => {
          setPreviewFrames((prev) => [...prev, bitmap]);
        }
      });
      const url = URL.createObjectURL(generated.blob);
      setVideoUrl(url);
      setResult(generated);
      onVideoGenerated?.(generated.blob, generated.mambaState);
      if (onSaveVersion) {
        try {
          const params = {
            prompt,
            model,
            width: resolution,
            height: resolution,
            frames,
            fps,
            coherence: coherenceMode,
            coherenceStrength,
            motionAmount,
            imgToImgStrength,
            cameraMotion: imgToImgStrength > 0 && (cameraDx !== 0 || cameraDy !== 0) ? { dx: cameraDx, dy: cameraDy } : null,
            mambaState: generated.mambaState,
            elapsedMs: generated.elapsedMs,
            parentVersionId: currentVersionId ?? void 0
          };
          const newId = await onSaveVersion(generated.blob, params);
          setCurrentVersionId(newId);
        } catch (saveErr) {
          const m = saveErr instanceof Error ? saveErr.message : String(saveErr);
          setProgressLabel((prev) => `${prev}  (version save failed: ${m})`);
        }
      }
      setProgressLabel(`Done in ${(generated.elapsedMs / 1e3).toFixed(1)}s on ${generated.activeDevice.toUpperCase()}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "Generation aborted" || message === "Mux aborted") {
        setProgressLabel("Cancelled.");
      } else {
        setError(message);
        setProgressLabel("");
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
    motionAmount,
    imgToImgStrength,
    cameraDx,
    cameraDy,
    currentVersionId,
    fps,
    frames,
    initialMambaState,
    model,
    onSaveVersion,
    onVideoGenerated,
    prompt,
    releaseVideoOutputs,
    resolution,
    status.state
  ]);
  const handleCancel = useCallback2(() => {
    abortRef.current?.abort();
  }, []);
  const handleDownload = useCallback2(() => {
    if (!result) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(result.blob);
    a.download = `builderforce-video-${Date.now()}.mp4`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5e3);
  }, [result]);
  const handleLoadVersion = useCallback2(async (entry) => {
    if (!onLoadVersion) return;
    setError(null);
    setProgressLabel(`Loading ${entry.label}\u2026`);
    try {
      const blob = await onLoadVersion(entry.id);
      releaseVideoOutputs();
      const url = URL.createObjectURL(blob);
      setVideoUrl(url);
      const p = entry.params;
      setPrompt(p.prompt);
      setModel(p.model);
      const knownRes = RESOLUTION_PRESETS.find((r) => r === p.width);
      if (knownRes) setResolution(knownRes);
      setFrames(p.frames);
      setFps(p.fps);
      setCoherenceMode(p.coherence);
      setCoherenceStrength(p.coherenceStrength);
      setMotionAmount(p.motionAmount);
      setImgToImgStrength(p.imgToImgStrength);
      setCameraDx(p.cameraMotion?.dx ?? 0);
      setCameraDy(p.cameraMotion?.dy ?? 0);
      setCurrentVersionId(entry.id);
      setProgressLabel(`Loaded ${entry.label} \u2014 adjust controls and Generate to make v${(versions?.length ?? 0) + 1}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Failed to load ${entry.label}: ${message}`);
      setProgressLabel("");
    }
  }, [onLoadVersion, releaseVideoOutputs, versions]);
  if (status.state === "probing") {
    return /* @__PURE__ */ jsxs5("div", { className: "bfs-root bfs-state-probing", children: [
      /* @__PURE__ */ jsx6("div", { className: "bfs-spinner" }),
      /* @__PURE__ */ jsx6("p", { children: "Probing hardware (WebNN \u2192 WebGPU \u2192 CPU)\u2026" })
    ] });
  }
  if (status.state === "unsupported") {
    return /* @__PURE__ */ jsxs5("div", { className: "bfs-root bfs-state-unsupported", children: [
      /* @__PURE__ */ jsx6("h2", { children: "AI Video Studio unavailable" }),
      /* @__PURE__ */ jsx6("p", { children: status.reason }),
      /* @__PURE__ */ jsx6("p", { className: "bfs-hint", children: "Open this page in Chrome 113+ or Edge 113+ with hardware acceleration enabled." })
    ] });
  }
  const device = status.device;
  return /* @__PURE__ */ jsxs5("div", { className: "bfs-root", children: [
    !hideHeader && /* @__PURE__ */ jsx6("header", { className: "bfs-header", children: /* @__PURE__ */ jsxs5("div", { children: [
      /* @__PURE__ */ jsx6("h1", { className: "bfs-title", children: "AI Video Studio" }),
      /* @__PURE__ */ jsxs5("p", { className: "bfs-subtitle", children: [
        "Running on ",
        /* @__PURE__ */ jsx6("strong", { children: device.label }),
        device.approxMemoryMb ? ` \xB7 ~${(device.approxMemoryMb / 1024).toFixed(1)} GB available` : ""
      ] })
    ] }) }),
    /* @__PURE__ */ jsxs5("div", { className: "bfs-grid", children: [
      /* @__PURE__ */ jsxs5("section", { className: "bfs-controls", children: [
        /* @__PURE__ */ jsxs5("div", { className: "bfs-field", children: [
          /* @__PURE__ */ jsx6("label", { className: "bfs-label", htmlFor: "bfs-prompt", children: "What video do you want to generate?" }),
          /* @__PURE__ */ jsx6(
            "textarea",
            {
              id: "bfs-prompt",
              className: "bfs-prompt",
              rows: 4,
              placeholder: "e.g. a fox running through autumn forest at golden hour, slow motion, cinematic",
              value: prompt,
              onChange: (e) => {
                setPrompt(e.target.value);
                onPromptChange?.(e.target.value);
              },
              disabled: isGenerating
            }
          ),
          expandedPrompt && /* @__PURE__ */ jsxs5("p", { className: "bfs-hint", children: [
            /* @__PURE__ */ jsx6("strong", { children: "Expanded:" }),
            " ",
            expandedPrompt
          ] })
        ] }),
        /* @__PURE__ */ jsx6(ModelPicker, { value: model, onChange: setModel, disabled: isGenerating }),
        /* @__PURE__ */ jsxs5("div", { className: "bfs-field", children: [
          /* @__PURE__ */ jsx6("label", { className: "bfs-label", children: "Resolution" }),
          /* @__PURE__ */ jsx6("div", { className: "bfs-radio-row", children: RESOLUTION_PRESETS.map((px) => {
            const active = resolution === px;
            return /* @__PURE__ */ jsxs5(
              "button",
              {
                type: "button",
                onClick: () => setResolution(px),
                disabled: isGenerating,
                className: "bfs-btn bfs-btn-secondary",
                "aria-pressed": active,
                style: {
                  flex: 1,
                  padding: "6px 8px",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  background: active ? "var(--bfs-accent)" : "transparent",
                  color: active ? "white" : "var(--bfs-fg)",
                  borderColor: active ? "var(--bfs-accent)" : "var(--bfs-border)"
                },
                children: [
                  px,
                  "\xD7",
                  px
                ]
              },
              px
            );
          }) }),
          /* @__PURE__ */ jsx6("p", { className: "bfs-hint", children: "Lower = faster + fits weaker GPUs (4\xD7 less compute per step at 256). Higher = sharper, more VRAM, may trip Windows GPU timeouts." })
        ] }),
        /* @__PURE__ */ jsxs5("div", { className: "bfs-row", children: [
          /* @__PURE__ */ jsxs5("div", { className: "bfs-field bfs-flex", children: [
            /* @__PURE__ */ jsx6("label", { className: "bfs-label", children: "Frames" }),
            /* @__PURE__ */ jsx6(
              "input",
              {
                type: "number",
                className: "bfs-input",
                min: 1,
                max: 120,
                value: frames,
                onChange: (e) => setFrames(Math.max(1, Math.min(120, Number(e.target.value) || 1))),
                disabled: isGenerating
              }
            )
          ] }),
          /* @__PURE__ */ jsxs5("div", { className: "bfs-field bfs-flex", children: [
            /* @__PURE__ */ jsx6("label", { className: "bfs-label", children: "FPS" }),
            /* @__PURE__ */ jsx6(
              "input",
              {
                type: "number",
                className: "bfs-input",
                min: 1,
                max: 60,
                value: fps,
                onChange: (e) => setFps(Math.max(1, Math.min(60, Number(e.target.value) || 1))),
                disabled: isGenerating
              }
            )
          ] }),
          /* @__PURE__ */ jsxs5("div", { className: "bfs-field bfs-flex", children: [
            /* @__PURE__ */ jsx6("label", { className: "bfs-label", children: "Duration" }),
            /* @__PURE__ */ jsxs5("div", { className: "bfs-readout", children: [
              (frames / fps).toFixed(2),
              "s"
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsx6(
          CoherenceControls,
          {
            mode: coherenceMode,
            strength: coherenceStrength,
            motionAmount,
            imgToImgStrength,
            cameraDx,
            cameraDy,
            onModeChange: setCoherenceMode,
            onStrengthChange: setCoherenceStrength,
            onMotionAmountChange: setMotionAmount,
            onImgToImgStrengthChange: setImgToImgStrength,
            onCameraDxChange: setCameraDx,
            onCameraDyChange: setCameraDy,
            disabled: isGenerating
          }
        ),
        /* @__PURE__ */ jsxs5("div", { className: "bfs-actions", children: [
          isGenerating ? /* @__PURE__ */ jsx6("button", { type: "button", className: "bfs-btn bfs-btn-danger", onClick: handleCancel, children: "Cancel" }) : /* @__PURE__ */ jsx6(
            "button",
            {
              type: "button",
              className: "bfs-btn bfs-btn-primary",
              onClick: handleGenerate,
              disabled: !prompt.trim(),
              children: currentVersionId ? `Generate v${(versions?.length ?? 0) + 1} (edit of current)` : "Generate video"
            }
          ),
          result && !isGenerating && /* @__PURE__ */ jsx6("button", { type: "button", className: "bfs-btn bfs-btn-secondary", onClick: handleDownload, children: "Download MP4" })
        ] })
      ] }),
      /* @__PURE__ */ jsxs5("section", { className: "bfs-preview-pane", children: [
        /* @__PURE__ */ jsx6(
          VideoPreview,
          {
            frames: previewFrames,
            videoUrl,
            width: resolution,
            height: resolution
          }
        ),
        /* @__PURE__ */ jsx6(ProgressFeedback, { progressLabel, error }),
        /* @__PURE__ */ jsx6("div", { style: { marginTop: 12 }, children: /* @__PURE__ */ jsx6(
          DebugCopyButton,
          {
            prompt,
            expandedPrompt,
            model,
            resolution,
            frames,
            fps,
            coherenceMode,
            coherenceStrength,
            motionAmount,
            imgToImgStrength,
            cameraMotion: imgToImgStrength > 0 && (cameraDx !== 0 || cameraDy !== 0) ? { dx: cameraDx, dy: cameraDy } : null,
            device: status.state === "ready" ? status.device : null,
            progressLabel,
            error,
            result,
            previewFrames,
            currentVersionId
          }
        ) }),
        result && /* @__PURE__ */ jsxs5("dl", { className: "bfs-meta", children: [
          /* @__PURE__ */ jsx6("dt", { children: "Device" }),
          /* @__PURE__ */ jsx6("dd", { children: result.activeDevice.toUpperCase() }),
          /* @__PURE__ */ jsx6("dt", { children: "Frames" }),
          /* @__PURE__ */ jsx6("dd", { children: result.frames.length }),
          /* @__PURE__ */ jsx6("dt", { children: "Mamba step" }),
          /* @__PURE__ */ jsx6("dd", { children: result.mambaState.step }),
          /* @__PURE__ */ jsx6("dt", { children: "Elapsed" }),
          /* @__PURE__ */ jsxs5("dd", { children: [
            (result.elapsedMs / 1e3).toFixed(2),
            "s"
          ] })
        ] }),
        versions && versions.length > 0 ? /* @__PURE__ */ jsxs5("div", { className: "bfs-field", style: { marginTop: 16 }, children: [
          /* @__PURE__ */ jsxs5("label", { className: "bfs-label", children: [
            "Versions (",
            versions.length,
            ")"
          ] }),
          /* @__PURE__ */ jsx6("div", { className: "bfs-version-list", children: versions.map((v) => {
            const isCurrent = v.id === currentVersionId;
            return /* @__PURE__ */ jsxs5(
              "button",
              {
                type: "button",
                className: "bfs-btn bfs-btn-secondary",
                onClick: () => handleLoadVersion(v),
                disabled: isGenerating || isCurrent,
                "aria-pressed": isCurrent,
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  textAlign: "left",
                  padding: "6px 10px",
                  background: isCurrent ? "var(--bfs-accent)" : "transparent",
                  color: isCurrent ? "white" : "var(--bfs-fg)"
                },
                children: [
                  v.thumbnailUrl ? /* @__PURE__ */ jsx6(
                    "img",
                    {
                      src: v.thumbnailUrl,
                      alt: "",
                      width: 32,
                      height: 32,
                      style: { borderRadius: 4, objectFit: "cover" }
                    }
                  ) : null,
                  /* @__PURE__ */ jsx6("span", { style: { flex: 1 }, children: v.label }),
                  v.params.parentVersionId ? /* @__PURE__ */ jsx6("span", { className: "bfs-mono", style: { fontSize: "0.7rem", opacity: 0.7 }, children: "\u21AA edit" }) : null
                ]
              },
              v.id
            );
          }) }),
          /* @__PURE__ */ jsx6("p", { className: "bfs-hint", children: "Click a version to load it as the base. Generating again creates a new version with this one as parent (edit-on-top)." })
        ] }) : null
      ] })
    ] })
  ] });
}

// src/index.ts
import {
  VideoEngine as VideoEngine2,
  probeDevice as probeDevice2,
  hasWebGPUSupport,
  configureOnnxRuntime,
  MODEL_REGISTRY as MODEL_REGISTRY2
} from "@seanhogg/builderforce-studio";
export {
  CoherenceControls,
  DebugCopyButton,
  MODEL_REGISTRY2 as MODEL_REGISTRY,
  ModelPicker,
  ProgressFeedback,
  StudioPanel,
  VideoEngine2 as VideoEngine,
  VideoPreview,
  configureOnnxRuntime,
  hasWebGPUSupport,
  probeDevice2 as probeDevice,
  useEngineStatus
};
//# sourceMappingURL=index.mjs.map