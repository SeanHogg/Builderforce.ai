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
  CAMERA_MOVES: () => import_builderforce_studio6.CAMERA_MOVES,
  CoherenceControls: () => CoherenceControls,
  DebugCopyButton: () => DebugCopyButton,
  MODEL_REGISTRY: () => import_builderforce_studio6.MODEL_REGISTRY,
  ModelPicker: () => ModelPicker,
  ProgressFeedback: () => ProgressFeedback,
  QUALITY_TIERS: () => QUALITY_TIERS,
  QualityTierPicker: () => QualityTierPicker,
  StoryboardEditor: () => StoryboardEditor,
  StudioPanel: () => StudioPanel,
  VideoEngine: () => import_builderforce_studio6.VideoEngine,
  VideoPreview: () => VideoPreview,
  configureOnnxRuntime: () => import_builderforce_studio6.configureOnnxRuntime,
  hasWebGPUSupport: () => import_builderforce_studio6.hasWebGPUSupport,
  planScene: () => import_builderforce_studio6.planScene,
  probeDevice: () => import_builderforce_studio6.probeDevice,
  resolveQualityTier: () => resolveQualityTier,
  useEngineStatus: () => useEngineStatus
});
module.exports = __toCommonJS(src_exports);

// src/components/StudioPanel.tsx
var import_react4 = require("react");
var import_builderforce_studio5 = require("@seanhogg/builderforce-studio");

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
  "prompt-bias": "Mamba state biases the prompt embedding. Lightweight, works with any U-Net. Compatible with img2img.",
  "latent-residual": "Mamba state biases the initial latent noise. Stronger temporal lock, slightly more compute. AUTO-SKIPPED when img2img recursion is on \u2014 broadcast bias on a partially-denoised latent disfigures the image."
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
        label: `Coherence strength${mode === "latent-residual" && img2imgOn ? " (auto-skipped \u2014 img2img on)" : ""}`,
        value: strength,
        min: 0,
        max: 1,
        step: 0.05,
        marginTop: 12,
        disabled: disabled || mode === "latent-residual" && img2imgOn,
        onChange: onStrengthChange,
        hint: "0 = i.i.d. frames \xB7 1 = maximum lock to previous frame."
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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
    img2imgOn ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { className: "bfs-label", style: { marginTop: 12 }, children: "Camera motion (latent shift, 1 unit = 8 pixels)" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "bfs-row", style: { gap: 12 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "bfs-label", style: { flex: 1 }, children: [
          "dx ",
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "bfs-mono", children: cameraDx }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "bfs-label", style: { flex: 1 }, children: [
          "dy ",
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "bfs-mono", children: cameraDy }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "bfs-hint", children: 'Per-frame shift on the prior latent before re-noising. For "walking forward on a path" try dy = -1 (slight upward tilt) or dy = 1 (looking slightly down at the ground passing under).' })
    ] }) : null
  ] });
}

// src/components/VideoPreview.tsx
var import_react = require("react");
var import_jsx_runtime3 = require("react/jsx-runtime");
function VideoPreview({ frames, videoUrl, width, height, loading }) {
  const videoRef = (0, import_react.useRef)(null);
  const [thumbUrls, setThumbUrls] = (0, import_react.useState)([]);
  const [selectedThumb, setSelectedThumb] = (0, import_react.useState)(null);
  const [fps, setFps] = (0, import_react.useState)(8);
  (0, import_react.useEffect)(() => {
    if (loading || !videoUrl || frames.length === 0) {
      setThumbUrls([]);
      return;
    }
    let cancelled = false;
    const urls = [];
    (async () => {
      for (const bm of frames) {
        if (cancelled) break;
        const canvas = document.createElement("canvas");
        canvas.width = 96;
        canvas.height = Math.round(96 / bm.width * bm.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        ctx.drawImage(bm, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(
          (r) => canvas.toBlob(r, "image/jpeg", 0.7)
        );
        if (!blob) continue;
        urls.push(URL.createObjectURL(blob));
      }
      if (!cancelled) setThumbUrls(urls);
    })();
    return () => {
      cancelled = true;
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [frames, videoUrl, loading]);
  (0, import_react.useEffect)(() => {
    const v = videoRef.current;
    if (!v || !videoUrl || frames.length === 0) return;
    const onLoaded = () => {
      if (v.duration > 0) setFps(Math.max(1, Math.round(frames.length / v.duration)));
    };
    v.addEventListener("loadedmetadata", onLoaded);
    return () => v.removeEventListener("loadedmetadata", onLoaded);
  }, [videoUrl, frames.length]);
  const handleThumbClick = (idx) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = idx / fps;
    setSelectedThumb(idx);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "bfs-preview", style: { aspectRatio: `${width} / ${height}` }, children: loading ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(LoadingState, { ...loading }) : videoUrl ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("video", { ref: videoRef, src: videoUrl, controls: true, autoPlay: true, loop: true, className: "bfs-preview-video" }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "bfs-preview-empty", children: "Enter a prompt and press Generate." }) }),
    !loading && videoUrl && thumbUrls.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "div",
      {
        className: "bfs-thumb-strip",
        style: {
          display: "flex",
          gap: 4,
          overflowX: "auto",
          padding: "8px 0",
          marginTop: 8
        },
        children: thumbUrls.map((url, idx) => {
          const selected = selectedThumb === idx;
          return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "button",
            {
              type: "button",
              onClick: () => handleThumbClick(idx),
              title: `Frame ${idx + 1} of ${thumbUrls.length}`,
              style: {
                flex: "0 0 auto",
                padding: 0,
                border: selected ? "2px solid var(--bfs-accent)" : "2px solid transparent",
                borderRadius: 4,
                cursor: "pointer",
                background: "transparent"
              },
              children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "img",
                {
                  src: url,
                  alt: `Frame ${idx + 1}`,
                  width: 64,
                  height: Math.round(64 / width * height),
                  style: { borderRadius: 2, display: "block" }
                }
              )
            },
            url
          );
        })
      }
    ) : null
  ] });
}
function LoadingState({
  label,
  framesDone,
  framesTotal
}) {
  const pct = framesTotal > 0 ? Math.min(100, Math.round(framesDone / framesTotal * 100)) : 0;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 24,
        width: "100%",
        height: "100%"
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontSize: "0.85rem", textAlign: "center", opacity: 0.85 }, children: label }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "div",
          {
            style: {
              width: "80%",
              height: 8,
              background: "rgba(127,127,127,0.2)",
              borderRadius: 4,
              overflow: "hidden"
            },
            children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "div",
              {
                style: {
                  width: `${pct}%`,
                  height: "100%",
                  background: "var(--bfs-accent, #3b82f6)",
                  transition: "width 0.3s ease"
                }
              }
            )
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "bfs-mono", style: { fontSize: "0.75rem", opacity: 0.7 }, children: [
          framesDone,
          " / ",
          framesTotal,
          " frames"
        ] })
      ]
    }
  );
}

// src/components/ProgressFeedback.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
function ProgressFeedback({ progressLabel, error }) {
  if (!progressLabel && !error) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bfs-progress-feedback", children: [
    progressLabel ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "bfs-progress", children: progressLabel }) : null,
    error ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "bfs-error", children: error }) : null
  ] });
}

// src/components/DebugCopyButton.tsx
var import_react2 = require("react");
var import_jsx_runtime5 = require("react/jsx-runtime");
function describeModelChain(p) {
  return p.refinementModel ? `${p.model} \u2192 ${p.refinementModel} (two-pass)` : `${p.model} (single pass)`;
}
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
    `- Quality tier: \`${p.quality}\``,
    `- Model chain: \`${describeModelChain(p)}\``,
    `- Resolution: ${p.resolution}\xD7${p.resolution}`,
    `- Frames: ${p.frames}, FPS: ${p.fps}, Duration: ${(p.frames / p.fps).toFixed(2)}s`,
    `- Keyframe interpolation: ${p.interpolationFactor === 1 ? "off" : `${p.interpolationFactor}\xD7`}`,
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
    `- anchorRefreshInterval: ${p.anchorRefreshInterval > 0 ? `${p.anchorRefreshInterval} keyframes` : "off"}`,
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
        quality: p.quality,
        model: p.model,
        refinementModel: p.refinementModel,
        modelChain: describeModelChain(p),
        resolution: p.resolution,
        frames: p.frames,
        fps: p.fps,
        interpolationFactor: p.interpolationFactor
      },
      prompt: { user: p.prompt, expanded: p.expandedPrompt || null },
      continuity: {
        mambaMode: p.coherenceMode,
        coherenceStrength: p.coherenceStrength,
        motionAmount: p.motionAmount,
        imgToImgStrength: p.imgToImgStrength,
        anchorRefreshInterval: p.anchorRefreshInterval,
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
  const [state, setState] = (0, import_react2.useState)("idle");
  const [errorMsg, setErrorMsg] = (0, import_react2.useState)(null);
  const handleCopy = (0, import_react2.useCallback)(async () => {
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
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
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

// src/components/QualityTierPicker.tsx
var import_builderforce_studio2 = require("@seanhogg/builderforce-studio");
var import_jsx_runtime6 = require("react/jsx-runtime");
var QUALITY_TIERS = [
  {
    id: "fast",
    label: "Fast",
    primary: "lcm-tiny-sd",
    description: "Smallest model (~2 GB), 4 steps per frame. Best for previews and weaker GPUs."
  },
  {
    id: "balanced",
    label: "Balanced",
    primary: "lcm-dreamshaper-v7",
    description: "LCM Dreamshaper (~6 GB), 4 steps per frame. Sharper detail than Fast."
  },
  {
    id: "refined",
    label: "Refined (two-pass)",
    primary: "lcm-tiny-sd",
    refinement: "lcm-dreamshaper-v7",
    description: "Two-pass chain: tiny model lays in composition, Dreamshaper refines each frame via img2img at 40 % strength. Sequential load \u2014 no extra VRAM cost vs Balanced. Slower wall-clock, higher quality finish."
  }
];
function resolveQualityTier(tier) {
  const found = QUALITY_TIERS.find((t) => t.id === tier) ?? QUALITY_TIERS[0];
  return { primary: found.primary, refinement: found.refinement };
}
function resolveEffectiveChain(opts) {
  if (opts.showAdvanced) {
    const refinement = opts.customRefinement && opts.customRefinement !== opts.advancedModel ? opts.customRefinement : null;
    return { primary: opts.advancedModel, refinement, overridesQuality: true };
  }
  const tier = resolveQualityTier(opts.quality);
  return { primary: tier.primary, refinement: tier.refinement ?? null, overridesQuality: false };
}
function describeChain(chain) {
  return chain.refinement ? `${chain.primary} \u2192 ${chain.refinement} (two-pass)` : `${chain.primary} (single pass)`;
}
function EffectiveChainBadge(props) {
  const chain = resolveEffectiveChain(props);
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
    "p",
    {
      className: "bfs-hint",
      style: {
        marginTop: 6,
        padding: "6px 8px",
        borderRadius: 6,
        border: "1px solid var(--bfs-border)",
        background: "var(--bfs-surface, transparent)"
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("strong", { children: "Effective model chain:" }),
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "bfs-mono", children: describeChain(chain) }),
        chain.overridesQuality ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
          " ",
          "\u2014 Advanced model override is active, so the ",
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("strong", { children: "Quality" }),
          " tier above is ignored.",
          " ",
          chain.refinement ? "A custom two-pass chain is set (draft \u2192 refine)." : "Add a refinement model below for a custom two-pass chain, or close Advanced to use the tier."
        ] }) : null
      ]
    }
  );
}
function CustomRefinementPicker({
  primary,
  value,
  onChange,
  disabled
}) {
  const options = Object.keys(import_builderforce_studio2.MODEL_REGISTRY).filter(
    (id) => id !== primary
  );
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "bfs-field", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("label", { className: "bfs-label", children: "Refinement model (custom two-pass)" }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
      "select",
      {
        className: "bfs-select",
        value: value ?? "",
        onChange: (e) => onChange(e.target.value || null),
        disabled,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "", children: "None (single pass)" }),
          options.map((id) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: id, children: id }, id))
        ]
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "bfs-hint", children: "Optional second pass: the primary model lays in composition, this model refines each frame via img2img. Picks any draft/refine pair (e.g. sd-turbo \u2192 lcm-dreamshaper), generalising the fixed Refined tier." })
  ] });
}
function QualityTierPicker({ value, onChange, disabled }) {
  const current = QUALITY_TIERS.find((t) => t.id === value) ?? QUALITY_TIERS[0];
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "bfs-field", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("label", { className: "bfs-label", children: "Quality" }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "bfs-radio-row", children: QUALITY_TIERS.map((tier) => {
      const active = tier.id === value;
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        "button",
        {
          type: "button",
          onClick: () => onChange(tier.id),
          disabled,
          className: "bfs-btn bfs-btn-secondary",
          "aria-pressed": active,
          style: {
            flex: 1,
            padding: "8px 10px",
            fontSize: "0.85rem",
            fontWeight: 600,
            background: active ? "var(--bfs-accent)" : "transparent",
            color: active ? "white" : "var(--bfs-fg)",
            borderColor: active ? "var(--bfs-accent)" : "var(--bfs-border)"
          },
          children: tier.label
        },
        tier.id
      );
    }) }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "bfs-hint", children: current.description })
  ] });
}

// src/components/StoryboardEditor.tsx
var import_builderforce_studio3 = require("@seanhogg/builderforce-studio");
var import_jsx_runtime7 = require("react/jsx-runtime");
function uniqueId(prefix, taken) {
  let n = 1;
  while (taken.has(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}
function StoryboardEditor({
  storyboard,
  onChange,
  onRender,
  onReplan,
  validations,
  busy
}) {
  const { shots, characters } = storyboard;
  const totalFrames = (0, import_builderforce_studio3.storyboardFrameCount)(storyboard);
  const validationByShot = new Map((validations ?? []).map((v) => [v.shotId, v.validation]));
  const updateShot = (idx, patch) => onChange({ ...storyboard, shots: shots.map((s, i) => i === idx ? { ...s, ...patch } : s) });
  const addShot = () => {
    const id = uniqueId("shot", new Set(shots.map((s) => s.id)));
    const newShot = {
      id,
      prompt: "",
      characterIds: [],
      camera: "static",
      action: "",
      durationFrames: 4
    };
    onChange({ ...storyboard, shots: [...shots, newShot] });
  };
  const removeShot = (idx) => onChange({ ...storyboard, shots: shots.filter((_, i) => i !== idx) });
  const moveShot = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= shots.length) return;
    const next = shots.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange({ ...storyboard, shots: next });
  };
  const toggleShotCharacter = (idx, charId) => {
    const has = shots[idx].characterIds.includes(charId);
    const characterIds = has ? shots[idx].characterIds.filter((c) => c !== charId) : [...shots[idx].characterIds, charId];
    updateShot(idx, { characterIds });
  };
  const updateCharacter = (idx, patch) => onChange({
    ...storyboard,
    characters: characters.map((c, i) => i === idx ? { ...c, ...patch } : c)
  });
  const addCharacter = () => {
    const id = uniqueId("char", new Set(characters.map((c) => c.id)));
    onChange({
      ...storyboard,
      characters: [...characters, { id, name: "New character", appearance: "" }]
    });
  };
  const removeCharacter = (idx) => {
    const removedId = characters[idx].id;
    onChange({
      ...storyboard,
      characters: characters.filter((_, i) => i !== idx),
      // Drop the removed character from every shot's cast so no shot references
      // a deleted id (the engine would otherwise just ignore it, but the UI
      // should stay consistent).
      shots: shots.map((s) => ({
        ...s,
        characterIds: s.characterIds.filter((cid) => cid !== removedId)
      }))
    });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "bfs-field", style: { border: "1px solid var(--bfs-border)", borderRadius: 8, padding: 12 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("strong", { style: { fontSize: "0.9rem" }, children: "Storyboard" }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { className: "bfs-hint", style: { margin: 0 }, children: [
        shots.length,
        " shots \xB7 ",
        totalFrames,
        " frames"
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("p", { className: "bfs-hint", style: { marginTop: 6 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("strong", { children: "Treatment:" }),
      " ",
      storyboard.treatment
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { marginTop: 8 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "bfs-label", children: "Cast" }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
          "button",
          {
            type: "button",
            className: "bfs-btn bfs-btn-secondary",
            onClick: addCharacter,
            disabled: busy,
            style: { fontSize: "0.75rem", padding: "2px 8px" },
            children: "+ Character"
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }, children: characters.map((c, i) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "bfs-row", style: { alignItems: "center" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
          "input",
          {
            className: "bfs-input",
            style: { flex: "0 0 30%", fontSize: "0.8rem" },
            value: c.name,
            onChange: (e) => updateCharacter(i, { name: e.target.value }),
            disabled: busy,
            "aria-label": `Character ${i + 1} name`
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
          "input",
          {
            className: "bfs-input",
            style: { flex: 1, fontSize: "0.8rem" },
            placeholder: "locked appearance (age, build, hair, wardrobe, palette)",
            value: c.appearance,
            onChange: (e) => updateCharacter(i, { appearance: e.target.value }),
            disabled: busy,
            "aria-label": `Character ${i + 1} appearance`
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
          "button",
          {
            type: "button",
            className: "bfs-btn bfs-btn-secondary",
            onClick: () => removeCharacter(i),
            disabled: busy,
            title: "Remove character",
            style: { fontSize: "0.75rem", padding: "2px 8px" },
            children: "\u2715"
          }
        )
      ] }, c.id)) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }, children: shots.map((shot, idx) => {
      const verdict = validationByShot.get(shot.id);
      return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
        "div",
        {
          style: {
            border: "1px solid var(--bfs-border)",
            borderRadius: 6,
            padding: 8,
            display: "flex",
            flexDirection: "column",
            gap: 6
          },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { style: { fontWeight: 600, fontSize: "0.8rem" }, children: [
                "Shot ",
                idx + 1
              ] }),
              verdict && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(ValidationBadge, { ok: verdict.ok, score: verdict.score }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { flex: 1 } }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { type: "button", className: "bfs-btn bfs-btn-secondary", onClick: () => moveShot(idx, -1), disabled: busy || idx === 0, title: "Move up", style: { fontSize: "0.75rem", padding: "2px 6px" }, children: "\u2191" }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { type: "button", className: "bfs-btn bfs-btn-secondary", onClick: () => moveShot(idx, 1), disabled: busy || idx === shots.length - 1, title: "Move down", style: { fontSize: "0.75rem", padding: "2px 6px" }, children: "\u2193" }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { type: "button", className: "bfs-btn bfs-btn-secondary", onClick: () => removeShot(idx), disabled: busy, title: "Delete shot", style: { fontSize: "0.75rem", padding: "2px 6px" }, children: "\u2715" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
              "textarea",
              {
                className: "bfs-prompt",
                rows: 2,
                value: shot.prompt,
                onChange: (e) => updateShot(idx, { prompt: e.target.value }),
                disabled: busy,
                style: { fontSize: "0.8rem" },
                "aria-label": `Shot ${idx + 1} prompt`
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "bfs-row", children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "bfs-field bfs-flex", style: { margin: 0 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("label", { className: "bfs-label", children: "Camera" }),
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
                  "select",
                  {
                    className: "bfs-input",
                    value: shot.camera,
                    onChange: (e) => updateShot(idx, { camera: e.target.value }),
                    disabled: busy,
                    children: import_builderforce_studio3.CAMERA_MOVES.map((m) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: m, children: m }, m))
                  }
                )
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "bfs-field bfs-flex", style: { margin: 0 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("label", { className: "bfs-label", children: "Frames" }),
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
                  "input",
                  {
                    type: "number",
                    className: "bfs-input",
                    min: 1,
                    max: 120,
                    value: shot.durationFrames,
                    onChange: (e) => updateShot(idx, {
                      durationFrames: Math.max(1, Math.min(120, Number(e.target.value) || 1))
                    }),
                    disabled: busy
                  }
                )
              ] })
            ] }),
            characters.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { display: "flex", flexWrap: "wrap", gap: 8 }, children: characters.map((c) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 4, fontSize: "0.75rem", cursor: "pointer" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
                "input",
                {
                  type: "checkbox",
                  checked: shot.characterIds.includes(c.id),
                  onChange: () => toggleShotCharacter(idx, c.id),
                  disabled: busy
                }
              ),
              c.name
            ] }, c.id)) }),
            verdict && verdict.issues.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "bfs-hint", style: { margin: 0 }, children: verdict.issues.map((i) => `${i.kind}: ${i.detail}`).join(" \xB7 ") })
          ]
        },
        shot.id
      );
    }) }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
      "button",
      {
        type: "button",
        className: "bfs-btn bfs-btn-secondary",
        onClick: addShot,
        disabled: busy,
        style: { marginTop: 8, fontSize: "0.8rem" },
        children: "+ Add shot"
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "bfs-actions", style: { marginTop: 10 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { type: "button", className: "bfs-btn bfs-btn-secondary", onClick: onReplan, disabled: busy, children: "Re-plan" }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
        "button",
        {
          type: "button",
          className: "bfs-btn bfs-btn-primary",
          onClick: onRender,
          disabled: busy || shots.length === 0,
          children: "Render storyboard"
        }
      )
    ] })
  ] });
}
function ValidationBadge({ ok, score }) {
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
    "span",
    {
      style: {
        fontSize: "0.7rem",
        fontWeight: 700,
        padding: "2px 6px",
        borderRadius: 4,
        color: "white",
        background: ok ? "#16a34a" : "#dc2626"
      },
      title: `VLM score ${score.toFixed(2)}`,
      children: [
        ok ? "\u2713" : "\u2717",
        " ",
        (score * 100).toFixed(0),
        "%"
      ]
    }
  );
}

// src/components/useEngineStatus.ts
var import_react3 = require("react");
var import_builderforce_studio4 = require("@seanhogg/builderforce-studio");
function useEngineStatus() {
  const [status, setStatus] = (0, import_react3.useState)({ state: "probing" });
  const probedRef = (0, import_react3.useRef)(null);
  (0, import_react3.useEffect)(() => {
    let cancelled = false;
    (0, import_builderforce_studio4.probeDevice)("auto").then((device) => {
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
var import_jsx_runtime8 = require("react/jsx-runtime");
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
  const engineRef = (0, import_react4.useRef)(null);
  const abortRef = (0, import_react4.useRef)(null);
  const [prompt, setPrompt] = (0, import_react4.useState)("");
  const [quality, setQuality] = (0, import_react4.useState)("fast");
  const [model, setModel] = (0, import_react4.useState)(defaultModel);
  const [refinementOverride, setRefinementOverride] = (0, import_react4.useState)(null);
  const [showAdvanced, setShowAdvanced] = (0, import_react4.useState)(false);
  const [resolution, setResolution] = (0, import_react4.useState)(DEFAULT_RESOLUTION);
  const [coherenceMode, setCoherenceMode] = (0, import_react4.useState)(defaultCoherence);
  const [coherenceStrength, setCoherenceStrength] = (0, import_react4.useState)(0.5);
  const [motionAmount, setMotionAmount] = (0, import_react4.useState)(0.15);
  const [imgToImgStrength, setImgToImgStrength] = (0, import_react4.useState)(0);
  const [anchorRefreshInterval, setAnchorRefreshInterval] = (0, import_react4.useState)(0);
  const [cameraDx, setCameraDx] = (0, import_react4.useState)(0);
  const [cameraDy, setCameraDy] = (0, import_react4.useState)(0);
  const [frames, setFrames] = (0, import_react4.useState)(defaultFrames);
  const [fps, setFps] = (0, import_react4.useState)(defaultFps);
  const [interpolationFactor, setInterpolationFactor] = (0, import_react4.useState)(1);
  const [cinematic, setCinematic] = (0, import_react4.useState)(false);
  const [storyboard, setStoryboard] = (0, import_react4.useState)(null);
  const [validations, setValidations] = (0, import_react4.useState)([]);
  const [validate, setValidate] = (0, import_react4.useState)(false);
  const [interpolationBackend, setInterpolationBackend] = (0, import_react4.useState)("latent-slerp");
  (0, import_react4.useEffect)(() => {
    disposeEngineAndOutputs();
  }, [quality, resolution, model, showAdvanced, refinementOverride]);
  const [isGenerating, setIsGenerating] = (0, import_react4.useState)(false);
  const [progressLabel, setProgressLabel] = (0, import_react4.useState)("");
  const [framesDone, setFramesDone] = (0, import_react4.useState)(0);
  const [expandedPrompt, setExpandedPrompt] = (0, import_react4.useState)("");
  const [previewFrames, setPreviewFrames] = (0, import_react4.useState)([]);
  const [videoUrl, setVideoUrl] = (0, import_react4.useState)(null);
  const [result, setResult] = (0, import_react4.useState)(null);
  const [error, setError] = (0, import_react4.useState)(null);
  const [currentVersionId, setCurrentVersionId] = (0, import_react4.useState)(null);
  (0, import_react4.useEffect)(() => {
    if (promptValue !== void 0 && promptValue !== prompt) {
      setPrompt(promptValue);
    }
  }, [promptValue]);
  const previewFramesRef = (0, import_react4.useRef)([]);
  const resultRef = (0, import_react4.useRef)(null);
  const videoUrlRef = (0, import_react4.useRef)(null);
  (0, import_react4.useEffect)(() => {
    previewFramesRef.current = previewFrames;
  }, [previewFrames]);
  (0, import_react4.useEffect)(() => {
    resultRef.current = result;
  }, [result]);
  (0, import_react4.useEffect)(() => {
    videoUrlRef.current = videoUrl;
  }, [videoUrl]);
  const releaseVideoOutputs = (0, import_react4.useCallback)(() => {
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
  const disposeEngineAndOutputs = (0, import_react4.useCallback)(() => {
    releaseVideoOutputs();
    const engine = engineRef.current;
    engineRef.current = null;
    if (engine) void engine.dispose();
  }, [releaseVideoOutputs]);
  (0, import_react4.useEffect)(() => {
    return () => {
      disposeEngineAndOutputs();
    };
  }, [disposeEngineAndOutputs]);
  const handleProgress = (0, import_react4.useCallback)((label) => setProgressLabel(label), []);
  const handleFrame = (0, import_react4.useCallback)((idx, bitmap) => {
    setPreviewFrames((prev) => [...prev, bitmap]);
    setFramesDone(idx + 1);
  }, []);
  const ensureEngine = (0, import_react4.useCallback)(async () => {
    if (engineRef.current) return engineRef.current;
    const chain = resolveEffectiveChain({
      showAdvanced,
      advancedModel: model,
      quality,
      customRefinement: refinementOverride
    });
    const engine = await import_builderforce_studio5.VideoEngine.create({
      apiKey: token,
      baseUrl,
      model: chain.primary,
      refinementModel: chain.refinement ?? void 0,
      mambaState: initialMambaState,
      width: resolution,
      height: resolution,
      onProgress: handleProgress
    });
    if (!engine) throw new Error("Engine refused to start on this device.");
    engineRef.current = engine;
    return engine;
  }, [token, baseUrl, quality, showAdvanced, model, refinementOverride, initialMambaState, resolution, handleProgress]);
  const finishGeneration = (0, import_react4.useCallback)(
    async (generated, wasCinematic) => {
      const url = URL.createObjectURL(generated.blob);
      setVideoUrl(url);
      setResult(generated);
      setPreviewFrames(generated.frames);
      onVideoGenerated?.(generated.blob, generated.mambaState);
      if (onSaveVersion) {
        try {
          const chain = resolveEffectiveChain({
            showAdvanced,
            advancedModel: model,
            quality,
            customRefinement: refinementOverride
          });
          const params = {
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
      setProgressLabel(
        `Done in ${(generated.elapsedMs / 1e3).toFixed(1)}s on ${generated.activeDevice.toUpperCase()}.`
      );
    },
    [
      onVideoGenerated,
      onSaveVersion,
      quality,
      showAdvanced,
      model,
      refinementOverride,
      resolution,
      prompt,
      frames,
      fps,
      interpolationFactor,
      interpolationBackend,
      coherenceMode,
      coherenceStrength,
      motionAmount,
      imgToImgStrength,
      anchorRefreshInterval,
      cameraDx,
      cameraDy,
      currentVersionId,
      storyboard,
      validate
    ]
  );
  const runGeneration = (0, import_react4.useCallback)(
    async (produce, wasCinematic) => {
      if (status.state !== "ready" || !token) {
        if (!token) setError("Missing Builderforce auth token (pass authToken).");
        return;
      }
      setError(null);
      setIsGenerating(true);
      setFramesDone(0);
      setProgressLabel("Initialising engine\u2026");
      releaseVideoOutputs();
      const abort = new AbortController();
      abortRef.current = abort;
      try {
        const engine = await ensureEngine();
        const generated = await produce(engine, abort.signal);
        await finishGeneration(generated, wasCinematic);
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
    },
    [status.state, token, releaseVideoOutputs, ensureEngine, finishGeneration]
  );
  const handlePlan = (0, import_react4.useCallback)(async () => {
    if (status.state !== "ready") return;
    if (!prompt.trim()) {
      setError("Enter a prompt before planning.");
      return;
    }
    if (!token) {
      setError("Missing Builderforce auth token (pass authToken).");
      return;
    }
    setError(null);
    setIsGenerating(true);
    setStoryboard(null);
    setValidations([]);
    setProgressLabel("Planning storyboard via Director + Shot Planner\u2026");
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const planned = await (0, import_builderforce_studio5.planScene)({
        apiKey: token,
        baseUrl,
        request: prompt,
        totalFrames: frames,
        signal: abort.signal
      });
      setStoryboard(planned);
      setExpandedPrompt(planned.treatment);
      setProgressLabel(`Storyboard ready \u2014 ${planned.shots.length} shots. Review, then Render.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setProgressLabel("");
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [status.state, prompt, token, baseUrl, frames]);
  const handleRenderStoryboard = (0, import_react4.useCallback)(async () => {
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
        validatorModel: void 0,
        signal,
        onProgress: handleProgress,
        onFrame: handleFrame
      });
      setValidations(sb.validations);
      return {
        blob: sb.blob,
        mambaState: sb.mambaState,
        frames: sb.frames,
        activeDevice: sb.activeDevice,
        resolvedPrompt: sb.storyboard.treatment,
        elapsedMs: sb.elapsedMs
      };
    }, true);
  }, [
    storyboard,
    runGeneration,
    fps,
    coherenceMode,
    coherenceStrength,
    motionAmount,
    interpolationFactor,
    interpolationBackend,
    validate,
    handleProgress,
    handleFrame
  ]);
  const handleGenerate = (0, import_react4.useCallback)(async () => {
    if (cinematic) {
      await handlePlan();
      return;
    }
    if (!prompt.trim()) {
      setError("Enter a prompt before generating.");
      return;
    }
    await runGeneration(
      (engine, signal) => engine.generate({
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
        cameraMotion: imgToImgStrength > 0 && (cameraDx !== 0 || cameraDy !== 0) ? { dx: cameraDx, dy: cameraDy } : void 0,
        signal,
        onPromptExpanded: setExpandedPrompt,
        onProgress: handleProgress,
        onFrame: handleFrame
      }),
      false
    );
  }, [
    cinematic,
    handlePlan,
    prompt,
    runGeneration,
    frames,
    fps,
    coherenceMode,
    coherenceStrength,
    motionAmount,
    imgToImgStrength,
    anchorRefreshInterval,
    interpolationFactor,
    interpolationBackend,
    cameraDx,
    cameraDy,
    handleProgress,
    handleFrame
  ]);
  const handleCancel = (0, import_react4.useCallback)(() => {
    abortRef.current?.abort();
  }, []);
  const handleNewProject = (0, import_react4.useCallback)(() => {
    if (isGenerating) return;
    if ((prompt.trim() || result) && typeof window !== "undefined" && !window.confirm(
      "Start a new video project? This clears the current prompt, preview, and continuity memory. Saved versions are kept."
    )) {
      return;
    }
    disposeEngineAndOutputs();
    setPrompt("");
    onPromptChange?.("");
    setExpandedPrompt("");
    setError(null);
    setCurrentVersionId(null);
    setFramesDone(0);
    setProgressLabel("New project \u2014 continuity memory cleared. Enter a prompt to generate v1.");
  }, [isGenerating, prompt, result, disposeEngineAndOutputs, onPromptChange]);
  const handleDownload = (0, import_react4.useCallback)(() => {
    if (!result) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(result.blob);
    a.download = `builderforce-video-${Date.now()}.mp4`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5e3);
  }, [result]);
  const handleLoadVersion = (0, import_react4.useCallback)(async (entry) => {
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
      setShowAdvanced(p.advanced ?? false);
      setRefinementOverride(p.advanced ? p.refinementModel ?? null : null);
      if (p.quality) setQuality(p.quality);
      setInterpolationFactor(p.interpolationFactor ?? 1);
      setInterpolationBackend(p.interpolationBackend ?? "latent-slerp");
      setCinematic(p.cinematic ?? false);
      setValidate(p.validate ?? false);
      setStoryboard(p.storyboard ?? null);
      setValidations([]);
      const knownRes = RESOLUTION_PRESETS.find((r) => r === p.width);
      if (knownRes) setResolution(knownRes);
      setFrames(p.frames);
      setFps(p.fps);
      setCoherenceMode(p.coherence);
      setCoherenceStrength(p.coherenceStrength);
      setMotionAmount(p.motionAmount);
      setImgToImgStrength(p.imgToImgStrength);
      setAnchorRefreshInterval(p.anchorRefreshInterval ?? 0);
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
    return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "bfs-root bfs-state-probing", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "bfs-spinner" }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { children: "Probing hardware (WebNN \u2192 WebGPU \u2192 CPU)\u2026" })
    ] });
  }
  if (status.state === "unsupported") {
    return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "bfs-root bfs-state-unsupported", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h2", { children: "AI Video Studio unavailable" }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { children: status.reason }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "bfs-hint", children: "Open this page in Chrome 113+ or Edge 113+ with hardware acceleration enabled." })
    ] });
  }
  const device = status.device;
  const effectiveChain = resolveEffectiveChain({
    showAdvanced,
    advancedModel: model,
    quality,
    customRefinement: refinementOverride
  });
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "bfs-root", children: [
    !hideHeader && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("header", { className: "bfs-header", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h1", { className: "bfs-title", children: "AI Video Studio" }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("p", { className: "bfs-subtitle", children: [
        "Running on ",
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("strong", { children: device.label }),
        device.approxMemoryMb ? ` \xB7 ~${(device.approxMemoryMb / 1024).toFixed(1)} GB available` : ""
      ] })
    ] }) }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "bfs-grid", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("section", { className: "bfs-controls", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
          "div",
          {
            style: { display: "flex", justifyContent: "flex-end", marginBottom: 4 },
            children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
              "button",
              {
                type: "button",
                className: "bfs-btn bfs-btn-secondary",
                onClick: handleNewProject,
                disabled: isGenerating,
                title: "Clear the current prompt, preview, and continuity (Mamba) memory and start a fresh project. Saved versions are kept.",
                style: { fontSize: "0.8rem", padding: "4px 10px" },
                children: "\uFF0B New project"
              }
            )
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "bfs-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("label", { className: "bfs-label", htmlFor: "bfs-prompt", children: "What video do you want to generate?" }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
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
          expandedPrompt && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("p", { className: "bfs-hint", children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("strong", { children: "Expanded:" }),
            " ",
            expandedPrompt
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
          QualityTierPicker,
          {
            value: quality,
            onChange: setQuality,
            disabled: isGenerating || showAdvanced
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
          EffectiveChainBadge,
          {
            showAdvanced,
            advancedModel: model,
            quality,
            customRefinement: refinementOverride
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
          "label",
          {
            className: "bfs-field",
            style: { display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                "input",
                {
                  type: "checkbox",
                  checked: cinematic,
                  onChange: (e) => {
                    setCinematic(e.target.checked);
                    if (!e.target.checked) {
                      setStoryboard(null);
                      setValidations([]);
                    }
                  },
                  disabled: isGenerating,
                  style: { marginTop: 3 }
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bfs-label", style: { display: "block" }, children: "Cinematic (auto-storyboard)" }),
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bfs-hint", children: "Plans a multi-shot scene with characters and camera moves, then renders each shot." })
              ] })
            ]
          }
        ),
        cinematic && storyboard && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
          StoryboardEditor,
          {
            storyboard,
            onChange: setStoryboard,
            onRender: handleRenderStoryboard,
            onReplan: handlePlan,
            validations,
            busy: isGenerating
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
          "details",
          {
            className: "bfs-field",
            open: showAdvanced,
            onToggle: (e) => setShowAdvanced(e.target.open),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                "summary",
                {
                  style: {
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    padding: "8px 0",
                    userSelect: "none"
                  },
                  children: "Advanced controls"
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: { marginTop: 12 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(ModelPicker, { value: model, onChange: setModel, disabled: isGenerating }),
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "bfs-hint", children: "Overrides the Quality preset above. When this is set, the engine uses this model directly \u2014 add a refinement model below for a custom two-pass chain." })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: { marginTop: 12 }, children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                CustomRefinementPicker,
                {
                  primary: model,
                  value: refinementOverride,
                  onChange: setRefinementOverride,
                  disabled: isGenerating
                }
              ) }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "bfs-field", style: { marginTop: 12 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("label", { className: "bfs-label", children: "Resolution" }),
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "bfs-radio-row", children: RESOLUTION_PRESETS.map((px) => {
                  const active = resolution === px;
                  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
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
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "bfs-hint", children: "Lower = faster + fits weaker GPUs (4\xD7 less compute per step at 256). Higher = sharper, more VRAM, may trip Windows GPU timeouts." })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "bfs-row", style: { marginTop: 12 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "bfs-field bfs-flex", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("label", { className: "bfs-label", children: "Frames" }),
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
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
                /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "bfs-field bfs-flex", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("label", { className: "bfs-label", children: "FPS" }),
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
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
                /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "bfs-field bfs-flex", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("label", { className: "bfs-label", children: "Duration" }),
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "bfs-readout", children: [
                    (frames / fps).toFixed(2),
                    "s"
                  ] })
                ] })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "bfs-field", style: { marginTop: 12 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("label", { className: "bfs-label", children: "Keyframe interpolation" }),
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "bfs-radio-row", children: [1, 2, 4].map((f) => {
                  const active = interpolationFactor === f;
                  return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                    "button",
                    {
                      type: "button",
                      onClick: () => setInterpolationFactor(f),
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
                      children: f === 1 ? "Off" : `${f}\xD7`
                    },
                    f
                  );
                }) }),
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "bfs-hint", children: "Off = every frame fully generated (sharpest, slowest). 2\xD7/4\xD7 generate keyframes and interpolate the rest \u2014 roughly N\xD7 fewer denoise passes for smooth motion." })
              ] }),
              interpolationFactor > 1 && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "bfs-field", style: { marginTop: 12 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("label", { className: "bfs-label", children: "Interpolation backend" }),
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "bfs-radio-row", children: [
                  ["latent-slerp", "Latent (smooth)"],
                  ["motion", "Motion (optical flow)"]
                ].map(([id, lbl]) => {
                  const active = interpolationBackend === id;
                  return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                    "button",
                    {
                      type: "button",
                      onClick: () => setInterpolationBackend(id),
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
                      children: lbl
                    },
                    id
                  );
                }) }),
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "bfs-hint", children: "Latent = morph between keyframes (smooth, no motion). Motion = block optical-flow warp so moving subjects actually slide between keyframes." })
              ] }),
              cinematic && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
                "label",
                {
                  className: "bfs-field",
                  style: { display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", marginTop: 12 },
                  children: [
                    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                      "input",
                      {
                        type: "checkbox",
                        checked: validate,
                        onChange: (e) => setValidate(e.target.checked),
                        disabled: isGenerating,
                        style: { marginTop: 3 }
                      }
                    ),
                    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { children: [
                      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bfs-label", style: { display: "block" }, children: "Validate shots (VLM) + self-heal" }),
                      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bfs-hint", children: "Checks each shot's first/last keyframe against the prompt + characters via a vision model, and re-renders a failing shot once with a fresh seed." })
                    ] })
                  ]
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
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
              imgToImgStrength > 0 && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "bfs-field", style: { marginTop: 12 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("label", { className: "bfs-label", htmlFor: "bfs-anchor-refresh", children: "Anchor refresh (img2img drift bound)" }),
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                  "input",
                  {
                    id: "bfs-anchor-refresh",
                    type: "number",
                    className: "bfs-input",
                    min: 0,
                    max: 120,
                    value: anchorRefreshInterval,
                    onChange: (e) => setAnchorRefreshInterval(Math.max(0, Math.min(120, Number(e.target.value) || 0))),
                    disabled: isGenerating
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "bfs-hint", children: "Restart from fresh noise every N keyframes so long clips don't progressively blur as img2img recursion accumulates VAE round-trip error. 0 = never refresh (carry content forward indefinitely). Try 8\u201312 for clips past ~30 frames." })
              ] })
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "bfs-actions", children: [
          isGenerating ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { type: "button", className: "bfs-btn bfs-btn-danger", onClick: handleCancel, children: "Cancel" }) : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
            "button",
            {
              type: "button",
              className: "bfs-btn bfs-btn-primary",
              onClick: handleGenerate,
              disabled: !prompt.trim(),
              children: cinematic ? "Plan storyboard" : currentVersionId ? `Generate v${(versions?.length ?? 0) + 1} (edit of current)` : "Generate video"
            }
          ),
          result && !isGenerating && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { type: "button", className: "bfs-btn bfs-btn-secondary", onClick: handleDownload, children: "Download MP4" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("section", { className: "bfs-preview-pane", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
          VideoPreview,
          {
            frames: previewFrames,
            videoUrl,
            width: resolution,
            height: resolution,
            loading: isGenerating ? {
              label: progressLabel || "Initialising\u2026",
              framesDone,
              // Cinematic mode renders the storyboard's total (sum of every
              // shot's durationFrames), NOT the single-clip `frames` input —
              // the engine emits one onFrame per storyboard frame, so a 50-
              // frame storyboard would otherwise read "28 / 16". Falls back
              // to `frames` for the single-clip path / pre-plan phase.
              framesTotal: cinematic && storyboard ? (0, import_builderforce_studio5.storyboardFrameCount)(storyboard) : frames
            } : null
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(ProgressFeedback, { progressLabel, error }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: { marginTop: 12 }, children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
          DebugCopyButton,
          {
            prompt,
            expandedPrompt,
            quality,
            model: effectiveChain.primary,
            refinementModel: effectiveChain.refinement,
            resolution,
            frames,
            fps,
            interpolationFactor,
            coherenceMode,
            coherenceStrength,
            motionAmount,
            imgToImgStrength,
            anchorRefreshInterval,
            cameraMotion: imgToImgStrength > 0 && (cameraDx !== 0 || cameraDy !== 0) ? { dx: cameraDx, dy: cameraDy } : null,
            device: status.state === "ready" ? status.device : null,
            progressLabel,
            error,
            result,
            previewFrames,
            currentVersionId
          }
        ) }),
        result && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("dl", { className: "bfs-meta", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("dt", { children: "Device" }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("dd", { children: result.activeDevice.toUpperCase() }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("dt", { children: "Frames" }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("dd", { children: result.frames.length }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("dt", { children: "Mamba step" }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("dd", { children: result.mambaState.step }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("dt", { children: "Elapsed" }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("dd", { children: [
            (result.elapsedMs / 1e3).toFixed(2),
            "s"
          ] })
        ] }),
        versions && versions.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "bfs-field", style: { marginTop: 16 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("label", { className: "bfs-label", children: [
            "Versions (",
            versions.length,
            ")"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "bfs-version-list", children: versions.map((v) => {
            const isCurrent = v.id === currentVersionId;
            return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
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
                  v.thumbnailUrl ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                    "img",
                    {
                      src: v.thumbnailUrl,
                      alt: "",
                      width: 32,
                      height: 32,
                      style: { borderRadius: 4, objectFit: "cover" }
                    }
                  ) : null,
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { style: { flex: 1 }, children: v.label }),
                  v.params.parentVersionId ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bfs-mono", style: { fontSize: "0.7rem", opacity: 0.7 }, children: "\u21AA edit" }) : null
                ]
              },
              v.id
            );
          }) }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "bfs-hint", children: "Click a version to load it as the base. Generating again creates a new version with this one as parent (edit-on-top)." })
        ] }) : null
      ] })
    ] })
  ] });
}

// src/index.ts
var import_builderforce_studio6 = require("@seanhogg/builderforce-studio");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CAMERA_MOVES,
  CoherenceControls,
  DebugCopyButton,
  MODEL_REGISTRY,
  ModelPicker,
  ProgressFeedback,
  QUALITY_TIERS,
  QualityTierPicker,
  StoryboardEditor,
  StudioPanel,
  VideoEngine,
  VideoPreview,
  configureOnnxRuntime,
  hasWebGPUSupport,
  planScene,
  probeDevice,
  resolveQualityTier,
  useEngineStatus
});
//# sourceMappingURL=index.cjs.map