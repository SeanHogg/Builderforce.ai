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
  Avatar: () => Avatar,
  BrainTimeline: () => BrainTimeline,
  ChatTicketsPanel: () => ChatTicketsPanel,
  DEFAULT_ASK_USER_LABELS: () => DEFAULT_ASK_USER_LABELS,
  DEFAULT_CHAT_TICKETS_LABELS: () => DEFAULT_CHAT_TICKETS_LABELS,
  DEFAULT_EVERMIND_LABELS: () => DEFAULT_EVERMIND_LABELS,
  DEFAULT_PROJECT360_LABELS: () => DEFAULT_PROJECT360_LABELS,
  DEFAULT_PROJECT_LIST_LABELS: () => DEFAULT_PROJECT_LIST_LABELS,
  DEFAULT_TIMELINE_LABELS: () => DEFAULT_TIMELINE_LABELS,
  EvermindConsole: () => EvermindConsole,
  HealthRing: () => HealthRing,
  Markdown: () => Markdown,
  ParticipantBadge: () => ParticipantBadge,
  Project360View: () => Project360View,
  ProjectListView: () => ProjectListView,
  QuestionCard: () => QuestionCard,
  RUNNABLE_KINDS: () => RUNNABLE_KINDS,
  Sunburst: () => Sunburst,
  TICKET_KINDS: () => TICKET_KINDS,
  attachmentsOf: () => attachmentsOf,
  avatarColor: () => avatarColor,
  buildSettledTimeline: () => buildSettledTimeline,
  buildTimeline: () => buildTimeline,
  formatDuration: () => formatDuration,
  formatPayload: () => formatPayload,
  healthRingColor: () => healthRingColor,
  initialsOf: () => initialsOf,
  parseAskUser: () => parseAskUser,
  serializeAskUser: () => serializeAskUser,
  streamingNode: () => streamingNode,
  stripAskUser: () => stripAskUser,
  useChatParticipants: () => useChatParticipants,
  useMentionAutocomplete: () => useMentionAutocomplete
});
module.exports = __toCommonJS(src_exports);

// src/BrainTimeline.tsx
var import_react3 = __toESM(require("react"), 1);
var import_builderforce_brain_embedded = require("@seanhogg/builderforce-brain-embedded");

// src/Markdown.tsx
var import_react = __toESM(require("react"), 1);
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
function MarkdownInner({ content, onInternalLink, onApplyCode, onCreateFile, labels }) {
  const lab = (0, import_react.useMemo)(() => ({ ...DEFAULT_LABELS, ...labels }), [labels]);
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
var Markdown = import_react.default.memo(MarkdownInner);

// src/ParticipantBadge.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function initialsOf(name) {
  const words = name.trim().replace(/[()[\]{}]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
var AVATAR_COLORS = ["#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#0891b2", "#059669", "#4f46e5"];
function avatarColor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = h * 31 + seed.charCodeAt(i) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function Avatar({ name, kind = "agent", size = 18, title, style }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
    "span",
    {
      "aria-hidden": true,
      title: title ?? name,
      style: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        borderRadius: kind === "human" ? "50%" : Math.round(size * 0.3),
        background: avatarColor(name),
        color: "#fff",
        fontSize: Math.max(8, Math.round(size * 0.44)),
        fontWeight: 700,
        lineHeight: 1,
        letterSpacing: "-0.02em",
        userSelect: "none",
        ...style
      },
      children: initialsOf(name)
    }
  );
}
function ParticipantBadge({ recipient, prefix, size = 16 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, opacity: 0.95 }, children: [
    prefix ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { "aria-hidden": true, style: { opacity: 0.7 }, children: prefix }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Avatar, { name: recipient.name, kind: recipient.kind, size }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: recipient.name })
  ] });
}

// src/askUser.tsx
var import_react2 = require("react");
var import_jsx_runtime3 = require("react/jsx-runtime");
var DEFAULT_ASK_USER_LABELS = {
  askSubmit: "Send",
  askAnswered: "Answered"
};
var ASK_USER_FENCE = /```ask-user\s*\n([\s\S]*?)\n```/i;
function coercePayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = raw;
  const question = typeof o.question === "string" ? o.question.trim() : "";
  const optionsIn = Array.isArray(o.options) ? o.options : [];
  const options = optionsIn.map((it) => {
    if (typeof it === "string") return it.trim() ? { label: it.trim() } : null;
    if (it && typeof it === "object") {
      const rec = it;
      const label = typeof rec.label === "string" ? rec.label.trim() : "";
      const description = typeof rec.description === "string" ? rec.description.trim() : void 0;
      return label ? { label, ...description ? { description } : {} } : null;
    }
    return null;
  }).filter((x) => !!x);
  if (!question || options.length < 2) return null;
  return { question, options, multiSelect: o.multiSelect === true };
}
function parseAskUser(text) {
  if (!text || !text.includes("ask-user")) return null;
  const m = text.match(ASK_USER_FENCE);
  if (!m) return null;
  try {
    return coercePayload(JSON.parse(m[1]));
  } catch {
    return null;
  }
}
function stripAskUser(text) {
  if (!text) return text;
  return text.replace(ASK_USER_FENCE, "").replace(/\n{3,}/g, "\n\n").trim();
}
function serializeAskUser(payload) {
  return ["```ask-user", JSON.stringify(payload), "```"].join("\n");
}
function QuestionCard({
  payload,
  labels,
  onAnswer
}) {
  const lab = (0, import_react2.useMemo)(() => ({ ...DEFAULT_ASK_USER_LABELS, ...labels }), [labels]);
  const [answered, setAnswered] = (0, import_react2.useState)(null);
  const [checked, setChecked] = (0, import_react2.useState)(() => /* @__PURE__ */ new Set());
  const multi = payload.multiSelect === true;
  const commit = (answer) => {
    if (answered || !answer.trim()) return;
    setAnswered(answer);
    onAnswer(answer);
  };
  const toggle = (i) => {
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };
  const submitMulti = () => {
    const picks = payload.options.filter((_, i) => checked.has(i)).map((o) => o.label);
    if (picks.length) commit(picks.join(", "));
  };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: `bf-qcard${answered ? " bf-qcard--done" : ""}`, role: "group", "aria-label": payload.question, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "bf-qcard__q", children: payload.question }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "bf-qcard__opts", children: payload.options.map(
      (opt, i) => multi ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: `bf-qcard__opt bf-qcard__opt--check${checked.has(i) ? " is-checked" : ""}`, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "input",
          {
            type: "checkbox",
            className: "bf-qcard__cb",
            checked: checked.has(i),
            disabled: !!answered,
            onChange: () => toggle(i)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "bf-qcard__opt-body", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "bf-qcard__opt-label", children: opt.label }),
          opt.description && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "bf-qcard__opt-desc", children: opt.description })
        ] })
      ] }, i) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
        "button",
        {
          type: "button",
          className: "bf-qcard__opt bf-qcard__opt--btn",
          disabled: !!answered,
          onClick: () => commit(opt.label),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "bf-qcard__opt-label", children: opt.label }),
            opt.description && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "bf-qcard__opt-desc", children: opt.description })
          ]
        },
        i
      )
    ) }),
    multi && !answered && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "bf-qcard__submit", disabled: checked.size === 0, onClick: submitMulti, children: lab.askSubmit }),
    answered && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "bf-qcard__answered", children: `${lab.askAnswered}: ${answered}` })
  ] });
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
  const nodes = buildSettledTimeline(input.messages, input.trace);
  const streaming = streamingNode(input.streamingText, input.isRunning);
  if (streaming) nodes.push(streaming);
  return nodes;
}
function buildSettledTimeline(messages, trace) {
  const nodes = [];
  messages.forEach((message, i) => {
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
  trace.forEach((ev, i) => {
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
  return nodes;
}
function streamingNode(streamingText, isRunning) {
  if (!isRunning || !streamingText.trim()) return null;
  return { key: "streaming", kind: "streaming", ts: Number.MAX_SAFE_INTEGER, order: ORDER.streaming, text: streamingText };
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
var import_jsx_runtime4 = require("react/jsx-runtime");
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
  createFile: "Create file",
  preview: "Preview",
  askSubmit: DEFAULT_ASK_USER_LABELS.askSubmit,
  askAnswered: DEFAULT_ASK_USER_LABELS.askAnswered,
  accountOwn: "Your account",
  accountShared: "Shared pool",
  accountByoUnused: "Your connected account wasn't used"
};
function ProvenanceChip({ prov, labels }) {
  const unused = prov.account === "shared_byo_unused";
  const badge = prov.account === "own" ? labels.accountOwn : unused ? labels.accountByoUnused : labels.accountShared;
  const variant = prov.account === "own" ? "bf-tl__prov--own" : unused ? "bf-tl__prov--unused" : "bf-tl__prov--shared";
  const modelTitle = prov.vendor ? `${prov.model} \xB7 ${prov.vendor}` : prov.model;
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: `bf-tl__prov ${variant}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__prov-model", title: modelTitle, children: prov.model }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__prov-badge", children: badge })
  ] });
}
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
function CopyButton({ text, labels }) {
  const [copied, setCopied] = (0, import_react3.useState)(false);
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
    "button",
    {
      type: "button",
      className: "bf-tl__copy",
      title: labels.copy,
      onClick: (e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => {
          }
        );
      },
      children: copied ? labels.copied : labels.copy
    }
  );
}
function toolPreview(args) {
  if (!args || typeof args !== "object") return null;
  const a = args;
  const path = typeof a.path === "string" ? a.path : "";
  if (typeof a.old_string === "string" && typeof a.new_string === "string") {
    return { kind: "edit", path, oldText: a.old_string, newText: a.new_string };
  }
  if (path && typeof a.content === "string") {
    return { kind: "write", path, content: a.content };
  }
  return null;
}
function DiffLines({ text, sign }) {
  const cls = sign === "+" ? "bf-tl__diff-add" : "bf-tl__diff-del";
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_jsx_runtime4.Fragment, { children: text.split("\n").map((line, i) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: `bf-tl__diff-line ${cls}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__diff-sign", "aria-hidden": true, children: sign }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__diff-text", children: line || "\xA0" })
  ] }, i)) });
}
function ToolStep({
  node,
  labels
}) {
  const argsText = formatPayload(node.args);
  const resultText = formatPayload(node.result);
  const preview = toolPreview(node.args);
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("details", { className: `bf-tl__tool${node.isError ? " bf-tl__tool--error" : ""}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("summary", { className: "bf-tl__tool-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__tool-status", "aria-hidden": true, children: node.isError ? "\u2717" : "\u2713" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__tool-name", children: node.label }),
      node.durationMs != null && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__tool-dur", children: formatDuration(node.durationMs) }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__tool-caret", "aria-hidden": true, children: "\u25B8" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bf-tl__tool-body", children: [
      preview && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bf-tl__io", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bf-tl__io-label", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { children: [
            labels.preview,
            preview.path ? ` \xB7 ${preview.path}` : ""
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            CopyButton,
            {
              text: preview.kind === "edit" ? preview.newText : preview.content,
              labels
            }
          )
        ] }),
        preview.kind === "edit" ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bf-tl__diff", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(DiffLines, { text: preview.oldText, sign: "-" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(DiffLines, { text: preview.newText, sign: "+" })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("pre", { className: "bf-tl__io-pre", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("code", { children: preview.content }) })
      ] }),
      argsText && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bf-tl__io", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bf-tl__io-label", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: labels.input }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(CopyButton, { text: argsText, labels })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("pre", { className: "bf-tl__io-pre", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("code", { children: argsText }) })
      ] }),
      resultText && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bf-tl__io", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bf-tl__io-label", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: labels.output }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(CopyButton, { text: resultText, labels })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("pre", { className: "bf-tl__io-pre", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("code", { children: resultText }) })
      ] })
    ] })
  ] });
}
function BrainTimelineInner({
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
  onAnswerQuestion,
  autoScroll = true
}) {
  const labels = (0, import_react3.useMemo)(() => ({ ...DEFAULT_TIMELINE_LABELS, ...labelOverrides }), [labelOverrides]);
  const assistant = assistantName ?? labels.assistant;
  const settled = (0, import_react3.useMemo)(() => buildSettledTimeline(messages, trace), [messages, trace]);
  const nodes = (0, import_react3.useMemo)(() => {
    const streaming = streamingNode(streamingText, isRunning);
    return streaming ? [...settled, streaming] : settled;
  }, [settled, streamingText, isRunning]);
  const scrollRef = (0, import_react3.useRef)(null);
  const contentRef = (0, import_react3.useRef)(null);
  const pinnedRef = (0, import_react3.useRef)(true);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  (0, import_react3.useEffect)(() => {
    if (!autoScroll) return;
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const stick = () => {
      if (pinnedRef.current) scroller.scrollTop = scroller.scrollHeight;
    };
    stick();
    const ro = new ResizeObserver(stick);
    ro.observe(content);
    return () => ro.disconnect();
  }, [autoScroll]);
  const renderMsg = (msg, role, text) => renderMessage ? renderMessage(msg, { role, text }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bf-tl-scroll", ref: scrollRef, onScroll, children: [
    loading && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "bf-tl-status", children: labels.loading }),
    isEmpty && (emptyState ?? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "bf-tl-empty", children: labels.empty })),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("ol", { className: "bf-tl", ref: contentRef, children: [
      nodes.map((node) => {
        if (node.kind === "user") {
          const to = (0, import_builderforce_brain_embedded.parseDirectedRecipient)(node.message);
          return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("li", { className: "bf-tl__item bf-tl__item--user", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__dot", children: dotIcon("user") }) }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bf-tl__body", children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bf-tl__role", style: to ? { display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" } : void 0, children: [
                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: labels.you }),
                to && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 4, opacity: 0.9 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { "aria-hidden": true, style: { opacity: 0.6 }, children: "\u2192" }),
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Avatar, { name: to.name, kind: to.kind, size: 15 }),
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: to.name })
                ] })
              ] }),
              node.images.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "bf-tl__images", children: node.images.map((im, i) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("img", { src: im.url, alt: im.name ?? "", className: "bf-tl__image" }, i)) }),
              node.text && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "bf-tl__bubble bf-tl__bubble--user", children: renderMsg(node.message, "user", node.text) })
            ] })
          ] }, node.key);
        }
        if (node.kind === "assistant") {
          const author = (0, import_builderforce_brain_embedded.parseMessageAuthor)(node.message);
          const card = onAnswerQuestion ? parseAskUser(node.text) : null;
          const bodyText = card ? stripAskUser(node.text) : node.text;
          const prov = (0, import_builderforce_brain_embedded.parseMessageProvenance)(node.message);
          return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("li", { className: "bf-tl__item bf-tl__item--assistant", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__dot", children: author ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Avatar, { name: author.name, kind: author.kind, size: 16 }) : dotIcon("assistant") }) }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bf-tl__body", children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "bf-tl__role", children: author ? author.name : assistant }),
              bodyText && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "bf-tl__bubble", children: renderMsg(node.message, "assistant", bodyText) }),
              card && onAnswerQuestion && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                QuestionCard,
                {
                  payload: card,
                  labels: { askSubmit: labels.askSubmit, askAnswered: labels.askAnswered },
                  onAnswer: onAnswerQuestion
                }
              ),
              renderAssistantActions && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "bf-tl__actions", children: renderAssistantActions(node.message) }),
              prov && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ProvenanceChip, { prov, labels })
            ] })
          ] }, node.key);
        }
        if (node.kind === "thinking") {
          const label = labels.thoughtFor.replace("{duration}", formatDuration(node.durationMs));
          return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("li", { className: "bf-tl__item bf-tl__item--thinking", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__dot bf-tl__dot--muted", children: dotIcon("thinking") }) }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "bf-tl__body", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__thinking", children: label }) })
          ] }, node.key);
        }
        if (node.kind === "tool") {
          return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("li", { className: "bf-tl__item bf-tl__item--tool", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: `bf-tl__dot${node.isError ? " bf-tl__dot--error" : ""}`, children: dotIcon("tool", node.isError) }) }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "bf-tl__body", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ToolStep, { node, labels }) })
          ] }, node.key);
        }
        if (node.kind === "error") {
          return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("li", { className: "bf-tl__item bf-tl__item--error", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__dot bf-tl__dot--error", children: dotIcon("error") }) }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bf-tl__body", children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "bf-tl__role bf-tl__role--error", children: labels.error }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "bf-tl__bubble bf-tl__bubble--error", children: node.message })
            ] })
          ] }, node.key);
        }
        return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("li", { className: "bf-tl__item bf-tl__item--assistant bf-tl__item--streaming", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__dot bf-tl__dot--pulse", children: dotIcon("assistant") }) }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bf-tl__body", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "bf-tl__role", children: assistant }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "bf-tl__bubble", children: renderStreaming ? renderStreaming(node.text) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Markdown, { content: node.text, onInternalLink, labels }) })
          ] })
        ] }, node.key);
      }),
      isRunning && !streamingText.trim() && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("li", { className: "bf-tl__item bf-tl__item--thinking", "aria-live": "polite", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__dot bf-tl__dot--pulse", children: dotIcon("thinking") }) }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "bf-tl__body", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__thinking bf-tl__thinking--live", children: labels.thinking }) })
      ] })
    ] })
  ] });
}
var BrainTimeline = import_react3.default.memo(BrainTimelineInner);

// src/HealthRing.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
function healthRingColor(percent, muted = false) {
  if (muted) return "var(--bf-health-muted, #9ca3af)";
  if (percent >= 100) return "var(--bf-health-done, #16a34a)";
  if (percent >= 67) return "var(--bf-health-good, #22c55e)";
  if (percent >= 34) return "var(--bf-health-mid, #f59e0b)";
  if (percent > 0) return "var(--bf-health-low, #f97316)";
  return "var(--bf-health-none, #ef4444)";
}
function HealthRing({ percent, size = 40, stroke = 4, caption, muted = false, ariaLabel }) {
  const pct = Math.max(0, Math.min(100, Math.round(percent || 0)));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = pct / 100 * c;
  const color = healthRingColor(pct, muted);
  const label = ariaLabel ?? `${pct}% complete`;
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { className: "bf-health-ring", style: { display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 2 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: "img", "aria-label": label, children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        "circle",
        {
          cx: size / 2,
          cy: size / 2,
          r,
          fill: "none",
          stroke: "var(--bf-health-track, rgba(148,163,184,0.25))",
          strokeWidth: stroke
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        "circle",
        {
          cx: size / 2,
          cy: size / 2,
          r,
          fill: "none",
          stroke: color,
          strokeWidth: stroke,
          strokeLinecap: "round",
          strokeDasharray: `${dash.toFixed(2)} ${(c - dash).toFixed(2)}`,
          transform: `rotate(-90 ${size / 2} ${size / 2})`
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        "text",
        {
          x: "50%",
          y: "50%",
          textAnchor: "middle",
          dominantBaseline: "central",
          fill: "var(--bf-health-text, currentColor)",
          style: { fontSize: Math.max(9, size * 0.28), fontWeight: 600 },
          children: pct
        }
      )
    ] }),
    caption ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: { fontSize: 10, color: "var(--bf-health-caption, var(--bf-text-muted, #6b7280))", lineHeight: 1 }, children: caption }) : null
  ] });
}

// src/chatTickets/ChatTicketsPanel.tsx
var import_react4 = require("react");

// src/chatTickets/types.ts
var TICKET_KINDS = ["task", "epic", "gap", "objective", "initiative", "portfolio", "roadmap", "spec"];
var RUNNABLE_KINDS = ["task", "epic", "gap"];
var DEFAULT_CHAT_TICKETS_LABELS = {
  none: "No tickets linked yet.",
  spawned: "spawned here",
  run: "Run agent on ticket",
  lineage: "Chat lineage",
  unlink: "Unlink",
  pickAgent: "Run as agent\u2026",
  lineageTitle: "Chats for this ticket",
  lineageEmpty: "No other chats reference this ticket.",
  merged: "merged",
  runNoAgent: "No agent could run this ticket \u2014 assign one first.",
  runFailed: "Could not start the run.",
  link: "Link ticket",
  agents: "Agents",
  merge: "Merge",
  linkFailed: "Could not link \u2014 check the ticket exists.",
  kindLabel: "Ticket type",
  pickTicket: "Choose a ticket\u2026",
  searchTicket: "Search tickets\u2026",
  searching: "Searching\u2026",
  noMatches: "No matching tickets.",
  refine: "Showing the top matches \u2014 type to narrow.",
  linkTypeLabel: "Link type",
  linkTypeLinked: "Linked",
  linkTypeCreated: "Created from chat",
  linkAction: "Link",
  noAgents: "No agents in this chat yet.",
  removeAgent: "Remove",
  inviteAgent: "Invite an agent\u2026",
  agentsHint: "Type @ in the message box to tag an invited agent \u2014 it replies in the chat and can act on the team's work \u2014 or run it on a linked task/epic above.",
  people: "People",
  noPeople: "No people invited yet.",
  invitePerson: "Invite by email\u2026",
  invitePersonHint: "Invite a teammate to view and collaborate on this chat.",
  removePerson: "Remove",
  inviteSent: "Invitation sent.",
  invitePending: "Invite sent \u2014 they will join when they sign in.",
  visibilityShared: "Shared",
  visibilityLocked: "Locked",
  lockHint: "Shared chats are visible to the whole team; lock to keep this chat to its members only.",
  mergeHint: "Merge other chats into this one. Their messages, tickets and agents move here; the sources are archived.",
  mergeNoOthers: "No other chats to merge.",
  kind: { task: "Task", epic: "Epic", gap: "Gap", objective: "Objective", initiative: "Initiative", portfolio: "Portfolio", roadmap: "Roadmap", spec: "Spec" },
  ringAria: (label, pct) => `${label}: ${pct}% done`,
  runStarted: (agent) => `Started ${agent} on the ticket.`,
  mergeAction: (n) => `Merge ${n} here`,
  mergedN: (n) => `Merged ${n} chat(s).`
};

// src/chatTickets/ChatTicketsPanel.tsx
var import_jsx_runtime6 = require("react/jsx-runtime");
var RUNNABLE = new Set(RUNNABLE_KINDS);
function ChatTicketsPanelInner({ chatId, projectId, chatList, adapter, labels, onChanged, refreshSignal, visibility, onSetVisibility }) {
  const [tickets, setTickets] = (0, import_react4.useState)([]);
  const [agents, setAgents] = (0, import_react4.useState)([]);
  const [members, setMembers] = (0, import_react4.useState)([]);
  const [pool, setPool] = (0, import_react4.useState)([]);
  const [panel, setPanel] = (0, import_react4.useState)(null);
  const [lineageKey, setLineageKey] = (0, import_react4.useState)(null);
  const [lineage, setLineage] = (0, import_react4.useState)([]);
  const [runKey, setRunKey] = (0, import_react4.useState)(null);
  const [msg, setMsg] = (0, import_react4.useState)(null);
  const [busy, setBusy] = (0, import_react4.useState)(false);
  const load = (0, import_react4.useCallback)(async () => {
    const [tk, ag, mem] = await Promise.all([
      adapter.listTickets(chatId).catch(() => []),
      adapter.listAgents(chatId).catch(() => []),
      adapter.listMembers(chatId).catch(() => [])
    ]);
    setTickets(tk);
    setAgents(ag);
    setMembers(mem);
  }, [adapter, chatId]);
  (0, import_react4.useEffect)(() => {
    void load();
  }, [load, refreshSignal]);
  (0, import_react4.useEffect)(() => {
    adapter.loadAgentPool().then(setPool).catch(() => setPool([]));
  }, [adapter]);
  const flash = (m) => {
    setMsg(m);
    if (typeof window !== "undefined") window.setTimeout(() => setMsg(null), 3500);
  };
  const poolName = (0, import_react4.useCallback)((ref) => pool.find((p) => p.ref === ref)?.name ?? ref, [pool]);
  const unlink = async (tk) => {
    setBusy(true);
    try {
      await adapter.unlinkTicket(chatId, tk.kind, tk.ref);
      await load();
    } finally {
      setBusy(false);
    }
  };
  const openLineage = async (tk) => {
    const key = `${tk.kind}:${tk.ref}`;
    if (lineageKey === key) {
      setLineageKey(null);
      return;
    }
    setLineageKey(key);
    setLineage(await adapter.listTicketChats(tk.kind, tk.ref).catch(() => []));
  };
  const runTicket = async (tk, agentRef) => {
    setBusy(true);
    try {
      const res = await adapter.runTicket(tk.kind, tk.ref, agentRef);
      flash(res.started ? labels.runStarted(res.agentName || poolName(agentRef)) : labels.runNoAgent);
      setRunKey(null);
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : labels.runFailed);
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: S.root, children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }, children: tickets.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: S.muted, children: labels.none }) : tickets.map((tk) => {
      const key = `${tk.kind}:${tk.ref}`;
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: S.chip, children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(HealthRing, { percent: tk.progressPct, size: 36, caption: tk.total > 0 ? `${tk.done}/${tk.total}` : void 0, muted: !tk.exists, ariaLabel: labels.ringAria(tk.label, tk.progressPct) }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", flexDirection: "column", minWidth: 0, maxWidth: 160 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: S.ticketLabel, title: tk.label, children: tk.label }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { style: S.ticketMeta, children: [
            labels.kind[tk.kind],
            " \xB7 ",
            tk.status,
            tk.linkType === "created" ? ` \xB7 ${labels.spawned}` : ""
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", gap: 2 }, children: [
          RUNNABLE.has(tk.kind) && tk.exists && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", title: labels.run, onClick: () => setRunKey(runKey === key ? null : key), style: S.icon, children: "\u25B6" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", title: labels.lineage, onClick: () => void openLineage(tk), style: S.icon, children: "\u2443" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", title: labels.unlink, disabled: busy, onClick: () => void unlink(tk), style: S.icon, children: "\u2715" })
        ] }),
        runKey === key && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("select", { "aria-label": labels.pickAgent, value: "", onChange: (e) => {
          if (e.target.value) void runTicket(tk, e.target.value);
        }, style: S.select, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "", children: labels.pickAgent }),
          agents.map((a) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("option", { value: a.agentRef, children: [
            "\u2605 ",
            poolName(a.agentRef)
          ] }, a.id)),
          pool.filter((p) => !agents.some((a) => a.agentRef === p.ref)).map((p) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: p.ref, children: p.name }, p.ref))
        ] })
      ] }, tk.linkId);
    }) }),
    lineageKey && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: S.drawer, children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("strong", { style: { color: V.text }, children: labels.lineageTitle }),
      lineage.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { marginLeft: 8, ...S.muted }, children: labels.lineageEmpty }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("ul", { style: { margin: "4px 0 0", paddingLeft: 18 }, children: lineage.map((c) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("li", { style: { marginBottom: 2 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { fontWeight: c.chatId === chatId ? 700 : 400 }, children: c.title }),
        c.linkType === "created" ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("em", { style: { color: V.accent, marginLeft: 6 }, children: labels.spawned }) : null,
        c.isArchived ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { style: { marginLeft: 6, ...S.muted }, children: [
          "(",
          labels.merged,
          ")"
        ] }) : null
      ] }, c.chatId)) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("button", { type: "button", onClick: () => setPanel(panel === "link" ? null : "link"), style: S.pill(panel === "link"), children: [
        "\uFF0B ",
        labels.link
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("button", { type: "button", onClick: () => setPanel(panel === "agents" ? null : "agents"), style: S.pill(panel === "agents"), children: [
        "\u{1F465} ",
        labels.agents,
        agents.length ? ` (${agents.length})` : ""
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("button", { type: "button", onClick: () => setPanel(panel === "people" ? null : "people"), style: S.pill(panel === "people"), children: [
        "\u{1F464} ",
        labels.people,
        members.length ? ` (${members.length})` : ""
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("button", { type: "button", onClick: () => setPanel(panel === "merge" ? null : "merge"), style: S.pill(panel === "merge"), children: [
        "\u29C9 ",
        labels.merge
      ] }),
      msg && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { fontSize: 12, color: V.accent, alignSelf: "center" }, children: msg })
    ] }),
    panel === "link" && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(LinkForm, { search: adapter.searchTickets, projectId, existing: tickets, labels, onLink: async (kind, ref, linkType) => {
      try {
        await adapter.linkTicket(chatId, { kind, ref, linkType });
        await load();
      } catch (e) {
        flash(e instanceof Error ? e.message : labels.linkFailed);
      }
    } }),
    panel === "agents" && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
      AgentsSection,
      {
        agents,
        pool,
        labels,
        onInvite: async (ref, kind) => {
          setBusy(true);
          try {
            await adapter.inviteAgent(chatId, { agentRef: ref, agentKind: kind });
            await load();
            onChanged?.();
          } finally {
            setBusy(false);
          }
        },
        onRemove: async (id) => {
          setBusy(true);
          try {
            await adapter.removeAgent(chatId, id);
            await load();
            onChanged?.();
          } finally {
            setBusy(false);
          }
        },
        busy
      }
    ),
    panel === "people" && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
      PeopleSection,
      {
        members,
        labels,
        visibility,
        onSetVisibility,
        onInvite: async (email) => {
          setBusy(true);
          try {
            const r = await adapter.inviteMember(chatId, email);
            flash(r.status === "pending" ? labels.invitePending : labels.inviteSent);
            await load();
            onChanged?.();
          } catch (e) {
            flash(e instanceof Error ? e.message : labels.linkFailed);
          } finally {
            setBusy(false);
          }
        },
        onRemove: async (id) => {
          setBusy(true);
          try {
            await adapter.removeMember(chatId, id);
            await load();
            onChanged?.();
          } finally {
            setBusy(false);
          }
        },
        busy
      }
    ),
    panel === "merge" && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
      MergeSection,
      {
        chatId,
        chatList,
        labels,
        onMerge: async (ids) => {
          setBusy(true);
          try {
            await adapter.consolidate(chatId, ids);
            flash(labels.mergedN(ids.length));
            await load();
            onChanged?.();
          } finally {
            setBusy(false);
          }
        },
        busy
      }
    )
  ] });
}
var SEARCH_LIMIT = 40;
function LinkForm({ search, projectId, existing, labels, onLink }) {
  const [kind, setKind] = (0, import_react4.useState)("task");
  const [ref, setRef] = (0, import_react4.useState)("");
  const [query, setQuery] = (0, import_react4.useState)("");
  const [linkType, setLinkType] = (0, import_react4.useState)("linked");
  const [busy, setBusy] = (0, import_react4.useState)(false);
  const [results, setResults] = (0, import_react4.useState)([]);
  const [loading, setLoading] = (0, import_react4.useState)(false);
  (0, import_react4.useEffect)(() => {
    let live = true;
    setLoading(true);
    const h = setTimeout(() => {
      search(kind, query, projectId).then((r) => {
        if (live) setResults(r);
      }).catch(() => {
        if (live) setResults([]);
      }).finally(() => {
        if (live) setLoading(false);
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [search, kind, query, projectId]);
  const shown = (0, import_react4.useMemo)(
    () => results.filter((o) => !existing.some((e) => e.kind === kind && e.ref === o.ref)),
    [results, existing, kind]
  );
  const atCap = results.length >= SEARCH_LIMIT;
  (0, import_react4.useEffect)(() => {
    if (ref && !shown.some((o) => o.ref === ref)) setRef("");
  }, [shown, ref]);
  const submit = async () => {
    if (!ref) return;
    setBusy(true);
    try {
      await onLink(kind, ref, linkType);
      setRef("");
      setQuery("");
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: S.section, children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("select", { "aria-label": labels.kindLabel, value: kind, onChange: (e) => {
      setKind(e.target.value);
      setRef("");
      setQuery("");
    }, style: S.select, children: TICKET_KINDS.map((k) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: k, children: labels.kind[k] }, k)) }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
      "input",
      {
        type: "search",
        "aria-label": labels.searchTicket,
        placeholder: labels.searchTicket,
        value: query,
        onChange: (e) => setQuery(e.target.value),
        style: { ...S.select, minWidth: 150 }
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("select", { "aria-label": labels.pickTicket, value: ref, onChange: (e) => setRef(e.target.value), style: { ...S.select, minWidth: 200 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "", children: labels.pickTicket }),
      shown.map((o) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: o.ref, children: o.label }, o.ref))
    ] }),
    loading ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: S.muted, children: labels.searching }) : shown.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: S.muted, children: labels.noMatches }) : atCap ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: S.muted, children: labels.refine }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("select", { "aria-label": labels.linkTypeLabel, value: linkType, onChange: (e) => setLinkType(e.target.value), style: S.select, children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "linked", children: labels.linkTypeLinked }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "created", children: labels.linkTypeCreated })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", onClick: () => void submit(), disabled: busy || !ref, style: S.pill(true), children: busy ? "\u2026" : labels.linkAction })
  ] });
}
function AgentsSection({ agents, pool, labels, onInvite, onRemove, busy }) {
  const poolName = (ref) => pool.find((p) => p.ref === ref)?.name ?? ref;
  const uninvited = pool.filter((p) => !agents.some((a) => a.agentRef === p.ref));
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { ...S.section, flexDirection: "column", alignItems: "stretch" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, children: agents.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: S.muted, children: labels.noAgents }) : agents.map((a) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { style: S.agentChip, children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { "aria-hidden": true, children: "\u{1F916}" }),
      poolName(a.agentRef),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", title: labels.removeAgent, disabled: busy, onClick: () => void onRemove(a.id), style: { ...S.icon, fontSize: 11 }, children: "\u2715" })
    ] }, a.id)) }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("select", { "aria-label": labels.inviteAgent, value: "", onChange: (e) => {
      const p = pool.find((x) => x.ref === e.target.value);
      if (p) void onInvite(p.ref, p.kind);
    }, style: { ...S.select, maxWidth: 260 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "", children: labels.inviteAgent }),
      uninvited.map((p) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("option", { value: p.ref, children: [
        p.name,
        " \u2014 ",
        p.meta
      ] }, p.ref))
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { fontSize: 11, ...S.muted }, children: labels.agentsHint })
  ] });
}
function PeopleSection({ members, labels, visibility, onSetVisibility, onInvite, onRemove, busy }) {
  const [email, setEmail] = (0, import_react4.useState)("");
  const submit = async () => {
    const e = email.trim();
    if (!e) return;
    await onInvite(e);
    setEmail("");
  };
  const locked = visibility === "locked";
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { ...S.section, flexDirection: "column", alignItems: "stretch" }, children: [
    visibility && onSetVisibility && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", disabled: busy, onClick: () => void onSetVisibility(locked ? "shared" : "locked"), style: S.pill(locked), children: locked ? `\u{1F512} ${labels.visibilityLocked}` : `\u{1F513} ${labels.visibilityShared}` }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { fontSize: 11, ...S.muted }, children: labels.lockHint })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, children: members.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: S.muted, children: labels.noPeople }) : members.map((m) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { style: S.agentChip, children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { "aria-hidden": true, children: m.status === "pending" ? "\u2709\uFE0F" : "\u{1F464}" }),
      m.name,
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", title: labels.removePerson, disabled: busy, onClick: () => void onRemove(m.id), style: { ...S.icon, fontSize: 11 }, children: "\u2715" })
    ] }, m.id)) }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", gap: 6 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        "input",
        {
          type: "email",
          value: email,
          disabled: busy,
          onChange: (e) => setEmail(e.target.value),
          onKeyDown: (e) => {
            if (e.key === "Enter") void submit();
          },
          placeholder: labels.invitePerson,
          "aria-label": labels.invitePerson,
          style: { ...S.select, flex: 1, maxWidth: 260 }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", disabled: busy || !email.trim(), onClick: () => void submit(), style: S.pill(false), children: "\uFF0B" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { fontSize: 11, ...S.muted }, children: labels.invitePersonHint })
  ] });
}
function MergeSection({ chatId, chatList, labels, onMerge, busy }) {
  const [selected, setSelected] = (0, import_react4.useState)([]);
  const candidates = chatList.filter((c) => c.id !== chatId);
  const toggle = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { ...S.section, flexDirection: "column", alignItems: "stretch" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { fontSize: 12, color: V.text2 }, children: labels.mergeHint }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { maxHeight: 160, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }, children: candidates.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: S.muted, children: labels.mergeNoOthers }) : candidates.map((c) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "3px 4px", cursor: "pointer" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("input", { type: "checkbox", checked: selected.includes(c.id), onChange: () => toggle(c.id) }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: c.title })
    ] }, c.id)) }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", onClick: () => {
      if (selected.length) void onMerge(selected).then(() => setSelected([]));
    }, disabled: busy || selected.length === 0, style: S.pill(true), children: busy ? "\u2026" : labels.mergeAction(selected.length) })
  ] });
}
var ChatTicketsPanel = (0, import_react4.memo)(ChatTicketsPanelInner);
var V = {
  border: "var(--bf-ct-border, var(--border-subtle, var(--bf-border, var(--vscode-panel-border, rgba(148,163,184,0.3)))))",
  surface: "var(--bf-ct-surface, var(--bg-elevated, var(--bf-surface, var(--vscode-editorWidget-background, transparent))))",
  surface2: "var(--bf-ct-surface-2, var(--bg-base, var(--bf-surface-2, var(--vscode-textBlockQuote-background, transparent))))",
  // Form controls specifically prefer the editor's dropdown/input tokens so the
  // native <select> and its option list match VS Code's own dropdowns.
  field: "var(--bf-ct-surface-2, var(--bg-base, var(--vscode-dropdown-background, var(--bf-surface, transparent))))",
  fieldText: "var(--bf-ct-text, var(--text-primary, var(--vscode-dropdown-foreground, var(--bf-text, inherit))))",
  text: "var(--bf-ct-text, var(--text-primary, var(--bf-text, inherit)))",
  text2: "var(--bf-ct-text-2, var(--text-secondary, var(--bf-text, inherit)))",
  muted: "var(--bf-ct-text-muted, var(--text-muted, var(--bf-text-muted, #6b7280)))",
  accent: "var(--bf-ct-accent, var(--accent, var(--bf-accent, #3b82f6)))"
};
var S = {
  root: { margin: "4px 0 0", padding: "8px 10px", border: `1px solid ${V.border}`, borderRadius: 10, background: V.surface, display: "flex", flexDirection: "column", gap: 8 },
  muted: { fontSize: 12, color: V.muted },
  chip: { display: "flex", alignItems: "center", gap: 6, padding: "2px 6px", border: `1px solid ${V.border}`, borderRadius: 8 },
  ticketLabel: { fontSize: 12, fontWeight: 600, color: V.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  ticketMeta: { fontSize: 10, color: V.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  drawer: { fontSize: 12, color: V.text2, borderTop: `1px dashed ${V.border}`, paddingTop: 6 },
  section: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", borderTop: `1px dashed ${V.border}`, paddingTop: 8 },
  agentChip: { display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 8px", borderRadius: 999, background: V.surface2, border: `1px solid ${V.border}`, fontSize: 12, color: V.text },
  // `colorScheme` makes the browser draw the native <select> (and its OS/UA popup)
  // in the editor's active scheme even where the token background doesn't reach.
  select: { minWidth: 120, padding: "4px 8px", fontSize: 12, borderRadius: 8, border: `1px solid ${V.border}`, background: V.field, color: V.fieldText, colorScheme: "inherit" },
  icon: { fontSize: 12, lineHeight: 1, padding: "2px 4px", cursor: "pointer", background: "transparent", border: "none", color: V.muted },
  pill: (active) => ({
    fontSize: 12,
    fontWeight: 600,
    padding: "4px 10px",
    borderRadius: 999,
    cursor: "pointer",
    border: `1px solid ${active ? V.accent : V.border}`,
    background: active ? V.accent : V.surface2,
    color: active ? "#fff" : V.text2
  })
};

// src/chatTickets/useChatParticipants.ts
var import_react5 = require("react");
function useChatParticipants(adapter, chatId, refreshSignal = 0) {
  const [pool, setPool] = (0, import_react5.useState)([]);
  const [invited, setInvited] = (0, import_react5.useState)([]);
  const [members, setMembers] = (0, import_react5.useState)([]);
  (0, import_react5.useEffect)(() => {
    let ok = true;
    adapter.loadAgentPool().then((p) => {
      if (ok) setPool(p);
    }).catch(() => {
      if (ok) setPool([]);
    });
    return () => {
      ok = false;
    };
  }, [adapter]);
  (0, import_react5.useEffect)(() => {
    if (chatId == null) {
      setInvited([]);
      setMembers([]);
      return;
    }
    let ok = true;
    adapter.listAgents(chatId).then((a) => {
      if (ok) setInvited(a);
    }).catch(() => {
      if (ok) setInvited([]);
    });
    adapter.listMembers(chatId).then((m) => {
      if (ok) setMembers(m);
    }).catch(() => {
      if (ok) setMembers([]);
    });
    return () => {
      ok = false;
    };
  }, [adapter, chatId, refreshSignal]);
  return (0, import_react5.useMemo)(
    () => [
      ...invited.map((a) => ({
        kind: "agent",
        ref: a.agentRef,
        name: pool.find((p) => p.ref === a.agentRef)?.name ?? a.agentRef
      })),
      // Active human members are addressable too (kind='human', ref=user id).
      ...members.filter((m) => m.status === "active" && m.userId).map((m) => ({ kind: "human", ref: m.userId, name: m.name }))
    ],
    [invited, pool, members]
  );
}

// src/mention/MentionAutocomplete.tsx
var import_react6 = require("react");
var import_builderforce_brain_embedded2 = require("@seanhogg/builderforce-brain-embedded");
var import_jsx_runtime7 = require("react/jsx-runtime");
function useMentionAutocomplete(opts) {
  const { textareaRef, value, setValue, participants, onPick, labels, disabled } = opts;
  const [token, setToken] = (0, import_react6.useState)(null);
  const [index, setIndex] = (0, import_react6.useState)(0);
  const matches = (0, import_react6.useMemo)(
    () => token && !disabled ? (0, import_builderforce_brain_embedded2.filterMentionCandidates)(participants, token.query) : [],
    [token, participants, disabled]
  );
  const open = !disabled && token != null && matches.length > 0;
  const recompute = (0, import_react6.useCallback)(() => {
    const el = textareaRef.current;
    if (!el || disabled || participants.length === 0) {
      setToken(null);
      return;
    }
    const next = (0, import_builderforce_brain_embedded2.activeMentionToken)(el.value, el.selectionStart ?? el.value.length);
    setToken(next);
    setIndex(0);
  }, [textareaRef, disabled, participants.length]);
  (0, import_react6.useEffect)(() => {
    recompute();
  }, [value, recompute]);
  const choose = (0, import_react6.useCallback)((r) => {
    const el = textareaRef.current;
    const tk = token ?? (el ? (0, import_builderforce_brain_embedded2.activeMentionToken)(el.value, el.selectionStart ?? 0) : null);
    if (tk) {
      let after = value.slice(tk.end);
      if (after.startsWith(" ")) after = after.slice(1);
      setValue(value.slice(0, tk.start) + after);
      const caret = tk.start;
      requestAnimationFrame(() => {
        const node = textareaRef.current;
        if (node) {
          node.focus();
          try {
            node.setSelectionRange(caret, caret);
          } catch {
          }
        }
      });
    }
    setToken(null);
    onPick(r);
  }, [token, value, setValue, onPick, textareaRef]);
  const onKeyDown = (0, import_react6.useCallback)((e) => {
    if (!open) return false;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setIndex((i) => (i + 1) % matches.length);
        return true;
      case "ArrowUp":
        e.preventDefault();
        setIndex((i) => (i - 1 + matches.length) % matches.length);
        return true;
      case "Enter":
      case "Tab":
        e.preventDefault();
        choose(matches[Math.min(index, matches.length - 1)]);
        return true;
      case "Escape":
        e.preventDefault();
        setToken(null);
        return true;
      default:
        return false;
    }
  }, [open, matches, index, choose]);
  const popup = open ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(MentionPopup, { matches, index, labels, onHover: setIndex, onPick: choose }) : null;
  return { onKeyDown, onSelect: recompute, popup, open };
}
function MentionPopup({ matches, index, labels, onHover, onPick }) {
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: POP.anchor, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("ul", { role: "listbox", "aria-label": labels?.title ?? "Direct to", style: POP.list, children: [
    labels?.title && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("li", { "aria-hidden": true, style: POP.group, children: labels.title }),
    matches.map((m, i) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
      "li",
      {
        role: "option",
        "aria-selected": i === index,
        onMouseDown: (e) => {
          e.preventDefault();
          onPick(m);
        },
        onMouseEnter: () => onHover(i),
        style: POP.item(i === index),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Avatar, { name: m.name, kind: m.kind, size: 20 }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: POP.name, children: m.name }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: POP.kind, children: m.kind === "agent" ? labels?.agent ?? "Agent" : labels?.human ?? "Person" })
        ]
      },
      `${m.kind}:${m.ref}`
    ))
  ] }) });
}
var T = {
  border: "var(--bf-ct-border, var(--border-subtle, var(--bf-border, var(--vscode-panel-border, rgba(148,163,184,0.3)))))",
  surface: "var(--bf-ct-surface, var(--bg-elevated, var(--bf-surface, var(--vscode-editorWidget-background, #1e1e1e))))",
  hover: "var(--surface-interactive, var(--bg-base, var(--vscode-list-hoverBackground, rgba(148,163,184,0.16))))",
  active: "var(--surface-coral-soft, var(--vscode-list-activeSelectionBackground, rgba(59,130,246,0.18)))",
  text: "var(--bf-ct-text, var(--text-primary, var(--bf-text, var(--vscode-foreground, inherit))))",
  muted: "var(--bf-ct-text-muted, var(--text-muted, var(--bf-text-muted, var(--vscode-descriptionForeground, #6b7280))))"
};
var POP = {
  // Floats above the composer container (which must be position: relative).
  anchor: { position: "absolute", bottom: "calc(100% + 8px)", left: 0, zIndex: 60, width: "min(320px, 92vw)" },
  list: {
    margin: 0,
    padding: 4,
    listStyle: "none",
    maxHeight: 264,
    overflowY: "auto",
    borderRadius: 12,
    border: `1px solid ${T.border}`,
    background: T.surface,
    boxShadow: "0 8px 26px rgba(0,0,0,0.28)"
  },
  group: { padding: "4px 8px 5px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: T.muted },
  name: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: T.text, fontSize: 13, fontWeight: 600 },
  kind: { fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", color: T.muted, flexShrink: 0 },
  item: (active) => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 8px",
    borderRadius: 8,
    cursor: "pointer",
    background: active ? T.active : "transparent"
  })
};

// src/evermind/EvermindConsole.tsx
var import_react7 = require("react");

// src/evermind/types.ts
function defaultFormatWhen(atMs) {
  const diff = atMs - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const min = 6e4, hr = 60 * min, day = 24 * hr;
  if (abs < min) return rtf.format(Math.round(diff / 1e3), "second");
  if (abs < hr) return rtf.format(Math.round(diff / min), "minute");
  if (abs < day) return rtf.format(Math.round(diff / hr), "hour");
  return rtf.format(Math.round(diff / day), "day");
}
var DEFAULT_EVERMIND_LABELS = {
  title: "Project Evermind",
  description: "The self-learning model for this project. It adapts as this project\u2019s agents run \u2014 inspect what it has learned and steer its training below.",
  loading: "Loading\u2026",
  managerOnlyHint: "Only a project manager can change these settings.",
  statusSeeded: (v) => `Learning \xB7 v${v}`,
  statusUnseeded: "Not set up",
  pickModelLabel: "Base model",
  noModels: "No published Evermind models to start from yet. Train and publish one in Studio first.",
  notSetUp: "This project\u2019s Evermind hasn\u2019t been set up yet. A project manager can enable it.",
  enableCta: "Enable",
  working: "Working\u2026",
  versionLabel: "Version",
  contributionsLabel: "Learned",
  pendingLabel: "Queued",
  lastLearnedLabel: "Last learned",
  neverLearned: "Never",
  formatWhen: defaultFormatWhen,
  inferenceLabel: "Run on Evermind",
  inferenceHint: "When on, this project\u2019s agent runs execute on its own learned model.",
  learningLabel: "Learning",
  learningHint: "When connected, runs contribute what they learn back into the model.",
  on: "On",
  off: "Off",
  connected: "Connected",
  frozen: "Frozen",
  teacherLabel: "Teacher model",
  teacherHint: "Distil learning through a frontier model (task \u2192 its ideal answer) instead of raw run text. Pick one to enable \u2014 then every agent run learns from its answer, and you can teach it a task directly below.",
  teacherNone: "None (learn from raw runs)",
  teacherPaidOnly: "A teacher model is available on paid plans.",
  teacherActiveHint: (m) => `Teaching from ${m}. Every agent run \u2014 and each task you teach below \u2014 is answered by ${m}, and your Evermind learns from its ideal answer. There is nothing else to switch on.`,
  teachTitle: "Teach from a transcript",
  teachHint: "Paste a chat transcript or exemplar to contribute it to the model now.",
  teachPromptPlaceholder: "Task this answered (optional)\u2026",
  teachTextPlaceholder: "Paste the transcript or exemplar text\u2026",
  teachCta: "Teach",
  teaching: "Teaching\u2026",
  taught: "Queued for learning.",
  teachTeacherTitle: "Teach a task",
  teachTeacherHint: (m) => `Describe a task and ${m} answers it \u2014 your Evermind learns from the ideal answer. No transcript needed.`,
  teachTaskPlaceholder: "Describe a task to teach \u2014 the teacher will answer it\u2026",
  teachTeacherCta: "Teach from teacher",
  flushCta: "Learn now",
  flushing: "Learning\u2026",
  flushedNone: "Nothing queued to learn yet.",
  flushedN: (merged, version) => `Merged ${merged} contribution(s) into v${version}.`,
  inspectTitle: "Recently learned",
  inspectEmpty: "Nothing learned yet. Runs and teaching will appear here.",
  kindText: "Run",
  kindDelta: "Delta",
  deltaEntry: "Weight delta contributed by an agent run.",
  versionTag: (v) => `v${v}`,
  weightTag: (w) => `\xD7${w}`,
  refresh: "Refresh",
  errorGeneric: "Something went wrong. Try again."
};

// src/evermind/EvermindConsole.tsx
var import_jsx_runtime8 = require("react/jsx-runtime");
var C = {
  surface: "var(--bf-ev-surface, var(--bg-surface, var(--bf-surface, var(--vscode-editorWidget-background, transparent))))",
  surface2: "var(--bf-ev-surface-2, var(--bg-elevated, var(--bf-surface-2, var(--vscode-textBlockQuote-background, rgba(148,163,184,0.08)))))",
  border: "var(--bf-ev-border, var(--border-subtle, var(--bf-border, var(--vscode-panel-border, rgba(148,163,184,0.3)))))",
  text: "var(--bf-ev-text, var(--text-primary, var(--bf-text, inherit)))",
  text2: "var(--bf-ev-text-2, var(--text-secondary, var(--bf-text-muted, #6b7280)))",
  accent: "var(--bf-ev-accent, var(--coral-bright, var(--accent, var(--bf-accent, #ff6b5e))))",
  danger: "var(--bf-ev-danger, var(--danger-text, #d9534f))"
};
function EvermindConsole({ adapter, canManage, labels, refreshMs = 2e4, projectName }) {
  const t = (0, import_react7.useMemo)(() => ({ ...DEFAULT_EVERMIND_LABELS, ...labels ?? {} }), [labels]);
  const [data, setData] = (0, import_react7.useState)(null);
  const [seedModels, setSeedModels] = (0, import_react7.useState)([]);
  const [teacherOpts, setTeacherOpts] = (0, import_react7.useState)(null);
  const [selectedSlug, setSelectedSlug] = (0, import_react7.useState)("");
  const [teachPrompt, setTeachPrompt] = (0, import_react7.useState)("");
  const [teachText, setTeachText] = (0, import_react7.useState)("");
  const [busy, setBusy] = (0, import_react7.useState)(false);
  const [notice, setNotice] = (0, import_react7.useState)(null);
  const [error, setError] = (0, import_react7.useState)(null);
  const [loaded, setLoaded] = (0, import_react7.useState)(false);
  const [loadFailed, setLoadFailed] = (0, import_react7.useState)(false);
  const reload = (0, import_react7.useCallback)(async () => {
    try {
      const d = await adapter.loadData();
      setData(d);
      setLoadFailed(false);
    } catch {
      setData(null);
      setLoadFailed(true);
    } finally {
      setLoaded(true);
    }
  }, [adapter]);
  (0, import_react7.useEffect)(() => {
    setLoaded(false);
    void reload();
  }, [reload]);
  (0, import_react7.useEffect)(() => {
    if (!canManage) return;
    let cancelled = false;
    void adapter.loadSeedModels().then((m) => {
      if (!cancelled) {
        setSeedModels(m);
        setSelectedSlug((cur) => cur || (m[0]?.slug ?? ""));
      }
    }).catch(() => {
    });
    void adapter.loadTeacherOptions().then((o) => {
      if (!cancelled) setTeacherOpts(o);
    }).catch(() => {
    });
    return () => {
      cancelled = true;
    };
  }, [adapter, canManage]);
  (0, import_react7.useEffect)(() => {
    if (!refreshMs) return;
    const id = setInterval(() => {
      if (!busy) void reload();
    }, refreshMs);
    return () => clearInterval(id);
  }, [refreshMs, busy, reload]);
  const run = (0, import_react7.useCallback)(async (op, successNotice) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await op();
      await reload();
      if (successNotice) setNotice(successNotice);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errorGeneric);
    } finally {
      setBusy(false);
    }
  }, [reload, t.errorGeneric]);
  if (!loaded) return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Section, { "aria-busy": true, children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { style: { margin: 0, color: C.text2, fontSize: "0.82rem" }, children: t.loading }) });
  const seeded = !!data?.seeded;
  const frozen = data?.mode === "offline-frozen";
  const scopeName = projectName?.trim();
  const Header = /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("header", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { "aria-hidden": true, style: { fontSize: "1.05rem" }, children: "\u{1F9E0}" }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h3", { style: { margin: 0, fontSize: "0.95rem", fontWeight: 700, color: C.text }, children: t.title }),
    scopeName && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { style: { fontSize: "0.8rem", color: C.text2 }, title: scopeName, children: [
      "\xB7 ",
      scopeName
    ] }),
    !loadFailed && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { style: pill(seeded), children: seeded ? t.statusSeeded(data?.version ?? 0) : t.statusUnseeded }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { type: "button", onClick: () => void reload(), disabled: busy, style: ghostBtn, title: t.refresh, "aria-label": t.refresh, children: "\u21BB" })
  ] });
  if (loadFailed) {
    return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(Section, { "aria-label": t.title, children: [
      Header,
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { style: { margin: 0, fontSize: "0.8rem", lineHeight: 1.5, color: C.danger }, role: "alert", children: t.errorGeneric }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { type: "button", onClick: () => void reload(), disabled: busy, style: primaryBtn(busy), children: t.refresh })
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(Section, { "aria-label": t.title, children: [
    Header,
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { style: { margin: 0, fontSize: "0.8rem", lineHeight: 1.5, color: C.text2 }, children: t.description }),
    !canManage && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { style: { margin: 0, fontSize: "0.72rem", color: C.text2, fontStyle: "italic" }, children: t.managerOnlyHint }),
    !seeded ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
      SeedControls,
      {
        t,
        canManage,
        busy,
        models: seedModels,
        selectedSlug,
        onSelect: setSelectedSlug,
        onSeed: () => selectedSlug && run(() => adapter.seedFromModel(selectedSlug))
      }
    ) : /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(StatRow, { t, data }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        ToggleRow,
        {
          label: t.inferenceLabel,
          hint: t.inferenceHint,
          on: !!data?.inferenceEnabled,
          onText: t.on,
          offText: t.off,
          disabled: !canManage || busy,
          onToggle: () => run(() => adapter.setInference(!data?.inferenceEnabled))
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        ToggleRow,
        {
          label: t.learningLabel,
          hint: t.learningHint,
          on: !frozen,
          onText: t.connected,
          offText: t.frozen,
          disabled: !canManage || busy,
          onToggle: () => run(() => adapter.setMode(frozen ? "connected" : "offline-frozen"))
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        TeacherPicker,
        {
          t,
          canManage,
          busy,
          opts: teacherOpts,
          value: data?.teacherModel ?? "",
          onChange: (m) => run(() => adapter.setTeacher(m || null))
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        TeachBox,
        {
          t,
          busy,
          teacherModel: data?.teacherModel ?? "",
          prompt: teachPrompt,
          text: teachText,
          onPrompt: setTeachPrompt,
          onText: setTeachText,
          onTeach: () => run(
            async () => {
              const task = teachPrompt.trim();
              const body = teachText.trim();
              if (data?.teacherModel && body.length < 20 && task.length >= 20) {
                await adapter.teach(task, task);
              } else {
                await adapter.teach(body, task || void 0);
              }
              setTeachText("");
              setTeachPrompt("");
            },
            t.taught
          )
        }
      ),
      canManage && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
          "button",
          {
            type: "button",
            disabled: busy || frozen,
            onClick: () => run(async () => {
              const r = await adapter.flush();
              setNotice(r.merged > 0 ? t.flushedN(r.merged, r.version) : t.flushedNone);
            }, void 0),
            style: primaryBtn(busy || frozen),
            children: busy ? t.flushing : t.flushCta
          }
        ),
        (data?.pending ?? 0) > 0 && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { style: { fontSize: "0.74rem", color: C.text2 }, children: [
          t.pendingLabel,
          ": ",
          data?.pending
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(RecentList, { t, entries: data?.recent ?? [] })
    ] }),
    notice && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { style: { margin: 0, fontSize: "0.74rem", color: C.accent }, role: "status", children: notice }),
    error && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { style: { margin: 0, fontSize: "0.76rem", color: C.danger }, role: "alert", children: error })
  ] });
}
function Section({ children, ...rest }) {
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
    "section",
    {
      ...rest,
      style: {
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        background: C.surface,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10
      },
      children
    }
  );
}
function SeedControls({
  t,
  canManage,
  busy,
  models,
  selectedSlug,
  onSelect,
  onSeed
}) {
  if (!canManage) return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { style: italic, children: t.notSetUp });
  if (models.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { style: italic, children: t.noModels });
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("label", { style: fieldLabel, children: t.pickModelLabel }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("select", { value: selectedSlug, onChange: (e) => onSelect(e.target.value), disabled: busy, style: { ...select, flex: "1 1 200px" }, children: models.map((m) => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("option", { value: m.slug, style: optionStyle, children: m.name }, m.slug)) }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { type: "button", onClick: onSeed, disabled: busy || !selectedSlug, style: primaryBtn(busy || !selectedSlug), children: busy ? t.working : t.enableCta })
    ] })
  ] });
}
function StatRow({ t, data }) {
  const last = data.lastLearnedAt ? t.formatWhen(new Date(data.lastLearnedAt).getTime()) : t.neverLearned;
  const stats = [
    { label: t.versionLabel, value: `v${data.version}` },
    { label: t.contributionsLabel, value: String(data.contributions) },
    { label: t.pendingLabel, value: String(data.pending) },
    { label: t.lastLearnedLabel, value: last }
  ];
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(88px, 1fr))", gap: 8 }, children: stats.map((s) => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: { background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: { fontSize: "0.66rem", textTransform: "uppercase", letterSpacing: "0.04em", color: C.text2 }, children: s.label }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: { fontSize: "0.9rem", fontWeight: 700, color: C.text, marginTop: 2, wordBreak: "break-word" }, children: s.value })
  ] }, s.label)) });
}
function ToggleRow({
  label,
  hint,
  on,
  disabled,
  onToggle,
  onText,
  offText
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: { display: "flex", gap: 10, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: { flex: "1 1 200px", minWidth: 0 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: fieldTitle, children: label }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: fieldHint, children: hint })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
      "button",
      {
        type: "button",
        onClick: onToggle,
        disabled,
        "aria-pressed": on,
        style: {
          padding: "6px 14px",
          fontSize: "0.78rem",
          fontWeight: 700,
          borderRadius: 999,
          border: `1px solid ${on ? C.accent : C.border}`,
          background: on ? C.accent : C.surface2,
          color: on ? "#fff" : C.text2,
          cursor: disabled ? "not-allowed" : "pointer",
          whiteSpace: "nowrap",
          opacity: disabled ? 0.7 : 1
        },
        children: on ? onText : offText
      }
    )
  ] });
}
function TeacherPicker({
  t,
  canManage,
  busy,
  opts,
  value,
  onChange
}) {
  const models = opts?.models ?? [];
  const options = value && !models.includes(value) ? [value, ...models] : models;
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: fieldTitle, children: t.teacherLabel }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: fieldHint, children: t.teacherHint })
    ] }),
    !canManage ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: { ...select, color: C.text2 }, children: value || t.teacherNone }) : opts && !opts.isPaid ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { style: italic, children: t.teacherPaidOnly }) : /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("select", { value, onChange: (e) => onChange(e.target.value), disabled: busy, "aria-label": t.teacherLabel, style: { ...select, maxWidth: 340 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("option", { value: "", style: optionStyle, children: t.teacherNone }),
      options.map((m) => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("option", { value: m, style: optionStyle, children: m }, m))
    ] }),
    value && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: { fontSize: "0.72rem", lineHeight: 1.4, color: C.accent, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px" }, children: t.teacherActiveHint(value) })
  ] });
}
function TeachBox({
  t,
  busy,
  prompt,
  text,
  onPrompt,
  onText,
  onTeach,
  teacherModel
}) {
  const teaching = !!teacherModel;
  const canTeach = teaching ? prompt.trim().length >= 20 : text.trim().length >= 20;
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 6, borderTop: `1px solid ${C.border}`, paddingTop: 10 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: fieldTitle, children: teaching ? t.teachTeacherTitle : t.teachTitle }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: fieldHint, children: teaching ? t.teachTeacherHint(teacherModel) : t.teachHint }),
    teaching ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("textarea", { value: prompt, onChange: (e) => onPrompt(e.target.value), disabled: busy, placeholder: t.teachTaskPlaceholder, rows: 3, style: { ...select, width: "100%", resize: "vertical", fontFamily: "inherit" } }) : /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("input", { value: prompt, onChange: (e) => onPrompt(e.target.value), disabled: busy, placeholder: t.teachPromptPlaceholder, style: { ...select, width: "100%" } }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("textarea", { value: text, onChange: (e) => onText(e.target.value), disabled: busy, placeholder: t.teachTextPlaceholder, rows: 3, style: { ...select, width: "100%", resize: "vertical", fontFamily: "inherit" } })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { type: "button", onClick: onTeach, disabled: busy || !canTeach, style: primaryBtn(busy || !canTeach), children: busy ? t.teaching : teaching ? t.teachTeacherCta : t.teachCta }) })
  ] });
}
function RecentList({ t, entries }) {
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 6, borderTop: `1px solid ${C.border}`, paddingTop: 10 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: fieldTitle, children: t.inspectTitle }),
    entries.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { style: italic, children: t.inspectEmpty }) : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("ul", { style: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }, children: entries.map((e, i) => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(RecentRow, { t, entry: e }, `${e.version}-${e.at}-${i}`)) })
  ] });
}
function RecentRow({ t, entry }) {
  const body = entry.kind === "delta" ? t.deltaEntry : entry.text ?? "";
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("li", { style: { background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 3 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { style: tag(entry.kind === "delta"), children: entry.kind === "delta" ? t.kindDelta : t.kindText }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { style: { fontSize: "0.68rem", color: C.text2 }, children: t.versionTag(entry.version) }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { style: { fontSize: "0.68rem", color: C.text2 }, children: t.weightTag(entry.weight) }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { style: { marginLeft: "auto", fontSize: "0.68rem", color: C.text2 }, children: t.formatWhen(entry.at) })
    ] }),
    entry.prompt && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: { fontSize: "0.76rem", fontWeight: 600, color: C.text, wordBreak: "break-word" }, children: entry.prompt }),
    body && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: { fontSize: "0.74rem", color: C.text2, lineHeight: 1.45, wordBreak: "break-word", whiteSpace: "pre-wrap", maxHeight: 72, overflow: "hidden" }, children: body })
  ] });
}
var italic = { margin: 0, fontSize: "0.78rem", color: C.text2, fontStyle: "italic" };
var fieldLabel = { fontSize: "0.78rem", fontWeight: 600, color: C.text2 };
var fieldTitle = { fontSize: "0.82rem", fontWeight: 600, color: C.text };
var fieldHint = { fontSize: "0.72rem", color: C.text2, lineHeight: 1.4 };
var select = {
  padding: "7px 9px",
  fontSize: "0.8rem",
  borderRadius: 8,
  border: `1px solid ${C.border}`,
  background: C.surface2,
  color: C.text,
  boxSizing: "border-box"
};
var optionStyle = {
  background: "var(--bf-ev-surface-solid, var(--bg-surface, var(--vscode-dropdown-background, Canvas)))",
  color: "var(--bf-ev-text, var(--text-primary, var(--vscode-dropdown-foreground, CanvasText)))"
};
function primaryBtn(disabled) {
  return {
    padding: "8px 14px",
    fontSize: "0.8rem",
    fontWeight: 600,
    borderRadius: 8,
    border: "1px solid transparent",
    background: disabled ? C.surface2 : C.accent,
    color: disabled ? C.text2 : "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap"
  };
}
var ghostBtn = {
  marginLeft: "auto",
  padding: "2px 8px",
  fontSize: "0.9rem",
  lineHeight: 1,
  borderRadius: 6,
  border: `1px solid ${C.border}`,
  background: "transparent",
  color: C.text2,
  cursor: "pointer"
};
function pill(seeded) {
  return {
    fontSize: 11,
    fontWeight: 600,
    padding: "3px 10px",
    borderRadius: 999,
    border: `1px solid ${C.border}`,
    background: C.surface2,
    color: seeded ? C.accent : C.text2
  };
}
function tag(isDelta) {
  return {
    fontSize: "0.64rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    padding: "1px 6px",
    borderRadius: 5,
    border: `1px solid ${C.border}`,
    color: isDelta ? C.text2 : C.accent,
    background: C.surface
  };
}

// src/project360/Project360View.tsx
var import_react8 = require("react");

// src/project360/Sunburst.tsx
var import_jsx_runtime9 = require("react/jsx-runtime");
var CX = 160;
var CY = 160;
var R_CENTER = 46;
var R_INNER_0 = 48;
var R_INNER_1 = 96;
var R_OUTER_0 = 100;
var R_OUTER_1 = 150;
function polar(r, angleDeg) {
  const a = (angleDeg - 90) * Math.PI / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}
function sector(rInner, rOuter, startDeg, endDeg) {
  const large = endDeg - startDeg > 180 ? 1 : 0;
  const [ox0, oy0] = polar(rOuter, startDeg);
  const [ox1, oy1] = polar(rOuter, endDeg);
  const [ix1, iy1] = polar(rInner, endDeg);
  const [ix0, iy0] = polar(rInner, startDeg);
  return [
    `M${ox0.toFixed(2)},${oy0.toFixed(2)}`,
    `A${rOuter},${rOuter} 0 ${large} 1 ${ox1.toFixed(2)},${oy1.toFixed(2)}`,
    `L${ix1.toFixed(2)},${iy1.toFixed(2)}`,
    `A${rInner},${rInner} 0 ${large} 0 ${ix0.toFixed(2)},${iy0.toFixed(2)}`,
    "Z"
  ].join(" ");
}
function labelAt(r, angleDeg) {
  const [x, y] = polar(r, angleDeg);
  return { x, y };
}
function twoLines(label) {
  if (label.length <= 9) return [label];
  const mid = label.indexOf(" ", Math.floor(label.length / 2) - 3);
  if (mid > 0) return [label.slice(0, mid), label.slice(mid + 1)];
  return [label];
}
function Sunburst({ pillars, dimensions, overall, selected, onSelect, ariaLabel }) {
  const nPillars = pillars.length || 1;
  const pillarSpan = 360 / nPillars;
  const dimsByPillar = pillars.map((p) => dimensions.filter((d) => d.pillar === p.key));
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(
    "svg",
    {
      className: "bf-360-wheel",
      viewBox: "0 0 320 320",
      role: "img",
      "aria-label": ariaLabel ?? "Project 360 health wheel",
      children: [
        pillars.map((pillar, pi) => {
          const pStart = pi * pillarSpan;
          const pEnd = pStart + pillarSpan;
          const pMid = (pStart + pEnd) / 2;
          const dims = dimsByPillar[pi];
          const dimSpan = pillarSpan / (dims.length || 1);
          const pLabel = labelAt((R_INNER_0 + R_INNER_1) / 2, pMid);
          return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("g", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
              "path",
              {
                d: sector(R_INNER_0, R_INNER_1, pStart + 0.6, pEnd - 0.6),
                fill: pillar.color,
                fillOpacity: 0.9,
                className: "bf-360-arc bf-360-arc--pillar"
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
              "text",
              {
                x: pLabel.x,
                y: pLabel.y,
                className: "bf-360-arc-label bf-360-arc-label--pillar",
                textAnchor: "middle",
                dominantBaseline: "central",
                children: pillar.label
              }
            ),
            dims.map((dim, di) => {
              const dStart = pStart + di * dimSpan;
              const dEnd = dStart + dimSpan;
              const dMid = (dStart + dEnd) / 2;
              const isSel = selected === dim.key;
              const lab = labelAt((R_OUTER_0 + R_OUTER_1) / 2, dMid);
              const lines = twoLines(dim.label);
              return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(
                "g",
                {
                  className: "bf-360-arc-group",
                  onClick: () => onSelect?.(isSel ? null : dim.key),
                  role: "button",
                  "aria-pressed": isSel,
                  "aria-label": `${dim.label}: ${dim.score} of 100`,
                  children: [
                    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                      "path",
                      {
                        d: sector(R_OUTER_0, R_OUTER_1, dStart + 0.6, dEnd - 0.6),
                        fill: dim.color,
                        fillOpacity: isSel ? 1 : 0.82,
                        className: `bf-360-arc bf-360-arc--dim${isSel ? " is-selected" : ""}`
                      }
                    ),
                    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                      "text",
                      {
                        x: lab.x,
                        y: lab.y,
                        className: "bf-360-arc-label",
                        textAnchor: "middle",
                        dominantBaseline: "central",
                        children: lines.map((ln, li) => /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("tspan", { x: lab.x, dy: li === 0 ? lines.length > 1 ? "-0.5em" : "0" : "1em", children: ln }, li))
                      }
                    )
                  ]
                },
                dim.key
              );
            })
          ] }, pillar.key);
        }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("circle", { cx: CX, cy: CY, r: R_CENTER, className: "bf-360-center", onClick: () => onSelect?.(null), role: "button", "aria-label": "Clear selection" }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("circle", { cx: CX, cy: CY, r: R_CENTER, fill: "none", stroke: overall.color, strokeWidth: 3, className: "bf-360-center-ring" }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("text", { x: CX, y: CY - 8, className: "bf-360-center-score", textAnchor: "middle", dominantBaseline: "central", fill: overall.color, children: overall.score }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("text", { x: CX, y: CY + 14, className: "bf-360-center-label", textAnchor: "middle", dominantBaseline: "central", children: "HEALTH" })
      ]
    }
  );
}

// src/project360/types.ts
var DEFAULT_PROJECT360_LABELS = {
  title: "Project 360",
  subtitle: "The whole picture \u2014 health, gaps, and who is moving the work.",
  overall: "Overall health",
  progress: "Progress",
  refresh: "Refresh",
  openBoard: "Open board",
  improveAll: "Improve with Brain",
  connecting: "Loading Project 360\u2026",
  loadError: "Couldn't load Project 360",
  noData: "No tasks yet",
  noDataHint: "Add tasks to this project to see its health, gaps, and team activity.",
  missingItems: "Missing items \u2014 improve health",
  noGaps: "No gaps found. This project is in good shape.",
  workforce: "Who's working / idle",
  noWorkforce: "Nobody is assigned to this project yet.",
  allDimensions: "All dimensions",
  counts_open: "open",
  counts_blocked: "blocked",
  counts_overdue: "overdue",
  counts_running: "running",
  status_working: "Working",
  status_awaiting: "Awaiting input",
  status_blocked: "Blocked",
  status_idle: "Idle",
  status_available: "Available",
  member_run: "Run",
  member_open: "Open",
  improveSeedIntro: "Here is my project\u2019s Project 360 health check. Help me work through these gaps, highest impact first."
};

// src/project360/Project360View.tsx
var import_jsx_runtime10 = require("react/jsx-runtime");
var STATUS_ORDER = ["working", "awaiting", "blocked", "idle", "available"];
function Project360View({ data, loading, error, labels, onAction, onRefresh }) {
  const L = (0, import_react8.useMemo)(() => ({ ...DEFAULT_PROJECT360_LABELS, ...labels ?? {} }), [labels]);
  const [selected, setSelected] = (0, import_react8.useState)(null);
  const sortedWorkforce = (0, import_react8.useMemo)(
    () => [...data?.workforce ?? []].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)),
    [data?.workforce]
  );
  if (error) {
    return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "bf-360-state", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "bf-360-state__title", children: L.loadError }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "bf-360-state__hint", children: error }),
      onRefresh && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { className: "bf-btn", onClick: onRefresh, children: L.refresh })
    ] });
  }
  if (!data || loading) {
    return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "bf-360-state", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "bf-360-spinner" }),
      L.connecting
    ] });
  }
  const { project, overall, counts, pillars, dimensions, gaps, workforce, hasData } = data;
  const selectedDim = selected ? dimensions.find((d) => d.key === selected) ?? null : null;
  const shownGaps = selectedDim ? gaps.filter((g) => g.dimension === selected) : gaps;
  const improveAll = () => {
    if (!gaps.length) return;
    const lines = gaps.map((g) => `- ${g.title}`).join("\n");
    onAction?.({
      kind: "brain",
      label: L.improveAll,
      text: `${L.improveSeedIntro}

Project: "${project.name}" (overall health ${overall.score}/100).
Gaps:
${lines}`
    });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "bf-360", children: [
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("header", { className: "bf-360-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "bf-360-head__id", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "bf-360-head__title", children: project.name }),
        project.key && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "bf-360-head__key", children: project.key })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "bf-360-head__spacer" }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { className: "bf-btn", onClick: () => onAction?.({ kind: "board", label: L.openBoard }), children: L.openBoard }),
      gaps.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { className: "bf-btn bf-btn--primary", onClick: improveAll, children: L.improveAll }),
      onRefresh && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { className: "bf-btn bf-btn--icon", title: L.refresh, "aria-label": L.refresh, onClick: onRefresh, children: "\u27F3" })
    ] }),
    !hasData ? /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "bf-360-state", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "bf-360-state__title", children: L.noData }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "bf-360-state__hint", children: L.noDataHint }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { className: "bf-btn", onClick: () => onAction?.({ kind: "board", label: L.openBoard }), children: L.openBoard })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "bf-360-grid", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("section", { className: "bf-360-col bf-360-col--wheel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
          Sunburst,
          {
            pillars,
            dimensions,
            overall,
            selected,
            onSelect: setSelected,
            ariaLabel: `${project.name} health wheel`
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "bf-360-overall", children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "bf-360-progress", "aria-label": `${L.progress} ${overall.progressPct}%`, children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "bf-360-progress__fill", style: { width: `${overall.progressPct}%`, background: overall.color } }) }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "bf-360-progress__label", children: [
            L.progress,
            ": ",
            overall.progressPct,
            "%"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "bf-360-counts", children: [
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Count, { n: counts.open, label: L.counts_open }),
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Count, { n: counts.blocked, label: L.counts_blocked, tone: counts.blocked ? "warn" : void 0 }),
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Count, { n: counts.overdue, label: L.counts_overdue, tone: counts.overdue ? "bad" : void 0 }),
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Count, { n: counts.activeRuns, label: L.counts_running, tone: counts.activeRuns ? "good" : void 0 })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("section", { className: "bf-360-col bf-360-col--detail", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "bf-360-legend-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { children: selectedDim ? selectedDim.label : L.allDimensions }),
          selectedDim && /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("button", { className: "bf-360-clear", onClick: () => setSelected(null), children: [
            L.allDimensions,
            " \u2715"
          ] })
        ] }),
        selectedDim ? /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "bf-360-dim-detail", children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ScoreDot, { score: selectedDim.score, color: selectedDim.color }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "bf-360-dim-detail__summary", children: selectedDim.summary })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("ul", { className: "bf-360-dim-list", children: dimensions.map((d) => /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(
          "button",
          {
            className: "bf-360-dim-row",
            onClick: () => setSelected(d.key),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ScoreDot, { score: d.score, color: d.color }),
              /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "bf-360-dim-row__label", children: d.label }),
              /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "bf-360-dim-row__summary", children: d.summary })
            ]
          }
        ) }, d.key)) })
      ] })
    ] }),
    hasData && /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("section", { className: "bf-360-section", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("h3", { className: "bf-360-section__title", children: [
          L.missingItems,
          shownGaps.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "bf-360-section__count", children: shownGaps.length })
        ] }),
        shownGaps.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "bf-360-empty", children: L.noGaps }) : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("ul", { className: "bf-360-gaps", children: shownGaps.map((g) => /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(GapRow, { gap: g, onAction }, g.id)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("section", { className: "bf-360-section", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("h3", { className: "bf-360-section__title", children: [
          L.workforce,
          workforce.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "bf-360-section__count", children: workforce.length })
        ] }),
        workforce.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "bf-360-empty", children: L.noWorkforce }) : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("ul", { className: "bf-360-people", children: sortedWorkforce.map((m) => /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(MemberRow, { member: m, labels: L, onAction }, m.ref)) })
      ] })
    ] })
  ] });
}
function Count({ n, label, tone }) {
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("span", { className: `bf-360-count${tone ? ` bf-360-count--${tone}` : ""}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("b", { children: n }),
    " ",
    label
  ] });
}
function ScoreDot({ score, color }) {
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "bf-360-scoredot", style: { borderColor: color, color }, children: score });
}
function GapRow({ gap, onAction }) {
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("li", { className: `bf-360-gap bf-360-gap--${gap.severity}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: `bf-360-sev bf-360-sev--${gap.severity}`, "aria-hidden": true }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "bf-360-gap__body", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "bf-360-gap__title", children: gap.title }),
      gap.detail && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "bf-360-gap__detail", children: gap.detail })
    ] }),
    gap.action && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { className: "bf-btn bf-360-gap__cta", onClick: () => onAction?.(gap.action), children: gap.action.label })
  ] });
}
function MemberRow({ member, labels, onAction }) {
  const statusLabel = {
    working: labels.status_working,
    awaiting: labels.status_awaiting,
    blocked: labels.status_blocked,
    idle: labels.status_idle,
    available: labels.status_available
  }[member.status];
  const task = member.taskId != null ? { id: member.taskId, key: member.taskKey, title: member.taskTitle ?? "", taskType: member.taskType } : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("li", { className: "bf-360-person", children: [
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: `bf-360-dot bf-360-dot--${member.status}`, title: statusLabel, "aria-label": statusLabel }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "bf-360-person__body", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "bf-360-person__top", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "bf-360-person__name", children: member.name }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: `bf-360-kind bf-360-kind--${member.kind}`, children: member.kind }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "bf-360-person__status", children: statusLabel })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "bf-360-person__reason", children: member.reason })
    ] }),
    task && /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "bf-360-person__actions", children: [
      (member.status === "idle" || member.status === "available") && member.kind !== "human" && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { className: "bf-btn bf-360-person__btn", onClick: () => onAction?.({ kind: "run-task", label: labels.member_run, task }), children: labels.member_run }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { className: "bf-btn bf-360-person__btn", onClick: () => onAction?.({ kind: "open-task", label: labels.member_open, task }), children: labels.member_open })
    ] })
  ] });
}

// src/projectList/ProjectListView.tsx
var import_react9 = require("react");

// src/projectList/types.ts
var DEFAULT_PROJECT_LIST_LABELS = {
  refresh: "Refresh",
  connecting: "Loading\u2026",
  loadError: "Couldn't load this page",
  empty: "Nothing here yet",
  emptyHint: "",
  items: "items"
};

// src/projectList/ProjectListView.tsx
var import_jsx_runtime11 = require("react/jsx-runtime");
function ProjectListView({ title, subtitle, data, loading, error, labels, onAction, onRefresh }) {
  const L = (0, import_react9.useMemo)(() => ({ ...DEFAULT_PROJECT_LIST_LABELS, ...labels ?? {} }), [labels]);
  const header = /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("header", { className: "bf-list-head", children: [
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "bf-list-head__id", children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "bf-list-head__title", children: title }),
      data && /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", { className: "bf-list-head__count", children: [
        data.total,
        " ",
        L.items
      ] })
    ] }),
    subtitle && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { className: "bf-list-head__sub", children: subtitle }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { className: "bf-list-head__spacer" }),
    onRefresh && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("button", { className: "bf-btn bf-btn--icon", title: L.refresh, "aria-label": L.refresh, onClick: onRefresh, children: "\u27F3" })
  ] });
  if (error) {
    return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "bf-list", children: [
      header,
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "bf-360-state", children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { className: "bf-360-state__title", children: L.loadError }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { className: "bf-360-state__hint", children: error }),
        onRefresh && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("button", { className: "bf-btn", onClick: onRefresh, children: L.refresh })
      ] })
    ] });
  }
  if (!data || loading) {
    return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "bf-list", children: [
      header,
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "bf-360-state", children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { className: "bf-360-spinner" }),
        L.connecting
      ] })
    ] });
  }
  if (data.total === 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "bf-list", children: [
      header,
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "bf-360-state", children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { className: "bf-360-state__title", children: L.empty }),
        L.emptyHint && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { className: "bf-360-state__hint", children: L.emptyHint })
      ] })
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "bf-list", children: [
    header,
    data.groups.filter((g) => g.items.length > 0).map((g) => /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("section", { className: "bf-list-group", children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("h3", { className: "bf-list-group__title", children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: `bf-list-group__dot bf-list-tone--${g.tone ?? "default"}`, "aria-hidden": true }),
        g.label,
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "bf-360-section__count", children: g.items.length })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("ul", { className: "bf-list-rows", children: g.items.map((it) => /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Row, { item: it, onAction }, it.id)) })
    ] }, g.key))
  ] });
}
function Row({ item, onAction }) {
  const act = item.action;
  const clickable = !!act && !!onAction;
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("li", { className: "bf-list-row", children: /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(
    "button",
    {
      className: "bf-list-row__main",
      disabled: !clickable,
      onClick: clickable ? () => onAction(act) : void 0,
      title: clickable ? act.label : void 0,
      children: [
        item.key && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "bf-list-row__key", children: item.key }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", { className: "bf-list-row__body", children: [
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "bf-list-row__title", children: item.title }),
          item.subtitle && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "bf-list-row__sub", children: item.subtitle })
        ] }),
        item.badges && item.badges.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "bf-list-row__badges", children: item.badges.map((b, i) => /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: `bf-list-badge bf-list-tone--${b.tone ?? "default"}`, children: b.label }, i)) })
      ]
    }
  ) });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Avatar,
  BrainTimeline,
  ChatTicketsPanel,
  DEFAULT_ASK_USER_LABELS,
  DEFAULT_CHAT_TICKETS_LABELS,
  DEFAULT_EVERMIND_LABELS,
  DEFAULT_PROJECT360_LABELS,
  DEFAULT_PROJECT_LIST_LABELS,
  DEFAULT_TIMELINE_LABELS,
  EvermindConsole,
  HealthRing,
  Markdown,
  ParticipantBadge,
  Project360View,
  ProjectListView,
  QuestionCard,
  RUNNABLE_KINDS,
  Sunburst,
  TICKET_KINDS,
  attachmentsOf,
  avatarColor,
  buildSettledTimeline,
  buildTimeline,
  formatDuration,
  formatPayload,
  healthRingColor,
  initialsOf,
  parseAskUser,
  serializeAskUser,
  streamingNode,
  stripAskUser,
  useChatParticipants,
  useMentionAutocomplete
});
//# sourceMappingURL=index.cjs.map