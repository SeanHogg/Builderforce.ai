"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  BrainTimeline: () => BrainTimeline,
  DEFAULT_TIMELINE_LABELS: () => DEFAULT_TIMELINE_LABELS,
  Markdown: () => Markdown,
  attachmentsOf: () => attachmentsOf,
  buildTimeline: () => buildTimeline,
  formatDuration: () => formatDuration,
  formatPayload: () => formatPayload
});
module.exports = __toCommonJS(src_exports);

// src/BrainTimeline.tsx
var import_react2 = require("react");

// src/Markdown.tsx
var import_react = require("react");
var import_react_markdown = __toESM(require("react-markdown"), 1);
var import_remark_gfm = __toESM(require("remark-gfm"), 1);
var import_jsx_runtime = require("react/jsx-runtime");
var DEFAULT_LABELS = { copy: "Copy", copied: "Copied", apply: "Apply", createFile: "Create file" };
function detectPath(code) {
  const first = code.split("\n", 1)[0] ?? "";
  const m = first.match(/(?:\/\/|#|<!--)\s*(?:path|file):\s*([^\s>]+)/i);
  return m ? m[1].trim() : "";
}
function isExternal(href) {
  return /^(https?:)?\/\//i.test(href) || href.startsWith("mailto:");
}
function CodeBlock({
  code,
  onApplyCode,
  onCreateFile,
  labels
}) {
  const [copied, setCopied] = (0, import_react.useState)(false);
  const copy = () => {
    void navigator.clipboard?.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {
      }
    );
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bf-md__code", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bf-md__code-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "bf-md__code-btn", onClick: copy, children: copied ? labels.copied : labels.copy }),
      onApplyCode && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "bf-md__code-btn", onClick: () => onApplyCode(code), children: labels.apply }),
      onCreateFile && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "bf-md__code-btn", onClick: () => onCreateFile(detectPath(code), code), children: labels.createFile })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: code }) })
  ] });
}
function Markdown({ content, onInternalLink, onApplyCode, onCreateFile, labels }) {
  const lab = { ...DEFAULT_LABELS, ...labels };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bf-md", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_react_markdown.default,
    {
      remarkPlugins: [import_remark_gfm.default],
      components: {
        a({ href, children, ...rest }) {
          const target = href ?? "";
          if (target && !isExternal(target) && onInternalLink) {
            return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "a",
              {
                href: target,
                onClick: (e) => {
                  e.preventDefault();
                  onInternalLink(target);
                },
                ...rest,
                children
              }
            );
          }
          return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href: target, target: "_blank", rel: "noopener noreferrer", ...rest, children });
        },
        code(props) {
          const { inline, className, children } = props;
          const text = String(children ?? "").replace(/\n$/, "");
          if (inline || !className && !text.includes("\n")) {
            return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { className: "bf-md__inline", children });
          }
          return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CodeBlock, { code: text, onApplyCode, onCreateFile, labels: lab });
        },
        pre({ children }) {
          return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children });
        }
      },
      children: content
    }
  ) });
}

// src/timelineModel.ts
var ORDER = {
  user: 0,
  thinking: 1,
  assistant: 2,
  tool: 3,
  error: 4,
  streaming: 5
};
function parseTs(iso, fallback) {
  if (!iso) return fallback;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : fallback;
}
function attachmentsOf(message) {
  if (!message.metadata) return [];
  try {
    const meta = JSON.parse(message.metadata);
    return Array.isArray(meta.attachments) ? meta.attachments : [];
  } catch {
    return [];
  }
}
function stripImageRefs(text, imageNames) {
  if (imageNames.size === 0) return text;
  return text.split("\n").filter((line) => {
    const m = line.match(/^\[Attached:\s*(.+?)\]\((.*)\)\s*$/);
    return !(m && imageNames.has(m[1].trim()));
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
function buildTimeline(input) {
  const nodes = [];
  input.messages.forEach((message, i) => {
    const ts = parseTs(message.createdAt, i);
    if (message.role === "user") {
      const atts = attachmentsOf(message);
      const images = atts.filter((a) => a.imageUrl).map((a) => ({ url: a.imageUrl, name: a.name }));
      const imageNames = new Set(images.map((im) => im.name).filter((n) => !!n));
      nodes.push({
        key: `msg-${message.id}`,
        kind: "user",
        ts,
        order: ORDER.user,
        message,
        text: stripImageRefs(message.content, imageNames),
        images
      });
    } else {
      nodes.push({
        key: `msg-${message.id}`,
        kind: "assistant",
        ts,
        order: ORDER.assistant,
        message,
        text: message.content
      });
    }
  });
  let step = 0;
  input.trace.forEach((ev, i) => {
    const ts = parseTs(ev.ts, 1e15 + i);
    if (ev.category === "llm") {
      nodes.push({ key: `trace-${i}`, kind: "thinking", ts, order: ORDER.thinking, durationMs: ev.durationMs, step: step++ });
    } else if (ev.category === "tool") {
      nodes.push({
        key: `trace-${i}`,
        kind: "tool",
        ts,
        order: ORDER.tool,
        label: ev.label,
        args: ev.args,
        result: ev.result,
        isError: !!ev.isError,
        durationMs: ev.durationMs
      });
    } else if (ev.category === "error") {
      nodes.push({
        key: `trace-${i}`,
        kind: "error",
        ts,
        order: ORDER.error,
        label: ev.label,
        message: typeof ev.result === "string" ? ev.result : JSON.stringify(ev.result ?? "")
      });
    }
  });
  nodes.sort((a, b) => a.ts - b.ts || a.order - b.order);
  if (input.isRunning && input.streamingText.trim()) {
    nodes.push({ key: "streaming", kind: "streaming", ts: Number.MAX_SAFE_INTEGER, order: ORDER.streaming, text: input.streamingText });
  }
  return nodes;
}
function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return "0s";
  if (ms < 1e3) return `${Math.max(0, Math.round(ms / 1e3))}s`;
  if (ms < 6e4) return `${Math.round(ms / 1e3)}s`;
  const m = Math.floor(ms / 6e4);
  const s = Math.round(ms % 6e4 / 1e3);
  return s ? `${m}m ${s}s` : `${m}m`;
}
function formatPayload(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// src/BrainTimeline.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var DEFAULT_TIMELINE_LABELS = {
  thinking: "Thinking\u2026",
  thoughtFor: "Thought for {duration}",
  you: "You",
  assistant: "BuilderForce",
  input: "Input",
  output: "Output",
  error: "Error",
  loading: "Loading\u2026",
  empty: "Ask BuilderForce to build or change something.",
  copy: "Copy",
  copied: "Copied",
  apply: "Apply",
  createFile: "Create file"
};
function dotIcon(kind, isError) {
  if (isError) return "\u2717";
  switch (kind) {
    case "user":
      return "\u203A";
    case "assistant":
      return "\u2726";
    case "thinking":
      return "\u2234";
    case "tool":
      return "\u2699";
    case "error":
      return "\u2717";
    default:
      return "\u2022";
  }
}
function ToolStep({
  node,
  labels
}) {
  const argsText = formatPayload(node.args);
  const resultText = formatPayload(node.result);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { className: `bf-tl__tool${node.isError ? " bf-tl__tool--error" : ""}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("summary", { className: "bf-tl__tool-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "bf-tl__tool-status", "aria-hidden": true, children: node.isError ? "\u2717" : "\u2713" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "bf-tl__tool-name", children: node.label }),
      node.durationMs != null && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "bf-tl__tool-dur", children: formatDuration(node.durationMs) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "bf-tl__tool-caret", "aria-hidden": true, children: "\u25B8" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "bf-tl__tool-body", children: [
      argsText && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "bf-tl__io", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "bf-tl__io-label", children: labels.input }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("pre", { className: "bf-tl__io-pre", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: argsText }) })
      ] }),
      resultText && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "bf-tl__io", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "bf-tl__io-label", children: labels.output }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("pre", { className: "bf-tl__io-pre", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: resultText }) })
      ] })
    ] })
  ] });
}
function BrainTimeline({
  messages,
  trace,
  streamingText,
  isRunning,
  loading,
  labels: labelOverrides,
  assistantName,
  emptyState,
  renderMessage,
  renderStreaming,
  renderAssistantActions,
  onInternalLink,
  onApplyCode,
  onCreateFile,
  autoScroll = true
}) {
  const labels = { ...DEFAULT_TIMELINE_LABELS, ...labelOverrides };
  const assistant = assistantName ?? labels.assistant;
  const nodes = (0, import_react2.useMemo)(
    () => buildTimeline({ messages, trace, streamingText, isRunning }),
    [messages, trace, streamingText, isRunning]
  );
  const scrollRef = (0, import_react2.useRef)(null);
  const pinnedRef = (0, import_react2.useRef)(true);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  (0, import_react2.useEffect)(() => {
    if (!autoScroll || !pinnedRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [nodes, autoScroll]);
  const renderMsg = (msg, role, text) => renderMessage ? renderMessage(msg, { role, text }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
    Markdown,
    {
      content: text,
      onInternalLink,
      onApplyCode: role === "assistant" ? onApplyCode : void 0,
      onCreateFile: role === "assistant" ? onCreateFile : void 0,
      labels
    }
  );
  const isEmpty = nodes.length === 0 && !loading;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "bf-tl-scroll", ref: scrollRef, onScroll, children: [
    loading && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "bf-tl-status", children: labels.loading }),
    isEmpty && (emptyState ?? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "bf-tl-empty", children: labels.empty })),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("ol", { className: "bf-tl", children: [
      nodes.map((node) => {
        if (node.kind === "user") {
          return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { className: "bf-tl__item bf-tl__item--user", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "bf-tl__dot", children: dotIcon("user") }) }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "bf-tl__body", children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "bf-tl__role", children: labels.you }),
              node.images.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "bf-tl__images", children: node.images.map((im, i) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("img", { src: im.url, alt: im.name ?? "", className: "bf-tl__image" }, i)) }),
              node.text && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "bf-tl__bubble bf-tl__bubble--user", children: renderMsg(node.message, "user", node.text) })
            ] })
          ] }, node.key);
        }
        if (node.kind === "assistant") {
          return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { className: "bf-tl__item bf-tl__item--assistant", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "bf-tl__dot", children: dotIcon("assistant") }) }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "bf-tl__body", children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "bf-tl__role", children: assistant }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "bf-tl__bubble", children: renderMsg(node.message, "assistant", node.text) }),
              renderAssistantActions && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "bf-tl__actions", children: renderAssistantActions(node.message) })
            ] })
          ] }, node.key);
        }
        if (node.kind === "thinking") {
          const label = labels.thoughtFor.replace("{duration}", formatDuration(node.durationMs));
          return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { className: "bf-tl__item bf-tl__item--thinking", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "bf-tl__dot bf-tl__dot--muted", children: dotIcon("thinking") }) }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "bf-tl__body", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "bf-tl__thinking", children: label }) })
          ] }, node.key);
        }
        if (node.kind === "tool") {
          return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { className: "bf-tl__item bf-tl__item--tool", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: `bf-tl__dot${node.isError ? " bf-tl__dot--error" : ""}`, children: dotIcon("tool", node.isError) }) }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "bf-tl__body", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ToolStep, { node, labels }) })
          ] }, node.key);
        }
        if (node.kind === "error") {
          return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { className: "bf-tl__item bf-tl__item--error", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "bf-tl__dot bf-tl__dot--error", children: dotIcon("error") }) }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "bf-tl__body", children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "bf-tl__role bf-tl__role--error", children: labels.error }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "bf-tl__bubble bf-tl__bubble--error", children: node.message })
            ] })
          ] }, node.key);
        }
        return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { className: "bf-tl__item bf-tl__item--assistant bf-tl__item--streaming", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "bf-tl__dot bf-tl__dot--pulse", children: dotIcon("assistant") }) }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "bf-tl__body", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "bf-tl__role", children: assistant }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "bf-tl__bubble", children: renderStreaming ? renderStreaming(node.text) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Markdown, { content: node.text, onInternalLink, labels }) })
          ] })
        ] }, node.key);
      }),
      isRunning && !streamingText.trim() && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { className: "bf-tl__item bf-tl__item--thinking", "aria-live": "polite", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "bf-tl__dot bf-tl__dot--pulse", children: dotIcon("thinking") }) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "bf-tl__body", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "bf-tl__thinking bf-tl__thinking--live", children: labels.thinking }) })
      ] })
    ] })
  ] });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BrainTimeline,
  DEFAULT_TIMELINE_LABELS,
  Markdown,
  attachmentsOf,
  buildTimeline,
  formatDuration,
  formatPayload
});
//# sourceMappingURL=index.cjs.map