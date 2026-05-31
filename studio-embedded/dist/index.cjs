"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  CoherenceControls: () => CoherenceControls,
  MODEL_REGISTRY: () => import_builderforce_studio4.MODEL_REGISTRY,
  ModelPicker: () => ModelPicker,
  StudioPanel: () => StudioPanel,
  VideoEngine: () => import_builderforce_studio4.VideoEngine,
  VideoPreview: () => VideoPreview,
  configureOnnxRuntime: () => import_builderforce_studio4.configureOnnxRuntime,
  hasWebGPUSupport: () => import_builderforce_studio4.hasWebGPUSupport,
  probeDevice: () => import_builderforce_studio4.probeDevice,
  useEngineStatus: () => useEngineStatus
});
module.exports = __toCommonJS(src_exports);

// src/components/StudioPanel.tsx
var import_react3 = require("react");
var import_builderforce_studio3 = require("@seanhogg/builderforce-studio");

// src/components/ModelPicker.tsx
var import_builderforce_studio = require("@seanhogg/builderforce-studio");
var import_jsx_runtime = require("react/jsx-runtime");
var MODEL_LABELS = {
  "lcm-tiny-sd": "LCM Tiny SD \u2014 4-step, lightest (~2 GB, fp16)",
  "sd-turbo": "SD-Turbo \u2014 1-step, fastest (~4 GB)",
  "lcm-dreamshaper-v7": "LCM Dreamshaper v7 \u2014 4-step, best quality (~6 GB)"
};
function ModelPicker({ value, onChange, disabled }) {
  const entries = Object.keys(import_builderforce_studio.MODEL_REGISTRY);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bfs-field", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "bfs-label", children: "Diffusion model" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "select",
      {
        className: "bfs-select",
        value,
        onChange: (e) => onChange(e.target.value),
        disabled,
        children: entries.map((id) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: id, children: MODEL_LABELS[id] }, id))
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "bfs-hint", children: [
      import_builderforce_studio.MODEL_REGISTRY[value].defaultSteps,
      " step",
      import_builderforce_studio.MODEL_REGISTRY[value].defaultSteps > 1 ? "s" : "",
      " ",
      "\xB7 ~",
      Math.round(import_builderforce_studio.MODEL_REGISTRY[value].minVramMb / 1024),
      " GB VRAM minimum"
    ] })
  ] });
}

// src/components/CoherenceControls.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var MODE_DESCRIPTIONS = {
  "prompt-bias": "Mamba state biases the prompt embedding. Lightweight, works with any U-Net.",
  "latent-residual": "Mamba state biases the initial latent noise. Stronger temporal lock, slightly more compute."
};
function LabeledRange(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "bfs-label", style: props.marginTop ? { marginTop: props.marginTop } : void 0, children: [
      props.label,
      ": ",
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "bfs-mono", children: props.value.toFixed(2) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "bfs-hint", children: props.hint })
  ] });
}
function CoherenceControls({
  mode,
  strength,
  motionAmount,
  onModeChange,
  onStrengthChange,
  onMotionAmountChange,
  disabled
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "bfs-field", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { className: "bfs-label", children: "Temporal coherence (Mamba state)" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "bfs-radio-row", children: ["prompt-bias", "latent-residual"].map((m) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "bfs-radio", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: m === "prompt-bias" ? "Prompt bias" : "Latent residual" })
    ] }, m)) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "bfs-hint", children: MODE_DESCRIPTIONS[mode] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      LabeledRange,
      {
        label: "Motion amount",
        value: motionAmount,
        min: 0,
        max: 1,
        step: 0.05,
        marginTop: 12,
        disabled,
        onChange: onMotionAmountChange,
        hint: "Per-frame noise mixed into the shared anchor latent. 0 = a still image looped \xB7 0.15 = subtle motion, stable colors (default) \xB7 1 = each frame is a fresh interpretation of the prompt (no continuity)."
      }
    )
  ] });
}

// src/components/VideoPreview.tsx
var import_react = require("react");
var import_jsx_runtime3 = require("react/jsx-runtime");
function VideoPreview({ frames, videoUrl, width, height }) {
  const canvasRef = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => {
    if (videoUrl) return;
    const canvas = canvasRef.current;
    if (!canvas || frames.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const latest = frames[frames.length - 1];
    ctx.drawImage(latest, 0, 0, canvas.width, canvas.height);
  }, [frames, videoUrl]);
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "bfs-preview", style: { aspectRatio: `${width} / ${height}` }, children: [
    videoUrl ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("video", { src: videoUrl, controls: true, autoPlay: true, loop: true, className: "bfs-preview-video" }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("canvas", { ref: canvasRef, width, height, className: "bfs-preview-canvas" }),
    !videoUrl && frames.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "bfs-preview-empty", children: "Preview will appear here as frames generate." })
  ] });
}

// src/components/useEngineStatus.ts
var import_react2 = require("react");
var import_builderforce_studio2 = require("@seanhogg/builderforce-studio");
function useEngineStatus() {
  const [status, setStatus] = (0, import_react2.useState)({ state: "probing" });
  const probedRef = (0, import_react2.useRef)(null);
  (0, import_react2.useEffect)(() => {
    let cancelled = false;
    (0, import_builderforce_studio2.probeDevice)("auto").then((device) => {
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
var import_jsx_runtime4 = require("react/jsx-runtime");
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
  const engineRef = (0, import_react3.useRef)(null);
  const abortRef = (0, import_react3.useRef)(null);
  const [prompt, setPrompt] = (0, import_react3.useState)("");
  const [model, setModel] = (0, import_react3.useState)(defaultModel);
  const [resolution, setResolution] = (0, import_react3.useState)(DEFAULT_RESOLUTION);
  const [coherenceMode, setCoherenceMode] = (0, import_react3.useState)(defaultCoherence);
  const [coherenceStrength, setCoherenceStrength] = (0, import_react3.useState)(0.5);
  const [motionAmount, setMotionAmount] = (0, import_react3.useState)(0.15);
  const [frames, setFrames] = (0, import_react3.useState)(defaultFrames);
  const [fps, setFps] = (0, import_react3.useState)(defaultFps);
  (0, import_react3.useEffect)(() => {
    disposeEngineAndOutputs();
  }, [model, resolution]);
  const [isGenerating, setIsGenerating] = (0, import_react3.useState)(false);
  const [progressLabel, setProgressLabel] = (0, import_react3.useState)("");
  const [expandedPrompt, setExpandedPrompt] = (0, import_react3.useState)("");
  const [previewFrames, setPreviewFrames] = (0, import_react3.useState)([]);
  const [videoUrl, setVideoUrl] = (0, import_react3.useState)(null);
  const [result, setResult] = (0, import_react3.useState)(null);
  const [error, setError] = (0, import_react3.useState)(null);
  (0, import_react3.useEffect)(() => {
    if (promptValue !== void 0 && promptValue !== prompt) {
      setPrompt(promptValue);
    }
  }, [promptValue]);
  const previewFramesRef = (0, import_react3.useRef)([]);
  const resultRef = (0, import_react3.useRef)(null);
  const videoUrlRef = (0, import_react3.useRef)(null);
  (0, import_react3.useEffect)(() => {
    previewFramesRef.current = previewFrames;
  }, [previewFrames]);
  (0, import_react3.useEffect)(() => {
    resultRef.current = result;
  }, [result]);
  (0, import_react3.useEffect)(() => {
    videoUrlRef.current = videoUrl;
  }, [videoUrl]);
  const releaseVideoOutputs = (0, import_react3.useCallback)(() => {
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
  const disposeEngineAndOutputs = (0, import_react3.useCallback)(() => {
    releaseVideoOutputs();
    const engine = engineRef.current;
    engineRef.current = null;
    if (engine) void engine.dispose();
  }, [releaseVideoOutputs]);
  (0, import_react3.useEffect)(() => {
    return () => {
      disposeEngineAndOutputs();
    };
  }, [disposeEngineAndOutputs]);
  const handleGenerate = (0, import_react3.useCallback)(async () => {
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
        const engine = await import_builderforce_studio3.VideoEngine.create({
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
    fps,
    frames,
    initialMambaState,
    model,
    onVideoGenerated,
    prompt,
    status.state,
    videoUrl
  ]);
  const handleCancel = (0, import_react3.useCallback)(() => {
    abortRef.current?.abort();
  }, []);
  const handleDownload = (0, import_react3.useCallback)(() => {
    if (!result) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(result.blob);
    a.download = `builderforce-video-${Date.now()}.mp4`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5e3);
  }, [result]);
  if (status.state === "probing") {
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bfs-root bfs-state-probing", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "bfs-spinner" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: "Probing hardware (WebNN \u2192 WebGPU \u2192 CPU)\u2026" })
    ] });
  }
  if (status.state === "unsupported") {
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bfs-root bfs-state-unsupported", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h2", { children: "AI Video Studio unavailable" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: status.reason }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "bfs-hint", children: "Open this page in Chrome 113+ or Edge 113+ with hardware acceleration enabled." })
    ] });
  }
  const device = status.device;
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bfs-root", children: [
    !hideHeader && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("header", { className: "bfs-header", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h1", { className: "bfs-title", children: "AI Video Studio" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { className: "bfs-subtitle", children: [
        "Running on ",
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: device.label }),
        device.approxMemoryMb ? ` \xB7 ~${(device.approxMemoryMb / 1024).toFixed(1)} GB available` : ""
      ] })
    ] }) }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bfs-grid", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: "bfs-controls", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bfs-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("label", { className: "bfs-label", htmlFor: "bfs-prompt", children: "What video do you want to generate?" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
          expandedPrompt && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { className: "bfs-hint", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: "Expanded:" }),
            " ",
            expandedPrompt
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ModelPicker, { value: model, onChange: setModel, disabled: isGenerating }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bfs-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("label", { className: "bfs-label", children: "Resolution" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "bfs-radio-row", children: RESOLUTION_PRESETS.map((px) => {
            const active = resolution === px;
            return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
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
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "bfs-hint", children: "Lower = faster + fits weaker GPUs (4\xD7 less compute per step at 256). Higher = sharper, more VRAM, may trip Windows GPU timeouts." })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bfs-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bfs-field bfs-flex", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("label", { className: "bfs-label", children: "Frames" }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bfs-field bfs-flex", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("label", { className: "bfs-label", children: "FPS" }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bfs-field bfs-flex", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("label", { className: "bfs-label", children: "Duration" }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bfs-readout", children: [
              (frames / fps).toFixed(2),
              "s"
            ] })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          CoherenceControls,
          {
            mode: coherenceMode,
            strength: coherenceStrength,
            motionAmount,
            onModeChange: setCoherenceMode,
            onStrengthChange: setCoherenceStrength,
            onMotionAmountChange: setMotionAmount,
            disabled: isGenerating
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bfs-actions", children: [
          isGenerating ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "bfs-btn bfs-btn-danger", onClick: handleCancel, children: "Cancel" }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            "button",
            {
              type: "button",
              className: "bfs-btn bfs-btn-primary",
              onClick: handleGenerate,
              disabled: !prompt.trim(),
              children: "Generate video"
            }
          ),
          result && !isGenerating && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "bfs-btn bfs-btn-secondary", onClick: handleDownload, children: "Download MP4" })
        ] }),
        progressLabel && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "bfs-progress", children: progressLabel }),
        error && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "bfs-error", children: error })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: "bfs-preview-pane", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          VideoPreview,
          {
            frames: previewFrames,
            videoUrl,
            width: resolution,
            height: resolution
          }
        ),
        result && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("dl", { className: "bfs-meta", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dt", { children: "Device" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dd", { children: result.activeDevice.toUpperCase() }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dt", { children: "Frames" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dd", { children: result.frames.length }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dt", { children: "Mamba step" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dd", { children: result.mambaState.step }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dt", { children: "Elapsed" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("dd", { children: [
            (result.elapsedMs / 1e3).toFixed(2),
            "s"
          ] })
        ] })
      ] })
    ] })
  ] });
}

// src/index.ts
var import_builderforce_studio4 = require("@seanhogg/builderforce-studio");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CoherenceControls,
  MODEL_REGISTRY,
  ModelPicker,
  StudioPanel,
  VideoEngine,
  VideoPreview,
  configureOnnxRuntime,
  hasWebGPUSupport,
  probeDevice,
  useEngineStatus
});
//# sourceMappingURL=index.cjs.map