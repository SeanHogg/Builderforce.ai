// src/BuilderForceEmbed.tsx
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

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
var EMBED_CAPABILITIES = ["product", "agile", "security"];
function pillarToCapability(pillar) {
  return pillar === "governance" ? "security" : pillar;
}
var EMBED_VIEWS = {
  // Product Management (CPO/PMO)
  ideas: { key: "ideas", label: "Product Discovery", pillar: "product", available: true },
  prd: { key: "prd", label: "PRDs & Specs", pillar: "product", available: true },
  backlog: { key: "backlog", label: "Strategic Backlog", pillar: "product", available: true },
  mvp: { key: "mvp", label: "MVP Scaffolding", pillar: "product", available: true },
  validation: { key: "validation", label: "Validation Lab", pillar: "product", available: true },
  roadmap: { key: "roadmap", label: "AI Roadmap", pillar: "product", available: true },
  "release-planning": { key: "release-planning", label: "Release Planning", pillar: "product", available: true },
  changelog: { key: "changelog", label: "Changelog", pillar: "product", available: true },
  "feature-flags": { key: "feature-flags", label: "Feature Flags", pillar: "product", available: true },
  "feature-roi": { key: "feature-roi", label: "Feature ROI", pillar: "product", available: true },
  "business-value": { key: "business-value", label: "Business-Value Models", pillar: "product", available: true },
  // Agile Survival (CTO)
  kanban: { key: "kanban", label: "Kanban", pillar: "agile", available: true },
  poker: { key: "poker", label: "Planning Poker", pillar: "agile", available: true },
  retros: { key: "retros", label: "Retrospectives", pillar: "agile", available: true },
  sprints: { key: "sprints", label: "Sprint Planning", pillar: "agile", available: true },
  velocity: { key: "velocity", label: "Velocity", pillar: "agile", available: true },
  capacity: { key: "capacity", label: "Capacity & Risk", pillar: "agile", available: true },
  cost: { key: "cost", label: "Cost / Runway", pillar: "agile", available: true },
  "feature-scoring": { key: "feature-scoring", label: "Feature Scoring", pillar: "agile", available: true },
  // Governance & Security — POSTURE ONLY (governance ⇒ 'security' capability)
  soc2: { key: "soc2", label: "SOC 2 Tracker", pillar: "governance", available: true },
  vendors: { key: "vendors", label: "Vendor Register", pillar: "governance", available: true },
  incidents: { key: "incidents", label: "Security Incidents", pillar: "governance", available: true },
  "data-inventory": { key: "data-inventory", label: "PII & Data Inventory", pillar: "governance", available: true },
  dpa: { key: "dpa", label: "DPA Management", pillar: "governance", available: true },
  training: { key: "training", label: "Security Training", pillar: "governance", available: true },
  "compliance-calendar": { key: "compliance-calendar", label: "Compliance Calendar", pillar: "governance", available: true },
  "access-reviews": { key: "access-reviews", label: "Access Reviews", pillar: "governance", available: true },
  "vuln-scans": { key: "vuln-scans", label: "Vulnerability Scans", pillar: "governance", available: true },
  // Data-privacy tools, scoped per-Segment (NOT identity/RBAC) — BuilderForce
  // provides these; BurnRateOS keeps its own platform-global shared-graph DSR.
  dsr: { key: "dsr", label: "Data Subject Requests", pillar: "governance", available: true },
  suppression: { key: "suppression", label: "Suppression List", pillar: "governance", available: true }
};
var EMBED_VIEW_KEYS = Object.keys(EMBED_VIEWS);
function isEmbedView(value) {
  return Object.prototype.hasOwnProperty.call(EMBED_VIEWS, value);
}
function capabilityForView(view) {
  return pillarToCapability(EMBED_VIEWS[view].pillar);
}

// src/BuilderForceEmbed.tsx
import { jsx, jsxs } from "react/jsx-runtime";
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
  const iframeRef = useRef(null);
  const [height, setHeight] = useState(minHeight);
  const [ready, setReady] = useState(false);
  const embedOrigin = useMemo(() => {
    try {
      return new URL(baseUrl).origin;
    } catch {
      return DEFAULT_BASE_URL;
    }
  }, [baseUrl]);
  const src = useMemo(() => {
    const base = `${embedOrigin}/embed/${view}`;
    return path ? `${base}#${encodeURIComponent(path)}` : base;
  }, [embedOrigin, view]);
  const postToFrame = useCallback(
    (message) => {
      iframeRef.current?.contentWindow?.postMessage(message, embedOrigin);
    },
    [embedOrigin]
  );
  const sendAuth = useCallback(async () => {
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
  useEffect(() => {
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
  useEffect(() => {
    if (ready && path != null) {
      postToFrame({ source: BFEMBED_SOURCE, type: "navigate", path });
    }
  }, [ready, path, postToFrame]);
  const label = EMBED_VIEWS[view]?.label ?? view;
  if (!isEmbedView(view)) {
    return /* @__PURE__ */ jsxs("div", { className, style, role: "alert", children: [
      "Unknown BuilderForce view: ",
      String(view)
    ] });
  }
  return /* @__PURE__ */ jsxs("div", { className, style: { position: "relative", width: "100%", ...style }, children: [
    !ready && /* @__PURE__ */ jsxs(
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
    /* @__PURE__ */ jsx(
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
export {
  BFEMBED_SOURCE,
  BuilderForceEmbed,
  EMBED_CAPABILITIES,
  EMBED_VIEWS,
  EMBED_VIEW_KEYS,
  capabilityForView,
  handleFrameMessage,
  isEmbedView,
  isFrameToHostMessage,
  isHostToFrameMessage,
  pillarToCapability
};
//# sourceMappingURL=index.mjs.map