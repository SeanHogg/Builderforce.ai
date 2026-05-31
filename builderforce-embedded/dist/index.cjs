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
  BFEMBED_SOURCE: () => BFEMBED_SOURCE,
  BuilderForceEmbed: () => BuilderForceEmbed,
  EMBED_VIEWS: () => EMBED_VIEWS,
  EMBED_VIEW_KEYS: () => EMBED_VIEW_KEYS,
  embedViewsByPillar: () => embedViewsByPillar,
  handleFrameMessage: () => handleFrameMessage,
  isEmbedView: () => isEmbedView,
  isFrameToHostMessage: () => isFrameToHostMessage,
  isHostToFrameMessage: () => isHostToFrameMessage
});
module.exports = __toCommonJS(src_exports);

// src/BuilderForceEmbed.tsx
var import_react = require("react");

// src/protocol.ts
var BFEMBED_SOURCE = "builderforce-embed/v1";
function isTagged(data) {
  return typeof data === "object" && data !== null && data.source === BFEMBED_SOURCE && typeof data.type === "string";
}
function isFrameToHostMessage(data) {
  if (!isTagged(data)) return false;
  switch (data.type) {
    case "ready":
      return true;
    case "resize":
      return typeof data.height === "number";
    case "navigate":
      return typeof data.path === "string";
    case "error":
      return typeof data.message === "string";
    default:
      return false;
  }
}
function isHostToFrameMessage(data) {
  if (!isTagged(data)) return false;
  switch (data.type) {
    case "auth":
      return typeof data.token === "string";
    case "navigate":
      return typeof data.path === "string";
    default:
      return false;
  }
}

// src/messageHandler.ts
function handleFrameMessage(event, h) {
  if (event.origin !== h.embedOrigin) return;
  const msg = event.data;
  if (!isFrameToHostMessage(msg)) return;
  switch (msg.type) {
    case "ready":
      h.onReady();
      return;
    case "resize":
      h.onResize(msg.height);
      return;
    case "navigate":
      h.onNavigate(msg.path);
      return;
    case "error":
      h.onError(msg.message);
      return;
  }
}

// src/views.ts
var EMBED_VIEWS = {
  // Product Management (doc 02)
  ideas: { key: "ideas", label: "Product Discovery", pillar: "product" },
  mvp: { key: "mvp", label: "MVP Scaffolding", pillar: "product" },
  backlog: { key: "backlog", label: "Strategic Backlog", pillar: "product" },
  validation: { key: "validation", label: "Validation Lab", pillar: "product" },
  roadmap: { key: "roadmap", label: "AI Roadmap", pillar: "product" },
  "feature-roi": { key: "feature-roi", label: "Feature ROI", pillar: "product" },
  // Agile Survival (doc 03)
  kanban: { key: "kanban", label: "Kanban", pillar: "agile" },
  poker: { key: "poker", label: "Planning Poker", pillar: "agile" },
  retros: { key: "retros", label: "Retrospectives", pillar: "agile" },
  sprints: { key: "sprints", label: "Sprint Planning", pillar: "agile" },
  velocity: { key: "velocity", label: "Velocity", pillar: "agile" },
  "feature-scoring": { key: "feature-scoring", label: "Feature Scoring", pillar: "agile" },
  // Security, Governance & Compliance (doc 07 — Phase 2)
  soc2: { key: "soc2", label: "SOC 2 Tracker", pillar: "governance" },
  vendors: { key: "vendors", label: "Vendor Register", pillar: "governance" },
  incidents: { key: "incidents", label: "Security Incidents", pillar: "governance" },
  "data-inventory": { key: "data-inventory", label: "PII & Data Inventory", pillar: "governance" },
  dpa: { key: "dpa", label: "DPA Management", pillar: "governance" },
  training: { key: "training", label: "Security Training", pillar: "governance" },
  "compliance-calendar": { key: "compliance-calendar", label: "Compliance Calendar", pillar: "governance" },
  "access-reviews": { key: "access-reviews", label: "Access Reviews", pillar: "governance" },
  "vuln-scans": { key: "vuln-scans", label: "Vulnerability Scans", pillar: "governance" },
  dsr: { key: "dsr", label: "Data Subject Requests", pillar: "governance" },
  suppression: { key: "suppression", label: "Suppression List", pillar: "governance" }
};
var EMBED_VIEW_KEYS = Object.keys(EMBED_VIEWS);
function isEmbedView(value) {
  return Object.prototype.hasOwnProperty.call(EMBED_VIEWS, value);
}
function embedViewsByPillar(pillar) {
  return EMBED_VIEW_KEYS.map((k) => EMBED_VIEWS[k]).filter((v) => v.pillar === pillar);
}

// src/BuilderForceEmbed.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var DEFAULT_BASE_URL = "https://app.builderforce.ai";
var DEFAULT_MIN_HEIGHT = 480;
function BuilderForceEmbed({
  view,
  token,
  baseUrl = DEFAULT_BASE_URL,
  accountId,
  companyId,
  path,
  theme,
  className,
  style,
  minHeight = DEFAULT_MIN_HEIGHT,
  onNavigate,
  onError,
  onReady
}) {
  const iframeRef = (0, import_react.useRef)(null);
  const [height, setHeight] = (0, import_react.useState)(minHeight);
  const [ready, setReady] = (0, import_react.useState)(false);
  const embedOrigin = (0, import_react.useMemo)(() => {
    try {
      return new URL(baseUrl).origin;
    } catch {
      return DEFAULT_BASE_URL;
    }
  }, [baseUrl]);
  const src = (0, import_react.useMemo)(() => {
    const base = `${embedOrigin}/embed/${view}`;
    return path ? `${base}#${encodeURIComponent(path)}` : base;
  }, [embedOrigin, view]);
  const postToFrame = (0, import_react.useCallback)(
    (message) => {
      iframeRef.current?.contentWindow?.postMessage(message, embedOrigin);
    },
    [embedOrigin]
  );
  const sendAuth = (0, import_react.useCallback)(async () => {
    const resolved = typeof token === "function" ? await token() : token;
    postToFrame({
      source: BFEMBED_SOURCE,
      type: "auth",
      token: resolved,
      accountId,
      companyId,
      theme
    });
  }, [token, accountId, companyId, theme, postToFrame]);
  (0, import_react.useEffect)(() => {
    const listener = (event) => handleFrameMessage(event, {
      embedOrigin,
      onReady: () => {
        setReady(true);
        void sendAuth();
        onReady?.();
      },
      onResize: (h) => setHeight(Math.max(h, minHeight)),
      onNavigate: (p) => onNavigate?.(p),
      onError: (m) => onError?.(m)
    });
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [embedOrigin, sendAuth, minHeight, onNavigate, onError, onReady]);
  (0, import_react.useEffect)(() => {
    if (ready && path != null) {
      postToFrame({ source: BFEMBED_SOURCE, type: "navigate", path });
    }
  }, [ready, path, postToFrame]);
  const label = EMBED_VIEWS[view]?.label ?? view;
  if (!isEmbedView(view)) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className, style, role: "alert", children: [
      "Unknown BuilderForce view: ",
      String(view)
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className, style: { position: "relative", width: "100%", ...style }, children: [
    !ready && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "div",
      {
        "aria-hidden": true,
        style: {
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#64748b",
          font: "14px system-ui, sans-serif"
        },
        children: [
          "Loading ",
          label,
          "\u2026"
        ]
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "iframe",
      {
        ref: iframeRef,
        src,
        title: `BuilderForce \u2014 ${label}`,
        style: { width: "100%", height, border: "none", display: "block" },
        sandbox: "allow-scripts allow-forms allow-popups allow-same-origin allow-downloads",
        referrerPolicy: "strict-origin-when-cross-origin",
        loading: "lazy"
      }
    )
  ] });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BFEMBED_SOURCE,
  BuilderForceEmbed,
  EMBED_VIEWS,
  EMBED_VIEW_KEYS,
  embedViewsByPillar,
  handleFrameMessage,
  isEmbedView,
  isFrameToHostMessage,
  isHostToFrameMessage
});
//# sourceMappingURL=index.cjs.map