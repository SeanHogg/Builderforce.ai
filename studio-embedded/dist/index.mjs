// src/components/StudioPanel.tsx
import { useCallback, useEffect as useEffect3, useRef as useRef3, useState as useState2 } from "react";
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

// src/components/useEngineStatus.ts
import { useEffect as useEffect2, useRef as useRef2, useState } from "react";
import { probeDevice } from "@seanhogg/builderforce-studio";
function useEngineStatus() {
  const [status, setStatus] = useState({ state: "probing" });
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
import { jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
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
  onPromptChange
}) {
  const token = authToken ?? apiKey ?? "";
  const status = useEngineStatus();
  const engineRef = useRef3(null);
  const abortRef = useRef3(null);
  const [prompt, setPrompt] = useState2("");
  const [model, setModel] = useState2(defaultModel);
  const [resolution, setResolution] = useState2(DEFAULT_RESOLUTION);
  const [coherenceMode, setCoherenceMode] = useState2(defaultCoherence);
  const [coherenceStrength, setCoherenceStrength] = useState2(0.5);
  const [motionAmount, setMotionAmount] = useState2(0.15);
  const [imgToImgStrength, setImgToImgStrength] = useState2(0);
  const [cameraDx, setCameraDx] = useState2(0);
  const [cameraDy, setCameraDy] = useState2(0);
  const [frames, setFrames] = useState2(defaultFrames);
  const [fps, setFps] = useState2(defaultFps);
  useEffect3(() => {
    disposeEngineAndOutputs();
  }, [model, resolution]);
  const [isGenerating, setIsGenerating] = useState2(false);
  const [progressLabel, setProgressLabel] = useState2("");
  const [expandedPrompt, setExpandedPrompt] = useState2("");
  const [previewFrames, setPreviewFrames] = useState2([]);
  const [videoUrl, setVideoUrl] = useState2(null);
  const [result, setResult] = useState2(null);
  const [error, setError] = useState2(null);
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
  const releaseVideoOutputs = useCallback(() => {
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
  const disposeEngineAndOutputs = useCallback(() => {
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
  const handleGenerate = useCallback(async () => {
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
    fps,
    frames,
    initialMambaState,
    model,
    onVideoGenerated,
    prompt,
    status.state,
    videoUrl
  ]);
  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);
  const handleDownload = useCallback(() => {
    if (!result) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(result.blob);
    a.download = `builderforce-video-${Date.now()}.mp4`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5e3);
  }, [result]);
  if (status.state === "probing") {
    return /* @__PURE__ */ jsxs4("div", { className: "bfs-root bfs-state-probing", children: [
      /* @__PURE__ */ jsx4("div", { className: "bfs-spinner" }),
      /* @__PURE__ */ jsx4("p", { children: "Probing hardware (WebNN \u2192 WebGPU \u2192 CPU)\u2026" })
    ] });
  }
  if (status.state === "unsupported") {
    return /* @__PURE__ */ jsxs4("div", { className: "bfs-root bfs-state-unsupported", children: [
      /* @__PURE__ */ jsx4("h2", { children: "AI Video Studio unavailable" }),
      /* @__PURE__ */ jsx4("p", { children: status.reason }),
      /* @__PURE__ */ jsx4("p", { className: "bfs-hint", children: "Open this page in Chrome 113+ or Edge 113+ with hardware acceleration enabled." })
    ] });
  }
  const device = status.device;
  return /* @__PURE__ */ jsxs4("div", { className: "bfs-root", children: [
    !hideHeader && /* @__PURE__ */ jsx4("header", { className: "bfs-header", children: /* @__PURE__ */ jsxs4("div", { children: [
      /* @__PURE__ */ jsx4("h1", { className: "bfs-title", children: "AI Video Studio" }),
      /* @__PURE__ */ jsxs4("p", { className: "bfs-subtitle", children: [
        "Running on ",
        /* @__PURE__ */ jsx4("strong", { children: device.label }),
        device.approxMemoryMb ? ` \xB7 ~${(device.approxMemoryMb / 1024).toFixed(1)} GB available` : ""
      ] })
    ] }) }),
    /* @__PURE__ */ jsxs4("div", { className: "bfs-grid", children: [
      /* @__PURE__ */ jsxs4("section", { className: "bfs-controls", children: [
        /* @__PURE__ */ jsxs4("div", { className: "bfs-field", children: [
          /* @__PURE__ */ jsx4("label", { className: "bfs-label", htmlFor: "bfs-prompt", children: "What video do you want to generate?" }),
          /* @__PURE__ */ jsx4(
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
          expandedPrompt && /* @__PURE__ */ jsxs4("p", { className: "bfs-hint", children: [
            /* @__PURE__ */ jsx4("strong", { children: "Expanded:" }),
            " ",
            expandedPrompt
          ] })
        ] }),
        /* @__PURE__ */ jsx4(ModelPicker, { value: model, onChange: setModel, disabled: isGenerating }),
        /* @__PURE__ */ jsxs4("div", { className: "bfs-field", children: [
          /* @__PURE__ */ jsx4("label", { className: "bfs-label", children: "Resolution" }),
          /* @__PURE__ */ jsx4("div", { className: "bfs-radio-row", children: RESOLUTION_PRESETS.map((px) => {
            const active = resolution === px;
            return /* @__PURE__ */ jsxs4(
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
          /* @__PURE__ */ jsx4("p", { className: "bfs-hint", children: "Lower = faster + fits weaker GPUs (4\xD7 less compute per step at 256). Higher = sharper, more VRAM, may trip Windows GPU timeouts." })
        ] }),
        /* @__PURE__ */ jsxs4("div", { className: "bfs-row", children: [
          /* @__PURE__ */ jsxs4("div", { className: "bfs-field bfs-flex", children: [
            /* @__PURE__ */ jsx4("label", { className: "bfs-label", children: "Frames" }),
            /* @__PURE__ */ jsx4(
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
          /* @__PURE__ */ jsxs4("div", { className: "bfs-field bfs-flex", children: [
            /* @__PURE__ */ jsx4("label", { className: "bfs-label", children: "FPS" }),
            /* @__PURE__ */ jsx4(
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
          /* @__PURE__ */ jsxs4("div", { className: "bfs-field bfs-flex", children: [
            /* @__PURE__ */ jsx4("label", { className: "bfs-label", children: "Duration" }),
            /* @__PURE__ */ jsxs4("div", { className: "bfs-readout", children: [
              (frames / fps).toFixed(2),
              "s"
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsx4(
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
        /* @__PURE__ */ jsxs4("div", { className: "bfs-actions", children: [
          isGenerating ? /* @__PURE__ */ jsx4("button", { type: "button", className: "bfs-btn bfs-btn-danger", onClick: handleCancel, children: "Cancel" }) : /* @__PURE__ */ jsx4(
            "button",
            {
              type: "button",
              className: "bfs-btn bfs-btn-primary",
              onClick: handleGenerate,
              disabled: !prompt.trim(),
              children: "Generate video"
            }
          ),
          result && !isGenerating && /* @__PURE__ */ jsx4("button", { type: "button", className: "bfs-btn bfs-btn-secondary", onClick: handleDownload, children: "Download MP4" })
        ] }),
        progressLabel && /* @__PURE__ */ jsx4("p", { className: "bfs-progress", children: progressLabel }),
        error && /* @__PURE__ */ jsx4("p", { className: "bfs-error", children: error })
      ] }),
      /* @__PURE__ */ jsxs4("section", { className: "bfs-preview-pane", children: [
        /* @__PURE__ */ jsx4(
          VideoPreview,
          {
            frames: previewFrames,
            videoUrl,
            width: resolution,
            height: resolution
          }
        ),
        result && /* @__PURE__ */ jsxs4("dl", { className: "bfs-meta", children: [
          /* @__PURE__ */ jsx4("dt", { children: "Device" }),
          /* @__PURE__ */ jsx4("dd", { children: result.activeDevice.toUpperCase() }),
          /* @__PURE__ */ jsx4("dt", { children: "Frames" }),
          /* @__PURE__ */ jsx4("dd", { children: result.frames.length }),
          /* @__PURE__ */ jsx4("dt", { children: "Mamba step" }),
          /* @__PURE__ */ jsx4("dd", { children: result.mambaState.step }),
          /* @__PURE__ */ jsx4("dt", { children: "Elapsed" }),
          /* @__PURE__ */ jsxs4("dd", { children: [
            (result.elapsedMs / 1e3).toFixed(2),
            "s"
          ] })
        ] })
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
  MODEL_REGISTRY2 as MODEL_REGISTRY,
  ModelPicker,
  StudioPanel,
  VideoEngine2 as VideoEngine,
  VideoPreview,
  configureOnnxRuntime,
  hasWebGPUSupport,
  probeDevice2 as probeDevice,
  useEngineStatus
};
//# sourceMappingURL=index.mjs.map