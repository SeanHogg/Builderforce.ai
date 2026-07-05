// src/BrainTimeline.tsx
import React2, { useEffect, useMemo as useMemo2, useRef, useState as useState2 } from "react";
import { parseDirectedRecipient, parseMessageAuthor } from "@seanhogg/builderforce-brain-embedded";

// src/Markdown.tsx
import React, { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
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
  const [copied, setCopied] = useState(false);
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
  return /* @__PURE__ */ jsxs("div", { className: "bf-md__code", children: [
    /* @__PURE__ */ jsxs("div", { className: "bf-md__code-actions", children: [
      /* @__PURE__ */ jsx("button", { type: "button", className: "bf-md__code-btn", onClick: copy, children: copied ? labels.copied : labels.copy }),
      onApplyCode && /* @__PURE__ */ jsx("button", { type: "button", className: "bf-md__code-btn", onClick: () => onApplyCode(code), children: labels.apply }),
      onCreateFile && /* @__PURE__ */ jsx("button", { type: "button", className: "bf-md__code-btn", onClick: () => onCreateFile(detectPath(code), code), children: labels.createFile })
    ] }),
    /* @__PURE__ */ jsx("pre", { children: /* @__PURE__ */ jsx("code", { children: code }) })
  ] });
}
function MarkdownInner({ content, onInternalLink, onApplyCode, onCreateFile, labels }) {
  const lab = useMemo(() => ({ ...DEFAULT_LABELS, ...labels }), [labels]);
  return /* @__PURE__ */ jsx("div", { className: "bf-md", children: /* @__PURE__ */ jsx(
    ReactMarkdown,
    {
      remarkPlugins: [remarkGfm],
      components: {
        a({ href, children, ...rest }) {
          const target = href ?? "";
          if (target && !isExternal(target) && onInternalLink) {
            return /* @__PURE__ */ jsx(
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
          return /* @__PURE__ */ jsx("a", { href: target, target: "_blank", rel: "noopener noreferrer", ...rest, children });
        },
        code(props) {
          const { inline, className, children } = props;
          const text = String(children ?? "").replace(/\n$/, "");
          if (inline || !className && !text.includes("\n")) {
            return /* @__PURE__ */ jsx("code", { className: "bf-md__inline", children });
          }
          return /* @__PURE__ */ jsx(CodeBlock, { code: text, onApplyCode, onCreateFile, labels: lab });
        },
        pre({ children }) {
          return /* @__PURE__ */ jsx(Fragment, { children });
        }
      },
      children: content
    }
  ) });
}
var Markdown = React.memo(MarkdownInner);

// src/ParticipantBadge.tsx
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
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
  return /* @__PURE__ */ jsx2(
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
  return /* @__PURE__ */ jsxs2("span", { style: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, opacity: 0.95 }, children: [
    prefix ? /* @__PURE__ */ jsx2("span", { "aria-hidden": true, style: { opacity: 0.7 }, children: prefix }) : null,
    /* @__PURE__ */ jsx2(Avatar, { name: recipient.name, kind: recipient.kind, size }),
    /* @__PURE__ */ jsx2("span", { children: recipient.name })
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
import { Fragment as Fragment2, jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
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
  preview: "Preview"
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
function CopyButton({ text, labels }) {
  const [copied, setCopied] = useState2(false);
  return /* @__PURE__ */ jsx3(
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
  return /* @__PURE__ */ jsx3(Fragment2, { children: text.split("\n").map((line, i) => /* @__PURE__ */ jsxs3("div", { className: `bf-tl__diff-line ${cls}`, children: [
    /* @__PURE__ */ jsx3("span", { className: "bf-tl__diff-sign", "aria-hidden": true, children: sign }),
    /* @__PURE__ */ jsx3("span", { className: "bf-tl__diff-text", children: line || "\xA0" })
  ] }, i)) });
}
function ToolStep({
  node,
  labels
}) {
  const argsText = formatPayload(node.args);
  const resultText = formatPayload(node.result);
  const preview = toolPreview(node.args);
  return /* @__PURE__ */ jsxs3("details", { className: `bf-tl__tool${node.isError ? " bf-tl__tool--error" : ""}`, children: [
    /* @__PURE__ */ jsxs3("summary", { className: "bf-tl__tool-head", children: [
      /* @__PURE__ */ jsx3("span", { className: "bf-tl__tool-status", "aria-hidden": true, children: node.isError ? "\u2717" : "\u2713" }),
      /* @__PURE__ */ jsx3("span", { className: "bf-tl__tool-name", children: node.label }),
      node.durationMs != null && /* @__PURE__ */ jsx3("span", { className: "bf-tl__tool-dur", children: formatDuration(node.durationMs) }),
      /* @__PURE__ */ jsx3("span", { className: "bf-tl__tool-caret", "aria-hidden": true, children: "\u25B8" })
    ] }),
    /* @__PURE__ */ jsxs3("div", { className: "bf-tl__tool-body", children: [
      preview && /* @__PURE__ */ jsxs3("div", { className: "bf-tl__io", children: [
        /* @__PURE__ */ jsxs3("div", { className: "bf-tl__io-label", children: [
          /* @__PURE__ */ jsxs3("span", { children: [
            labels.preview,
            preview.path ? ` \xB7 ${preview.path}` : ""
          ] }),
          /* @__PURE__ */ jsx3(
            CopyButton,
            {
              text: preview.kind === "edit" ? preview.newText : preview.content,
              labels
            }
          )
        ] }),
        preview.kind === "edit" ? /* @__PURE__ */ jsxs3("div", { className: "bf-tl__diff", children: [
          /* @__PURE__ */ jsx3(DiffLines, { text: preview.oldText, sign: "-" }),
          /* @__PURE__ */ jsx3(DiffLines, { text: preview.newText, sign: "+" })
        ] }) : /* @__PURE__ */ jsx3("pre", { className: "bf-tl__io-pre", children: /* @__PURE__ */ jsx3("code", { children: preview.content }) })
      ] }),
      argsText && /* @__PURE__ */ jsxs3("div", { className: "bf-tl__io", children: [
        /* @__PURE__ */ jsxs3("div", { className: "bf-tl__io-label", children: [
          /* @__PURE__ */ jsx3("span", { children: labels.input }),
          /* @__PURE__ */ jsx3(CopyButton, { text: argsText, labels })
        ] }),
        /* @__PURE__ */ jsx3("pre", { className: "bf-tl__io-pre", children: /* @__PURE__ */ jsx3("code", { children: argsText }) })
      ] }),
      resultText && /* @__PURE__ */ jsxs3("div", { className: "bf-tl__io", children: [
        /* @__PURE__ */ jsxs3("div", { className: "bf-tl__io-label", children: [
          /* @__PURE__ */ jsx3("span", { children: labels.output }),
          /* @__PURE__ */ jsx3(CopyButton, { text: resultText, labels })
        ] }),
        /* @__PURE__ */ jsx3("pre", { className: "bf-tl__io-pre", children: /* @__PURE__ */ jsx3("code", { children: resultText }) })
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
  autoScroll = true
}) {
  const labels = useMemo2(() => ({ ...DEFAULT_TIMELINE_LABELS, ...labelOverrides }), [labelOverrides]);
  const assistant = assistantName ?? labels.assistant;
  const settled = useMemo2(() => buildSettledTimeline(messages, trace), [messages, trace]);
  const nodes = useMemo2(() => {
    const streaming = streamingNode(streamingText, isRunning);
    return streaming ? [...settled, streaming] : settled;
  }, [settled, streamingText, isRunning]);
  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  const pinnedRef = useRef(true);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  useEffect(() => {
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
  const renderMsg = (msg, role, text) => renderMessage ? renderMessage(msg, { role, text }) : /* @__PURE__ */ jsx3(
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
  return /* @__PURE__ */ jsxs3("div", { className: "bf-tl-scroll", ref: scrollRef, onScroll, children: [
    loading && /* @__PURE__ */ jsx3("div", { className: "bf-tl-status", children: labels.loading }),
    isEmpty && (emptyState ?? /* @__PURE__ */ jsx3("div", { className: "bf-tl-empty", children: labels.empty })),
    /* @__PURE__ */ jsxs3("ol", { className: "bf-tl", ref: contentRef, children: [
      nodes.map((node) => {
        if (node.kind === "user") {
          const to = parseDirectedRecipient(node.message);
          return /* @__PURE__ */ jsxs3("li", { className: "bf-tl__item bf-tl__item--user", children: [
            /* @__PURE__ */ jsx3("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ jsx3("span", { className: "bf-tl__dot", children: dotIcon("user") }) }),
            /* @__PURE__ */ jsxs3("div", { className: "bf-tl__body", children: [
              /* @__PURE__ */ jsxs3("div", { className: "bf-tl__role", style: to ? { display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" } : void 0, children: [
                /* @__PURE__ */ jsx3("span", { children: labels.you }),
                to && /* @__PURE__ */ jsxs3("span", { style: { display: "inline-flex", alignItems: "center", gap: 4, opacity: 0.9 }, children: [
                  /* @__PURE__ */ jsx3("span", { "aria-hidden": true, style: { opacity: 0.6 }, children: "\u2192" }),
                  /* @__PURE__ */ jsx3(Avatar, { name: to.name, kind: to.kind, size: 15 }),
                  /* @__PURE__ */ jsx3("span", { children: to.name })
                ] })
              ] }),
              node.images.length > 0 && /* @__PURE__ */ jsx3("div", { className: "bf-tl__images", children: node.images.map((im, i) => /* @__PURE__ */ jsx3("img", { src: im.url, alt: im.name ?? "", className: "bf-tl__image" }, i)) }),
              node.text && /* @__PURE__ */ jsx3("div", { className: "bf-tl__bubble bf-tl__bubble--user", children: renderMsg(node.message, "user", node.text) })
            ] })
          ] }, node.key);
        }
        if (node.kind === "assistant") {
          const author = parseMessageAuthor(node.message);
          return /* @__PURE__ */ jsxs3("li", { className: "bf-tl__item bf-tl__item--assistant", children: [
            /* @__PURE__ */ jsx3("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ jsx3("span", { className: "bf-tl__dot", children: author ? /* @__PURE__ */ jsx3(Avatar, { name: author.name, kind: author.kind, size: 16 }) : dotIcon("assistant") }) }),
            /* @__PURE__ */ jsxs3("div", { className: "bf-tl__body", children: [
              /* @__PURE__ */ jsx3("div", { className: "bf-tl__role", children: author ? author.name : assistant }),
              /* @__PURE__ */ jsx3("div", { className: "bf-tl__bubble", children: renderMsg(node.message, "assistant", node.text) }),
              renderAssistantActions && /* @__PURE__ */ jsx3("div", { className: "bf-tl__actions", children: renderAssistantActions(node.message) })
            ] })
          ] }, node.key);
        }
        if (node.kind === "thinking") {
          const label = labels.thoughtFor.replace("{duration}", formatDuration(node.durationMs));
          return /* @__PURE__ */ jsxs3("li", { className: "bf-tl__item bf-tl__item--thinking", children: [
            /* @__PURE__ */ jsx3("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ jsx3("span", { className: "bf-tl__dot bf-tl__dot--muted", children: dotIcon("thinking") }) }),
            /* @__PURE__ */ jsx3("div", { className: "bf-tl__body", children: /* @__PURE__ */ jsx3("span", { className: "bf-tl__thinking", children: label }) })
          ] }, node.key);
        }
        if (node.kind === "tool") {
          return /* @__PURE__ */ jsxs3("li", { className: "bf-tl__item bf-tl__item--tool", children: [
            /* @__PURE__ */ jsx3("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ jsx3("span", { className: `bf-tl__dot${node.isError ? " bf-tl__dot--error" : ""}`, children: dotIcon("tool", node.isError) }) }),
            /* @__PURE__ */ jsx3("div", { className: "bf-tl__body", children: /* @__PURE__ */ jsx3(ToolStep, { node, labels }) })
          ] }, node.key);
        }
        if (node.kind === "error") {
          return /* @__PURE__ */ jsxs3("li", { className: "bf-tl__item bf-tl__item--error", children: [
            /* @__PURE__ */ jsx3("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ jsx3("span", { className: "bf-tl__dot bf-tl__dot--error", children: dotIcon("error") }) }),
            /* @__PURE__ */ jsxs3("div", { className: "bf-tl__body", children: [
              /* @__PURE__ */ jsx3("div", { className: "bf-tl__role bf-tl__role--error", children: labels.error }),
              /* @__PURE__ */ jsx3("div", { className: "bf-tl__bubble bf-tl__bubble--error", children: node.message })
            ] })
          ] }, node.key);
        }
        return /* @__PURE__ */ jsxs3("li", { className: "bf-tl__item bf-tl__item--assistant bf-tl__item--streaming", children: [
          /* @__PURE__ */ jsx3("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ jsx3("span", { className: "bf-tl__dot bf-tl__dot--pulse", children: dotIcon("assistant") }) }),
          /* @__PURE__ */ jsxs3("div", { className: "bf-tl__body", children: [
            /* @__PURE__ */ jsx3("div", { className: "bf-tl__role", children: assistant }),
            /* @__PURE__ */ jsx3("div", { className: "bf-tl__bubble", children: renderStreaming ? renderStreaming(node.text) : /* @__PURE__ */ jsx3(Markdown, { content: node.text, onInternalLink, labels }) })
          ] })
        ] }, node.key);
      }),
      isRunning && !streamingText.trim() && /* @__PURE__ */ jsxs3("li", { className: "bf-tl__item bf-tl__item--thinking", "aria-live": "polite", children: [
        /* @__PURE__ */ jsx3("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ jsx3("span", { className: "bf-tl__dot bf-tl__dot--pulse", children: dotIcon("thinking") }) }),
        /* @__PURE__ */ jsx3("div", { className: "bf-tl__body", children: /* @__PURE__ */ jsx3("span", { className: "bf-tl__thinking bf-tl__thinking--live", children: labels.thinking }) })
      ] })
    ] })
  ] });
}
var BrainTimeline = React2.memo(BrainTimelineInner);

// src/HealthRing.tsx
import { jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
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
  return /* @__PURE__ */ jsxs4("span", { className: "bf-health-ring", style: { display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 2 }, children: [
    /* @__PURE__ */ jsxs4("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: "img", "aria-label": label, children: [
      /* @__PURE__ */ jsx4(
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
      /* @__PURE__ */ jsx4(
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
      /* @__PURE__ */ jsx4(
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
    caption ? /* @__PURE__ */ jsx4("span", { style: { fontSize: 10, color: "var(--bf-health-caption, var(--bf-text-muted, #6b7280))", lineHeight: 1 }, children: caption }) : null
  ] });
}

// src/chatTickets/ChatTicketsPanel.tsx
import { memo, useCallback, useEffect as useEffect2, useMemo as useMemo3, useState as useState3 } from "react";

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
  linkTypeLabel: "Link type",
  linkTypeLinked: "Linked",
  linkTypeCreated: "Created from chat",
  linkAction: "Link",
  noAgents: "No agents in this chat yet.",
  removeAgent: "Remove",
  inviteAgent: "Invite an agent\u2026",
  agentsHint: "Invited agents can be tagged to execute a linked task or epic.",
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
import { jsx as jsx5, jsxs as jsxs5 } from "react/jsx-runtime";
var RUNNABLE = new Set(RUNNABLE_KINDS);
function ChatTicketsPanelInner({ chatId, projectId, chatList, adapter, labels, onChanged, refreshSignal, visibility, onSetVisibility }) {
  const [tickets, setTickets] = useState3([]);
  const [agents, setAgents] = useState3([]);
  const [members, setMembers] = useState3([]);
  const [pool, setPool] = useState3([]);
  const [options, setOptions] = useState3(null);
  const [panel, setPanel] = useState3(null);
  const [lineageKey, setLineageKey] = useState3(null);
  const [lineage, setLineage] = useState3([]);
  const [runKey, setRunKey] = useState3(null);
  const [msg, setMsg] = useState3(null);
  const [busy, setBusy] = useState3(false);
  const load = useCallback(async () => {
    const [tk, ag, mem] = await Promise.all([
      adapter.listTickets(chatId).catch(() => []),
      adapter.listAgents(chatId).catch(() => []),
      adapter.listMembers(chatId).catch(() => [])
    ]);
    setTickets(tk);
    setAgents(ag);
    setMembers(mem);
  }, [adapter, chatId]);
  useEffect2(() => {
    void load();
  }, [load, refreshSignal]);
  useEffect2(() => {
    adapter.loadAgentPool().then(setPool).catch(() => setPool([]));
  }, [adapter]);
  useEffect2(() => {
    adapter.loadTicketOptions(projectId).then(setOptions).catch(() => setOptions(null));
  }, [adapter, projectId]);
  const flash = (m) => {
    setMsg(m);
    if (typeof window !== "undefined") window.setTimeout(() => setMsg(null), 3500);
  };
  const poolName = useCallback((ref) => pool.find((p) => p.ref === ref)?.name ?? ref, [pool]);
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
  return /* @__PURE__ */ jsxs5("div", { style: S.root, children: [
    /* @__PURE__ */ jsx5("div", { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }, children: tickets.length === 0 ? /* @__PURE__ */ jsx5("span", { style: S.muted, children: labels.none }) : tickets.map((tk) => {
      const key = `${tk.kind}:${tk.ref}`;
      return /* @__PURE__ */ jsxs5("div", { style: S.chip, children: [
        /* @__PURE__ */ jsx5(HealthRing, { percent: tk.progressPct, size: 36, caption: tk.total > 0 ? `${tk.done}/${tk.total}` : void 0, muted: !tk.exists, ariaLabel: labels.ringAria(tk.label, tk.progressPct) }),
        /* @__PURE__ */ jsxs5("div", { style: { display: "flex", flexDirection: "column", minWidth: 0, maxWidth: 160 }, children: [
          /* @__PURE__ */ jsx5("span", { style: S.ticketLabel, title: tk.label, children: tk.label }),
          /* @__PURE__ */ jsxs5("span", { style: S.ticketMeta, children: [
            labels.kind[tk.kind],
            " \xB7 ",
            tk.status,
            tk.linkType === "created" ? ` \xB7 ${labels.spawned}` : ""
          ] })
        ] }),
        /* @__PURE__ */ jsxs5("div", { style: { display: "flex", gap: 2 }, children: [
          RUNNABLE.has(tk.kind) && tk.exists && /* @__PURE__ */ jsx5("button", { type: "button", title: labels.run, onClick: () => setRunKey(runKey === key ? null : key), style: S.icon, children: "\u25B6" }),
          /* @__PURE__ */ jsx5("button", { type: "button", title: labels.lineage, onClick: () => void openLineage(tk), style: S.icon, children: "\u2443" }),
          /* @__PURE__ */ jsx5("button", { type: "button", title: labels.unlink, disabled: busy, onClick: () => void unlink(tk), style: S.icon, children: "\u2715" })
        ] }),
        runKey === key && /* @__PURE__ */ jsxs5("select", { "aria-label": labels.pickAgent, value: "", onChange: (e) => {
          if (e.target.value) void runTicket(tk, e.target.value);
        }, style: S.select, children: [
          /* @__PURE__ */ jsx5("option", { value: "", children: labels.pickAgent }),
          agents.map((a) => /* @__PURE__ */ jsxs5("option", { value: a.agentRef, children: [
            "\u2605 ",
            poolName(a.agentRef)
          ] }, a.id)),
          pool.filter((p) => !agents.some((a) => a.agentRef === p.ref)).map((p) => /* @__PURE__ */ jsx5("option", { value: p.ref, children: p.name }, p.ref))
        ] })
      ] }, tk.linkId);
    }) }),
    lineageKey && /* @__PURE__ */ jsxs5("div", { style: S.drawer, children: [
      /* @__PURE__ */ jsx5("strong", { style: { color: V.text }, children: labels.lineageTitle }),
      lineage.length === 0 ? /* @__PURE__ */ jsx5("span", { style: { marginLeft: 8, ...S.muted }, children: labels.lineageEmpty }) : /* @__PURE__ */ jsx5("ul", { style: { margin: "4px 0 0", paddingLeft: 18 }, children: lineage.map((c) => /* @__PURE__ */ jsxs5("li", { style: { marginBottom: 2 }, children: [
        /* @__PURE__ */ jsx5("span", { style: { fontWeight: c.chatId === chatId ? 700 : 400 }, children: c.title }),
        c.linkType === "created" ? /* @__PURE__ */ jsx5("em", { style: { color: V.accent, marginLeft: 6 }, children: labels.spawned }) : null,
        c.isArchived ? /* @__PURE__ */ jsxs5("span", { style: { marginLeft: 6, ...S.muted }, children: [
          "(",
          labels.merged,
          ")"
        ] }) : null
      ] }, c.chatId)) })
    ] }),
    /* @__PURE__ */ jsxs5("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ jsxs5("button", { type: "button", onClick: () => setPanel(panel === "link" ? null : "link"), style: S.pill(panel === "link"), children: [
        "\uFF0B ",
        labels.link
      ] }),
      /* @__PURE__ */ jsxs5("button", { type: "button", onClick: () => setPanel(panel === "agents" ? null : "agents"), style: S.pill(panel === "agents"), children: [
        "\u{1F465} ",
        labels.agents,
        agents.length ? ` (${agents.length})` : ""
      ] }),
      /* @__PURE__ */ jsxs5("button", { type: "button", onClick: () => setPanel(panel === "people" ? null : "people"), style: S.pill(panel === "people"), children: [
        "\u{1F464} ",
        labels.people,
        members.length ? ` (${members.length})` : ""
      ] }),
      /* @__PURE__ */ jsxs5("button", { type: "button", onClick: () => setPanel(panel === "merge" ? null : "merge"), style: S.pill(panel === "merge"), children: [
        "\u29C9 ",
        labels.merge
      ] }),
      msg && /* @__PURE__ */ jsx5("span", { style: { fontSize: 12, color: V.accent, alignSelf: "center" }, children: msg })
    ] }),
    panel === "link" && /* @__PURE__ */ jsx5(LinkForm, { options, existing: tickets, labels, onLink: async (kind, ref, linkType) => {
      try {
        await adapter.linkTicket(chatId, { kind, ref, linkType });
        await load();
      } catch (e) {
        flash(e instanceof Error ? e.message : labels.linkFailed);
      }
    } }),
    panel === "agents" && /* @__PURE__ */ jsx5(
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
    panel === "people" && /* @__PURE__ */ jsx5(
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
    panel === "merge" && /* @__PURE__ */ jsx5(
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
function LinkForm({ options, existing, labels, onLink }) {
  const [kind, setKind] = useState3("task");
  const [ref, setRef] = useState3("");
  const [linkType, setLinkType] = useState3("linked");
  const [busy, setBusy] = useState3(false);
  const forKind = useMemo3(() => {
    const all = options?.[kind] ?? [];
    return all.filter((o) => !existing.some((e) => e.kind === kind && e.ref === o.ref));
  }, [options, kind, existing]);
  const submit = async () => {
    if (!ref) return;
    setBusy(true);
    try {
      await onLink(kind, ref, linkType);
      setRef("");
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ jsxs5("div", { style: S.section, children: [
    /* @__PURE__ */ jsx5("select", { "aria-label": labels.kindLabel, value: kind, onChange: (e) => {
      setKind(e.target.value);
      setRef("");
    }, style: S.select, children: TICKET_KINDS.map((k) => /* @__PURE__ */ jsx5("option", { value: k, children: labels.kind[k] }, k)) }),
    /* @__PURE__ */ jsxs5("select", { "aria-label": labels.pickTicket, value: ref, onChange: (e) => setRef(e.target.value), style: { ...S.select, minWidth: 200 }, children: [
      /* @__PURE__ */ jsx5("option", { value: "", children: labels.pickTicket }),
      forKind.map((o) => /* @__PURE__ */ jsx5("option", { value: o.ref, children: o.label }, o.ref))
    ] }),
    /* @__PURE__ */ jsxs5("select", { "aria-label": labels.linkTypeLabel, value: linkType, onChange: (e) => setLinkType(e.target.value), style: S.select, children: [
      /* @__PURE__ */ jsx5("option", { value: "linked", children: labels.linkTypeLinked }),
      /* @__PURE__ */ jsx5("option", { value: "created", children: labels.linkTypeCreated })
    ] }),
    /* @__PURE__ */ jsx5("button", { type: "button", onClick: () => void submit(), disabled: busy || !ref, style: S.pill(true), children: busy ? "\u2026" : labels.linkAction })
  ] });
}
function AgentsSection({ agents, pool, labels, onInvite, onRemove, busy }) {
  const poolName = (ref) => pool.find((p) => p.ref === ref)?.name ?? ref;
  const uninvited = pool.filter((p) => !agents.some((a) => a.agentRef === p.ref));
  return /* @__PURE__ */ jsxs5("div", { style: { ...S.section, flexDirection: "column", alignItems: "stretch" }, children: [
    /* @__PURE__ */ jsx5("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, children: agents.length === 0 ? /* @__PURE__ */ jsx5("span", { style: S.muted, children: labels.noAgents }) : agents.map((a) => /* @__PURE__ */ jsxs5("span", { style: S.agentChip, children: [
      /* @__PURE__ */ jsx5("span", { "aria-hidden": true, children: "\u{1F916}" }),
      poolName(a.agentRef),
      /* @__PURE__ */ jsx5("button", { type: "button", title: labels.removeAgent, disabled: busy, onClick: () => void onRemove(a.id), style: { ...S.icon, fontSize: 11 }, children: "\u2715" })
    ] }, a.id)) }),
    /* @__PURE__ */ jsxs5("select", { "aria-label": labels.inviteAgent, value: "", onChange: (e) => {
      const p = pool.find((x) => x.ref === e.target.value);
      if (p) void onInvite(p.ref, p.kind);
    }, style: { ...S.select, maxWidth: 260 }, children: [
      /* @__PURE__ */ jsx5("option", { value: "", children: labels.inviteAgent }),
      uninvited.map((p) => /* @__PURE__ */ jsxs5("option", { value: p.ref, children: [
        p.name,
        " \u2014 ",
        p.meta
      ] }, p.ref))
    ] }),
    /* @__PURE__ */ jsx5("span", { style: { fontSize: 11, ...S.muted }, children: labels.agentsHint })
  ] });
}
function PeopleSection({ members, labels, visibility, onSetVisibility, onInvite, onRemove, busy }) {
  const [email, setEmail] = useState3("");
  const submit = async () => {
    const e = email.trim();
    if (!e) return;
    await onInvite(e);
    setEmail("");
  };
  const locked = visibility === "locked";
  return /* @__PURE__ */ jsxs5("div", { style: { ...S.section, flexDirection: "column", alignItems: "stretch" }, children: [
    visibility && onSetVisibility && /* @__PURE__ */ jsxs5("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ jsx5("button", { type: "button", disabled: busy, onClick: () => void onSetVisibility(locked ? "shared" : "locked"), style: S.pill(locked), children: locked ? `\u{1F512} ${labels.visibilityLocked}` : `\u{1F513} ${labels.visibilityShared}` }),
      /* @__PURE__ */ jsx5("span", { style: { fontSize: 11, ...S.muted }, children: labels.lockHint })
    ] }),
    /* @__PURE__ */ jsx5("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, children: members.length === 0 ? /* @__PURE__ */ jsx5("span", { style: S.muted, children: labels.noPeople }) : members.map((m) => /* @__PURE__ */ jsxs5("span", { style: S.agentChip, children: [
      /* @__PURE__ */ jsx5("span", { "aria-hidden": true, children: m.status === "pending" ? "\u2709\uFE0F" : "\u{1F464}" }),
      m.name,
      /* @__PURE__ */ jsx5("button", { type: "button", title: labels.removePerson, disabled: busy, onClick: () => void onRemove(m.id), style: { ...S.icon, fontSize: 11 }, children: "\u2715" })
    ] }, m.id)) }),
    /* @__PURE__ */ jsxs5("div", { style: { display: "flex", gap: 6 }, children: [
      /* @__PURE__ */ jsx5(
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
      /* @__PURE__ */ jsx5("button", { type: "button", disabled: busy || !email.trim(), onClick: () => void submit(), style: S.pill(false), children: "\uFF0B" })
    ] }),
    /* @__PURE__ */ jsx5("span", { style: { fontSize: 11, ...S.muted }, children: labels.invitePersonHint })
  ] });
}
function MergeSection({ chatId, chatList, labels, onMerge, busy }) {
  const [selected, setSelected] = useState3([]);
  const candidates = chatList.filter((c) => c.id !== chatId);
  const toggle = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  return /* @__PURE__ */ jsxs5("div", { style: { ...S.section, flexDirection: "column", alignItems: "stretch" }, children: [
    /* @__PURE__ */ jsx5("span", { style: { fontSize: 12, color: V.text2 }, children: labels.mergeHint }),
    /* @__PURE__ */ jsx5("div", { style: { maxHeight: 160, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }, children: candidates.length === 0 ? /* @__PURE__ */ jsx5("span", { style: S.muted, children: labels.mergeNoOthers }) : candidates.map((c) => /* @__PURE__ */ jsxs5("label", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "3px 4px", cursor: "pointer" }, children: [
      /* @__PURE__ */ jsx5("input", { type: "checkbox", checked: selected.includes(c.id), onChange: () => toggle(c.id) }),
      /* @__PURE__ */ jsx5("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: c.title })
    ] }, c.id)) }),
    /* @__PURE__ */ jsx5("button", { type: "button", onClick: () => {
      if (selected.length) void onMerge(selected).then(() => setSelected([]));
    }, disabled: busy || selected.length === 0, style: S.pill(true), children: busy ? "\u2026" : labels.mergeAction(selected.length) })
  ] });
}
var ChatTicketsPanel = memo(ChatTicketsPanelInner);
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
import { useEffect as useEffect3, useMemo as useMemo4, useState as useState4 } from "react";
function useChatParticipants(adapter, chatId, refreshSignal = 0) {
  const [pool, setPool] = useState4([]);
  const [invited, setInvited] = useState4([]);
  const [members, setMembers] = useState4([]);
  useEffect3(() => {
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
  useEffect3(() => {
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
  return useMemo4(
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

// src/project360/Project360View.tsx
import { useMemo as useMemo5, useState as useState5 } from "react";

// src/project360/Sunburst.tsx
import { jsx as jsx6, jsxs as jsxs6 } from "react/jsx-runtime";
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
  return /* @__PURE__ */ jsxs6(
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
          return /* @__PURE__ */ jsxs6("g", { children: [
            /* @__PURE__ */ jsx6(
              "path",
              {
                d: sector(R_INNER_0, R_INNER_1, pStart + 0.6, pEnd - 0.6),
                fill: pillar.color,
                fillOpacity: 0.9,
                className: "bf-360-arc bf-360-arc--pillar"
              }
            ),
            /* @__PURE__ */ jsx6(
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
              return /* @__PURE__ */ jsxs6(
                "g",
                {
                  className: "bf-360-arc-group",
                  onClick: () => onSelect?.(isSel ? null : dim.key),
                  role: "button",
                  "aria-pressed": isSel,
                  "aria-label": `${dim.label}: ${dim.score} of 100`,
                  children: [
                    /* @__PURE__ */ jsx6(
                      "path",
                      {
                        d: sector(R_OUTER_0, R_OUTER_1, dStart + 0.6, dEnd - 0.6),
                        fill: dim.color,
                        fillOpacity: isSel ? 1 : 0.82,
                        className: `bf-360-arc bf-360-arc--dim${isSel ? " is-selected" : ""}`
                      }
                    ),
                    /* @__PURE__ */ jsx6(
                      "text",
                      {
                        x: lab.x,
                        y: lab.y,
                        className: "bf-360-arc-label",
                        textAnchor: "middle",
                        dominantBaseline: "central",
                        children: lines.map((ln, li) => /* @__PURE__ */ jsx6("tspan", { x: lab.x, dy: li === 0 ? lines.length > 1 ? "-0.5em" : "0" : "1em", children: ln }, li))
                      }
                    )
                  ]
                },
                dim.key
              );
            })
          ] }, pillar.key);
        }),
        /* @__PURE__ */ jsx6("circle", { cx: CX, cy: CY, r: R_CENTER, className: "bf-360-center", onClick: () => onSelect?.(null), role: "button", "aria-label": "Clear selection" }),
        /* @__PURE__ */ jsx6("circle", { cx: CX, cy: CY, r: R_CENTER, fill: "none", stroke: overall.color, strokeWidth: 3, className: "bf-360-center-ring" }),
        /* @__PURE__ */ jsx6("text", { x: CX, y: CY - 8, className: "bf-360-center-score", textAnchor: "middle", dominantBaseline: "central", fill: overall.color, children: overall.score }),
        /* @__PURE__ */ jsx6("text", { x: CX, y: CY + 14, className: "bf-360-center-label", textAnchor: "middle", dominantBaseline: "central", children: "HEALTH" })
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
import { Fragment as Fragment3, jsx as jsx7, jsxs as jsxs7 } from "react/jsx-runtime";
var STATUS_ORDER = ["working", "awaiting", "blocked", "idle", "available"];
function Project360View({ data, loading, error, labels, onAction, onRefresh }) {
  const L = useMemo5(() => ({ ...DEFAULT_PROJECT360_LABELS, ...labels ?? {} }), [labels]);
  const [selected, setSelected] = useState5(null);
  const sortedWorkforce = useMemo5(
    () => [...data?.workforce ?? []].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)),
    [data?.workforce]
  );
  if (error) {
    return /* @__PURE__ */ jsxs7("div", { className: "bf-360-state", children: [
      /* @__PURE__ */ jsx7("div", { className: "bf-360-state__title", children: L.loadError }),
      /* @__PURE__ */ jsx7("div", { className: "bf-360-state__hint", children: error }),
      onRefresh && /* @__PURE__ */ jsx7("button", { className: "bf-btn", onClick: onRefresh, children: L.refresh })
    ] });
  }
  if (!data || loading) {
    return /* @__PURE__ */ jsxs7("div", { className: "bf-360-state", children: [
      /* @__PURE__ */ jsx7("div", { className: "bf-360-spinner" }),
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
  return /* @__PURE__ */ jsxs7("div", { className: "bf-360", children: [
    /* @__PURE__ */ jsxs7("header", { className: "bf-360-head", children: [
      /* @__PURE__ */ jsxs7("div", { className: "bf-360-head__id", children: [
        /* @__PURE__ */ jsx7("span", { className: "bf-360-head__title", children: project.name }),
        project.key && /* @__PURE__ */ jsx7("span", { className: "bf-360-head__key", children: project.key })
      ] }),
      /* @__PURE__ */ jsx7("div", { className: "bf-360-head__spacer" }),
      /* @__PURE__ */ jsx7("button", { className: "bf-btn", onClick: () => onAction?.({ kind: "board", label: L.openBoard }), children: L.openBoard }),
      gaps.length > 0 && /* @__PURE__ */ jsx7("button", { className: "bf-btn bf-btn--primary", onClick: improveAll, children: L.improveAll }),
      onRefresh && /* @__PURE__ */ jsx7("button", { className: "bf-btn bf-btn--icon", title: L.refresh, "aria-label": L.refresh, onClick: onRefresh, children: "\u27F3" })
    ] }),
    !hasData ? /* @__PURE__ */ jsxs7("div", { className: "bf-360-state", children: [
      /* @__PURE__ */ jsx7("div", { className: "bf-360-state__title", children: L.noData }),
      /* @__PURE__ */ jsx7("div", { className: "bf-360-state__hint", children: L.noDataHint }),
      /* @__PURE__ */ jsx7("button", { className: "bf-btn", onClick: () => onAction?.({ kind: "board", label: L.openBoard }), children: L.openBoard })
    ] }) : /* @__PURE__ */ jsxs7("div", { className: "bf-360-grid", children: [
      /* @__PURE__ */ jsxs7("section", { className: "bf-360-col bf-360-col--wheel", children: [
        /* @__PURE__ */ jsx7(
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
        /* @__PURE__ */ jsxs7("div", { className: "bf-360-overall", children: [
          /* @__PURE__ */ jsx7("div", { className: "bf-360-progress", "aria-label": `${L.progress} ${overall.progressPct}%`, children: /* @__PURE__ */ jsx7("div", { className: "bf-360-progress__fill", style: { width: `${overall.progressPct}%`, background: overall.color } }) }),
          /* @__PURE__ */ jsxs7("div", { className: "bf-360-progress__label", children: [
            L.progress,
            ": ",
            overall.progressPct,
            "%"
          ] }),
          /* @__PURE__ */ jsxs7("div", { className: "bf-360-counts", children: [
            /* @__PURE__ */ jsx7(Count, { n: counts.open, label: L.counts_open }),
            /* @__PURE__ */ jsx7(Count, { n: counts.blocked, label: L.counts_blocked, tone: counts.blocked ? "warn" : void 0 }),
            /* @__PURE__ */ jsx7(Count, { n: counts.overdue, label: L.counts_overdue, tone: counts.overdue ? "bad" : void 0 }),
            /* @__PURE__ */ jsx7(Count, { n: counts.activeRuns, label: L.counts_running, tone: counts.activeRuns ? "good" : void 0 })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxs7("section", { className: "bf-360-col bf-360-col--detail", children: [
        /* @__PURE__ */ jsxs7("div", { className: "bf-360-legend-head", children: [
          /* @__PURE__ */ jsx7("span", { children: selectedDim ? selectedDim.label : L.allDimensions }),
          selectedDim && /* @__PURE__ */ jsxs7("button", { className: "bf-360-clear", onClick: () => setSelected(null), children: [
            L.allDimensions,
            " \u2715"
          ] })
        ] }),
        selectedDim ? /* @__PURE__ */ jsxs7("div", { className: "bf-360-dim-detail", children: [
          /* @__PURE__ */ jsx7(ScoreDot, { score: selectedDim.score, color: selectedDim.color }),
          /* @__PURE__ */ jsx7("div", { className: "bf-360-dim-detail__summary", children: selectedDim.summary })
        ] }) : /* @__PURE__ */ jsx7("ul", { className: "bf-360-dim-list", children: dimensions.map((d) => /* @__PURE__ */ jsx7("li", { children: /* @__PURE__ */ jsxs7(
          "button",
          {
            className: "bf-360-dim-row",
            onClick: () => setSelected(d.key),
            children: [
              /* @__PURE__ */ jsx7(ScoreDot, { score: d.score, color: d.color }),
              /* @__PURE__ */ jsx7("span", { className: "bf-360-dim-row__label", children: d.label }),
              /* @__PURE__ */ jsx7("span", { className: "bf-360-dim-row__summary", children: d.summary })
            ]
          }
        ) }, d.key)) })
      ] })
    ] }),
    hasData && /* @__PURE__ */ jsxs7(Fragment3, { children: [
      /* @__PURE__ */ jsxs7("section", { className: "bf-360-section", children: [
        /* @__PURE__ */ jsxs7("h3", { className: "bf-360-section__title", children: [
          L.missingItems,
          shownGaps.length > 0 && /* @__PURE__ */ jsx7("span", { className: "bf-360-section__count", children: shownGaps.length })
        ] }),
        shownGaps.length === 0 ? /* @__PURE__ */ jsx7("p", { className: "bf-360-empty", children: L.noGaps }) : /* @__PURE__ */ jsx7("ul", { className: "bf-360-gaps", children: shownGaps.map((g) => /* @__PURE__ */ jsx7(GapRow, { gap: g, onAction }, g.id)) })
      ] }),
      /* @__PURE__ */ jsxs7("section", { className: "bf-360-section", children: [
        /* @__PURE__ */ jsxs7("h3", { className: "bf-360-section__title", children: [
          L.workforce,
          workforce.length > 0 && /* @__PURE__ */ jsx7("span", { className: "bf-360-section__count", children: workforce.length })
        ] }),
        workforce.length === 0 ? /* @__PURE__ */ jsx7("p", { className: "bf-360-empty", children: L.noWorkforce }) : /* @__PURE__ */ jsx7("ul", { className: "bf-360-people", children: sortedWorkforce.map((m) => /* @__PURE__ */ jsx7(MemberRow, { member: m, labels: L, onAction }, m.ref)) })
      ] })
    ] })
  ] });
}
function Count({ n, label, tone }) {
  return /* @__PURE__ */ jsxs7("span", { className: `bf-360-count${tone ? ` bf-360-count--${tone}` : ""}`, children: [
    /* @__PURE__ */ jsx7("b", { children: n }),
    " ",
    label
  ] });
}
function ScoreDot({ score, color }) {
  return /* @__PURE__ */ jsx7("span", { className: "bf-360-scoredot", style: { borderColor: color, color }, children: score });
}
function GapRow({ gap, onAction }) {
  return /* @__PURE__ */ jsxs7("li", { className: `bf-360-gap bf-360-gap--${gap.severity}`, children: [
    /* @__PURE__ */ jsx7("span", { className: `bf-360-sev bf-360-sev--${gap.severity}`, "aria-hidden": true }),
    /* @__PURE__ */ jsxs7("div", { className: "bf-360-gap__body", children: [
      /* @__PURE__ */ jsx7("div", { className: "bf-360-gap__title", children: gap.title }),
      gap.detail && /* @__PURE__ */ jsx7("div", { className: "bf-360-gap__detail", children: gap.detail })
    ] }),
    gap.action && /* @__PURE__ */ jsx7("button", { className: "bf-btn bf-360-gap__cta", onClick: () => onAction?.(gap.action), children: gap.action.label })
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
  const task = member.taskId != null ? { id: member.taskId, key: member.taskKey, title: member.taskTitle ?? "" } : void 0;
  return /* @__PURE__ */ jsxs7("li", { className: "bf-360-person", children: [
    /* @__PURE__ */ jsx7("span", { className: `bf-360-dot bf-360-dot--${member.status}`, title: statusLabel, "aria-label": statusLabel }),
    /* @__PURE__ */ jsxs7("div", { className: "bf-360-person__body", children: [
      /* @__PURE__ */ jsxs7("div", { className: "bf-360-person__top", children: [
        /* @__PURE__ */ jsx7("span", { className: "bf-360-person__name", children: member.name }),
        /* @__PURE__ */ jsx7("span", { className: `bf-360-kind bf-360-kind--${member.kind}`, children: member.kind }),
        /* @__PURE__ */ jsx7("span", { className: "bf-360-person__status", children: statusLabel })
      ] }),
      /* @__PURE__ */ jsx7("div", { className: "bf-360-person__reason", children: member.reason })
    ] }),
    task && /* @__PURE__ */ jsxs7("div", { className: "bf-360-person__actions", children: [
      (member.status === "idle" || member.status === "available") && member.kind !== "human" && /* @__PURE__ */ jsx7("button", { className: "bf-btn bf-360-person__btn", onClick: () => onAction?.({ kind: "run-task", label: labels.member_run, task }), children: labels.member_run }),
      /* @__PURE__ */ jsx7("button", { className: "bf-btn bf-360-person__btn", onClick: () => onAction?.({ kind: "open-task", label: labels.member_open, task }), children: labels.member_open })
    ] })
  ] });
}

// src/projectList/ProjectListView.tsx
import { useMemo as useMemo6 } from "react";

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
import { jsx as jsx8, jsxs as jsxs8 } from "react/jsx-runtime";
function ProjectListView({ title, subtitle, data, loading, error, labels, onAction, onRefresh }) {
  const L = useMemo6(() => ({ ...DEFAULT_PROJECT_LIST_LABELS, ...labels ?? {} }), [labels]);
  const header = /* @__PURE__ */ jsxs8("header", { className: "bf-list-head", children: [
    /* @__PURE__ */ jsxs8("div", { className: "bf-list-head__id", children: [
      /* @__PURE__ */ jsx8("span", { className: "bf-list-head__title", children: title }),
      data && /* @__PURE__ */ jsxs8("span", { className: "bf-list-head__count", children: [
        data.total,
        " ",
        L.items
      ] })
    ] }),
    subtitle && /* @__PURE__ */ jsx8("div", { className: "bf-list-head__sub", children: subtitle }),
    /* @__PURE__ */ jsx8("div", { className: "bf-list-head__spacer" }),
    onRefresh && /* @__PURE__ */ jsx8("button", { className: "bf-btn bf-btn--icon", title: L.refresh, "aria-label": L.refresh, onClick: onRefresh, children: "\u27F3" })
  ] });
  if (error) {
    return /* @__PURE__ */ jsxs8("div", { className: "bf-list", children: [
      header,
      /* @__PURE__ */ jsxs8("div", { className: "bf-360-state", children: [
        /* @__PURE__ */ jsx8("div", { className: "bf-360-state__title", children: L.loadError }),
        /* @__PURE__ */ jsx8("div", { className: "bf-360-state__hint", children: error }),
        onRefresh && /* @__PURE__ */ jsx8("button", { className: "bf-btn", onClick: onRefresh, children: L.refresh })
      ] })
    ] });
  }
  if (!data || loading) {
    return /* @__PURE__ */ jsxs8("div", { className: "bf-list", children: [
      header,
      /* @__PURE__ */ jsxs8("div", { className: "bf-360-state", children: [
        /* @__PURE__ */ jsx8("div", { className: "bf-360-spinner" }),
        L.connecting
      ] })
    ] });
  }
  if (data.total === 0) {
    return /* @__PURE__ */ jsxs8("div", { className: "bf-list", children: [
      header,
      /* @__PURE__ */ jsxs8("div", { className: "bf-360-state", children: [
        /* @__PURE__ */ jsx8("div", { className: "bf-360-state__title", children: L.empty }),
        L.emptyHint && /* @__PURE__ */ jsx8("div", { className: "bf-360-state__hint", children: L.emptyHint })
      ] })
    ] });
  }
  return /* @__PURE__ */ jsxs8("div", { className: "bf-list", children: [
    header,
    data.groups.filter((g) => g.items.length > 0).map((g) => /* @__PURE__ */ jsxs8("section", { className: "bf-list-group", children: [
      /* @__PURE__ */ jsxs8("h3", { className: "bf-list-group__title", children: [
        /* @__PURE__ */ jsx8("span", { className: `bf-list-group__dot bf-list-tone--${g.tone ?? "default"}`, "aria-hidden": true }),
        g.label,
        /* @__PURE__ */ jsx8("span", { className: "bf-360-section__count", children: g.items.length })
      ] }),
      /* @__PURE__ */ jsx8("ul", { className: "bf-list-rows", children: g.items.map((it) => /* @__PURE__ */ jsx8(Row, { item: it, onAction }, it.id)) })
    ] }, g.key))
  ] });
}
function Row({ item, onAction }) {
  const act = item.action;
  const clickable = !!act && !!onAction;
  return /* @__PURE__ */ jsx8("li", { className: "bf-list-row", children: /* @__PURE__ */ jsxs8(
    "button",
    {
      className: "bf-list-row__main",
      disabled: !clickable,
      onClick: clickable ? () => onAction(act) : void 0,
      title: clickable ? act.label : void 0,
      children: [
        item.key && /* @__PURE__ */ jsx8("span", { className: "bf-list-row__key", children: item.key }),
        /* @__PURE__ */ jsxs8("span", { className: "bf-list-row__body", children: [
          /* @__PURE__ */ jsx8("span", { className: "bf-list-row__title", children: item.title }),
          item.subtitle && /* @__PURE__ */ jsx8("span", { className: "bf-list-row__sub", children: item.subtitle })
        ] }),
        item.badges && item.badges.length > 0 && /* @__PURE__ */ jsx8("span", { className: "bf-list-row__badges", children: item.badges.map((b, i) => /* @__PURE__ */ jsx8("span", { className: `bf-list-badge bf-list-tone--${b.tone ?? "default"}`, children: b.label }, i)) })
      ]
    }
  ) });
}
export {
  Avatar,
  BrainTimeline,
  ChatTicketsPanel,
  DEFAULT_CHAT_TICKETS_LABELS,
  DEFAULT_PROJECT360_LABELS,
  DEFAULT_PROJECT_LIST_LABELS,
  DEFAULT_TIMELINE_LABELS,
  HealthRing,
  Markdown,
  ParticipantBadge,
  Project360View,
  ProjectListView,
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
  streamingNode,
  useChatParticipants
};
//# sourceMappingURL=index.mjs.map