// src/BrainTimeline.tsx
import { useEffect, useMemo, useRef } from "react";

// src/Markdown.tsx
import { useState } from "react";
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
function Markdown({ content, onInternalLink, onApplyCode, onCreateFile, labels }) {
  const lab = { ...DEFAULT_LABELS, ...labels };
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
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
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
  return /* @__PURE__ */ jsxs2("details", { className: `bf-tl__tool${node.isError ? " bf-tl__tool--error" : ""}`, children: [
    /* @__PURE__ */ jsxs2("summary", { className: "bf-tl__tool-head", children: [
      /* @__PURE__ */ jsx2("span", { className: "bf-tl__tool-status", "aria-hidden": true, children: node.isError ? "\u2717" : "\u2713" }),
      /* @__PURE__ */ jsx2("span", { className: "bf-tl__tool-name", children: node.label }),
      node.durationMs != null && /* @__PURE__ */ jsx2("span", { className: "bf-tl__tool-dur", children: formatDuration(node.durationMs) }),
      /* @__PURE__ */ jsx2("span", { className: "bf-tl__tool-caret", "aria-hidden": true, children: "\u25B8" })
    ] }),
    /* @__PURE__ */ jsxs2("div", { className: "bf-tl__tool-body", children: [
      argsText && /* @__PURE__ */ jsxs2("div", { className: "bf-tl__io", children: [
        /* @__PURE__ */ jsx2("div", { className: "bf-tl__io-label", children: labels.input }),
        /* @__PURE__ */ jsx2("pre", { className: "bf-tl__io-pre", children: /* @__PURE__ */ jsx2("code", { children: argsText }) })
      ] }),
      resultText && /* @__PURE__ */ jsxs2("div", { className: "bf-tl__io", children: [
        /* @__PURE__ */ jsx2("div", { className: "bf-tl__io-label", children: labels.output }),
        /* @__PURE__ */ jsx2("pre", { className: "bf-tl__io-pre", children: /* @__PURE__ */ jsx2("code", { children: resultText }) })
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
  const nodes = useMemo(
    () => buildTimeline({ messages, trace, streamingText, isRunning }),
    [messages, trace, streamingText, isRunning]
  );
  const scrollRef = useRef(null);
  const pinnedRef = useRef(true);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  useEffect(() => {
    if (!autoScroll || !pinnedRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [nodes, autoScroll]);
  const renderMsg = (msg, role, text) => renderMessage ? renderMessage(msg, { role, text }) : /* @__PURE__ */ jsx2(
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
  return /* @__PURE__ */ jsxs2("div", { className: "bf-tl-scroll", ref: scrollRef, onScroll, children: [
    loading && /* @__PURE__ */ jsx2("div", { className: "bf-tl-status", children: labels.loading }),
    isEmpty && (emptyState ?? /* @__PURE__ */ jsx2("div", { className: "bf-tl-empty", children: labels.empty })),
    /* @__PURE__ */ jsxs2("ol", { className: "bf-tl", children: [
      nodes.map((node) => {
        if (node.kind === "user") {
          return /* @__PURE__ */ jsxs2("li", { className: "bf-tl__item bf-tl__item--user", children: [
            /* @__PURE__ */ jsx2("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ jsx2("span", { className: "bf-tl__dot", children: dotIcon("user") }) }),
            /* @__PURE__ */ jsxs2("div", { className: "bf-tl__body", children: [
              /* @__PURE__ */ jsx2("div", { className: "bf-tl__role", children: labels.you }),
              node.images.length > 0 && /* @__PURE__ */ jsx2("div", { className: "bf-tl__images", children: node.images.map((im, i) => /* @__PURE__ */ jsx2("img", { src: im.url, alt: im.name ?? "", className: "bf-tl__image" }, i)) }),
              node.text && /* @__PURE__ */ jsx2("div", { className: "bf-tl__bubble bf-tl__bubble--user", children: renderMsg(node.message, "user", node.text) })
            ] })
          ] }, node.key);
        }
        if (node.kind === "assistant") {
          return /* @__PURE__ */ jsxs2("li", { className: "bf-tl__item bf-tl__item--assistant", children: [
            /* @__PURE__ */ jsx2("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ jsx2("span", { className: "bf-tl__dot", children: dotIcon("assistant") }) }),
            /* @__PURE__ */ jsxs2("div", { className: "bf-tl__body", children: [
              /* @__PURE__ */ jsx2("div", { className: "bf-tl__role", children: assistant }),
              /* @__PURE__ */ jsx2("div", { className: "bf-tl__bubble", children: renderMsg(node.message, "assistant", node.text) }),
              renderAssistantActions && /* @__PURE__ */ jsx2("div", { className: "bf-tl__actions", children: renderAssistantActions(node.message) })
            ] })
          ] }, node.key);
        }
        if (node.kind === "thinking") {
          const label = labels.thoughtFor.replace("{duration}", formatDuration(node.durationMs));
          return /* @__PURE__ */ jsxs2("li", { className: "bf-tl__item bf-tl__item--thinking", children: [
            /* @__PURE__ */ jsx2("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ jsx2("span", { className: "bf-tl__dot bf-tl__dot--muted", children: dotIcon("thinking") }) }),
            /* @__PURE__ */ jsx2("div", { className: "bf-tl__body", children: /* @__PURE__ */ jsx2("span", { className: "bf-tl__thinking", children: label }) })
          ] }, node.key);
        }
        if (node.kind === "tool") {
          return /* @__PURE__ */ jsxs2("li", { className: "bf-tl__item bf-tl__item--tool", children: [
            /* @__PURE__ */ jsx2("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ jsx2("span", { className: `bf-tl__dot${node.isError ? " bf-tl__dot--error" : ""}`, children: dotIcon("tool", node.isError) }) }),
            /* @__PURE__ */ jsx2("div", { className: "bf-tl__body", children: /* @__PURE__ */ jsx2(ToolStep, { node, labels }) })
          ] }, node.key);
        }
        if (node.kind === "error") {
          return /* @__PURE__ */ jsxs2("li", { className: "bf-tl__item bf-tl__item--error", children: [
            /* @__PURE__ */ jsx2("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ jsx2("span", { className: "bf-tl__dot bf-tl__dot--error", children: dotIcon("error") }) }),
            /* @__PURE__ */ jsxs2("div", { className: "bf-tl__body", children: [
              /* @__PURE__ */ jsx2("div", { className: "bf-tl__role bf-tl__role--error", children: labels.error }),
              /* @__PURE__ */ jsx2("div", { className: "bf-tl__bubble bf-tl__bubble--error", children: node.message })
            ] })
          ] }, node.key);
        }
        return /* @__PURE__ */ jsxs2("li", { className: "bf-tl__item bf-tl__item--assistant bf-tl__item--streaming", children: [
          /* @__PURE__ */ jsx2("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ jsx2("span", { className: "bf-tl__dot bf-tl__dot--pulse", children: dotIcon("assistant") }) }),
          /* @__PURE__ */ jsxs2("div", { className: "bf-tl__body", children: [
            /* @__PURE__ */ jsx2("div", { className: "bf-tl__role", children: assistant }),
            /* @__PURE__ */ jsx2("div", { className: "bf-tl__bubble", children: renderStreaming ? renderStreaming(node.text) : /* @__PURE__ */ jsx2(Markdown, { content: node.text, onInternalLink, labels }) })
          ] })
        ] }, node.key);
      }),
      isRunning && !streamingText.trim() && /* @__PURE__ */ jsxs2("li", { className: "bf-tl__item bf-tl__item--thinking", "aria-live": "polite", children: [
        /* @__PURE__ */ jsx2("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ jsx2("span", { className: "bf-tl__dot bf-tl__dot--pulse", children: dotIcon("thinking") }) }),
        /* @__PURE__ */ jsx2("div", { className: "bf-tl__body", children: /* @__PURE__ */ jsx2("span", { className: "bf-tl__thinking bf-tl__thinking--live", children: labels.thinking }) })
      ] })
    ] })
  ] });
}

// src/project360/Project360View.tsx
import { useMemo as useMemo2, useState as useState2 } from "react";

// src/project360/Sunburst.tsx
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
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
  return /* @__PURE__ */ jsxs3(
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
          return /* @__PURE__ */ jsxs3("g", { children: [
            /* @__PURE__ */ jsx3(
              "path",
              {
                d: sector(R_INNER_0, R_INNER_1, pStart + 0.6, pEnd - 0.6),
                fill: pillar.color,
                fillOpacity: 0.9,
                className: "bf-360-arc bf-360-arc--pillar"
              }
            ),
            /* @__PURE__ */ jsx3(
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
              return /* @__PURE__ */ jsxs3(
                "g",
                {
                  className: "bf-360-arc-group",
                  onClick: () => onSelect?.(isSel ? null : dim.key),
                  role: "button",
                  "aria-pressed": isSel,
                  "aria-label": `${dim.label}: ${dim.score} of 100`,
                  children: [
                    /* @__PURE__ */ jsx3(
                      "path",
                      {
                        d: sector(R_OUTER_0, R_OUTER_1, dStart + 0.6, dEnd - 0.6),
                        fill: dim.color,
                        fillOpacity: isSel ? 1 : 0.82,
                        className: `bf-360-arc bf-360-arc--dim${isSel ? " is-selected" : ""}`
                      }
                    ),
                    /* @__PURE__ */ jsx3(
                      "text",
                      {
                        x: lab.x,
                        y: lab.y,
                        className: "bf-360-arc-label",
                        textAnchor: "middle",
                        dominantBaseline: "central",
                        children: lines.map((ln, li) => /* @__PURE__ */ jsx3("tspan", { x: lab.x, dy: li === 0 ? lines.length > 1 ? "-0.5em" : "0" : "1em", children: ln }, li))
                      }
                    )
                  ]
                },
                dim.key
              );
            })
          ] }, pillar.key);
        }),
        /* @__PURE__ */ jsx3("circle", { cx: CX, cy: CY, r: R_CENTER, className: "bf-360-center", onClick: () => onSelect?.(null), role: "button", "aria-label": "Clear selection" }),
        /* @__PURE__ */ jsx3("circle", { cx: CX, cy: CY, r: R_CENTER, fill: "none", stroke: overall.color, strokeWidth: 3, className: "bf-360-center-ring" }),
        /* @__PURE__ */ jsx3("text", { x: CX, y: CY - 8, className: "bf-360-center-score", textAnchor: "middle", dominantBaseline: "central", fill: overall.color, children: overall.score }),
        /* @__PURE__ */ jsx3("text", { x: CX, y: CY + 14, className: "bf-360-center-label", textAnchor: "middle", dominantBaseline: "central", children: "HEALTH" })
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
import { Fragment as Fragment2, jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
var STATUS_ORDER = ["working", "awaiting", "blocked", "idle", "available"];
function Project360View({ data, loading, error, labels, onAction, onRefresh }) {
  const L = useMemo2(() => ({ ...DEFAULT_PROJECT360_LABELS, ...labels ?? {} }), [labels]);
  const [selected, setSelected] = useState2(null);
  if (error) {
    return /* @__PURE__ */ jsxs4("div", { className: "bf-360-state", children: [
      /* @__PURE__ */ jsx4("div", { className: "bf-360-state__title", children: L.loadError }),
      /* @__PURE__ */ jsx4("div", { className: "bf-360-state__hint", children: error }),
      onRefresh && /* @__PURE__ */ jsx4("button", { className: "bf-btn", onClick: onRefresh, children: L.refresh })
    ] });
  }
  if (!data || loading) {
    return /* @__PURE__ */ jsxs4("div", { className: "bf-360-state", children: [
      /* @__PURE__ */ jsx4("div", { className: "bf-360-spinner" }),
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
  return /* @__PURE__ */ jsxs4("div", { className: "bf-360", children: [
    /* @__PURE__ */ jsxs4("header", { className: "bf-360-head", children: [
      /* @__PURE__ */ jsxs4("div", { className: "bf-360-head__id", children: [
        /* @__PURE__ */ jsx4("span", { className: "bf-360-head__title", children: project.name }),
        project.key && /* @__PURE__ */ jsx4("span", { className: "bf-360-head__key", children: project.key })
      ] }),
      /* @__PURE__ */ jsx4("div", { className: "bf-360-head__spacer" }),
      /* @__PURE__ */ jsx4("button", { className: "bf-btn", onClick: () => onAction?.({ kind: "board", label: L.openBoard }), children: L.openBoard }),
      gaps.length > 0 && /* @__PURE__ */ jsx4("button", { className: "bf-btn bf-btn--primary", onClick: improveAll, children: L.improveAll }),
      onRefresh && /* @__PURE__ */ jsx4("button", { className: "bf-btn bf-btn--icon", title: L.refresh, "aria-label": L.refresh, onClick: onRefresh, children: "\u27F3" })
    ] }),
    !hasData ? /* @__PURE__ */ jsxs4("div", { className: "bf-360-state", children: [
      /* @__PURE__ */ jsx4("div", { className: "bf-360-state__title", children: L.noData }),
      /* @__PURE__ */ jsx4("div", { className: "bf-360-state__hint", children: L.noDataHint }),
      /* @__PURE__ */ jsx4("button", { className: "bf-btn", onClick: () => onAction?.({ kind: "board", label: L.openBoard }), children: L.openBoard })
    ] }) : /* @__PURE__ */ jsxs4("div", { className: "bf-360-grid", children: [
      /* @__PURE__ */ jsxs4("section", { className: "bf-360-col bf-360-col--wheel", children: [
        /* @__PURE__ */ jsx4(
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
        /* @__PURE__ */ jsxs4("div", { className: "bf-360-overall", children: [
          /* @__PURE__ */ jsx4("div", { className: "bf-360-progress", "aria-label": `${L.progress} ${overall.progressPct}%`, children: /* @__PURE__ */ jsx4("div", { className: "bf-360-progress__fill", style: { width: `${overall.progressPct}%`, background: overall.color } }) }),
          /* @__PURE__ */ jsxs4("div", { className: "bf-360-progress__label", children: [
            L.progress,
            ": ",
            overall.progressPct,
            "%"
          ] }),
          /* @__PURE__ */ jsxs4("div", { className: "bf-360-counts", children: [
            /* @__PURE__ */ jsx4(Count, { n: counts.open, label: L.counts_open }),
            /* @__PURE__ */ jsx4(Count, { n: counts.blocked, label: L.counts_blocked, tone: counts.blocked ? "warn" : void 0 }),
            /* @__PURE__ */ jsx4(Count, { n: counts.overdue, label: L.counts_overdue, tone: counts.overdue ? "bad" : void 0 }),
            /* @__PURE__ */ jsx4(Count, { n: counts.activeRuns, label: L.counts_running, tone: counts.activeRuns ? "good" : void 0 })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxs4("section", { className: "bf-360-col bf-360-col--detail", children: [
        /* @__PURE__ */ jsxs4("div", { className: "bf-360-legend-head", children: [
          /* @__PURE__ */ jsx4("span", { children: selectedDim ? selectedDim.label : L.allDimensions }),
          selectedDim && /* @__PURE__ */ jsxs4("button", { className: "bf-360-clear", onClick: () => setSelected(null), children: [
            L.allDimensions,
            " \u2715"
          ] })
        ] }),
        selectedDim ? /* @__PURE__ */ jsxs4("div", { className: "bf-360-dim-detail", children: [
          /* @__PURE__ */ jsx4(ScoreDot, { score: selectedDim.score, color: selectedDim.color }),
          /* @__PURE__ */ jsx4("div", { className: "bf-360-dim-detail__summary", children: selectedDim.summary })
        ] }) : /* @__PURE__ */ jsx4("ul", { className: "bf-360-dim-list", children: dimensions.map((d) => /* @__PURE__ */ jsx4("li", { children: /* @__PURE__ */ jsxs4(
          "button",
          {
            className: "bf-360-dim-row",
            onClick: () => setSelected(d.key),
            children: [
              /* @__PURE__ */ jsx4(ScoreDot, { score: d.score, color: d.color }),
              /* @__PURE__ */ jsx4("span", { className: "bf-360-dim-row__label", children: d.label }),
              /* @__PURE__ */ jsx4("span", { className: "bf-360-dim-row__summary", children: d.summary })
            ]
          }
        ) }, d.key)) })
      ] })
    ] }),
    hasData && /* @__PURE__ */ jsxs4(Fragment2, { children: [
      /* @__PURE__ */ jsxs4("section", { className: "bf-360-section", children: [
        /* @__PURE__ */ jsxs4("h3", { className: "bf-360-section__title", children: [
          L.missingItems,
          shownGaps.length > 0 && /* @__PURE__ */ jsx4("span", { className: "bf-360-section__count", children: shownGaps.length })
        ] }),
        shownGaps.length === 0 ? /* @__PURE__ */ jsx4("p", { className: "bf-360-empty", children: L.noGaps }) : /* @__PURE__ */ jsx4("ul", { className: "bf-360-gaps", children: shownGaps.map((g) => /* @__PURE__ */ jsx4(GapRow, { gap: g, onAction }, g.id)) })
      ] }),
      /* @__PURE__ */ jsxs4("section", { className: "bf-360-section", children: [
        /* @__PURE__ */ jsxs4("h3", { className: "bf-360-section__title", children: [
          L.workforce,
          workforce.length > 0 && /* @__PURE__ */ jsx4("span", { className: "bf-360-section__count", children: workforce.length })
        ] }),
        workforce.length === 0 ? /* @__PURE__ */ jsx4("p", { className: "bf-360-empty", children: L.noWorkforce }) : /* @__PURE__ */ jsx4("ul", { className: "bf-360-people", children: [...workforce].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)).map((m) => /* @__PURE__ */ jsx4(MemberRow, { member: m, labels: L, onAction }, m.ref)) })
      ] })
    ] })
  ] });
}
function Count({ n, label, tone }) {
  return /* @__PURE__ */ jsxs4("span", { className: `bf-360-count${tone ? ` bf-360-count--${tone}` : ""}`, children: [
    /* @__PURE__ */ jsx4("b", { children: n }),
    " ",
    label
  ] });
}
function ScoreDot({ score, color }) {
  return /* @__PURE__ */ jsx4("span", { className: "bf-360-scoredot", style: { borderColor: color, color }, children: score });
}
function GapRow({ gap, onAction }) {
  return /* @__PURE__ */ jsxs4("li", { className: `bf-360-gap bf-360-gap--${gap.severity}`, children: [
    /* @__PURE__ */ jsx4("span", { className: `bf-360-sev bf-360-sev--${gap.severity}`, "aria-hidden": true }),
    /* @__PURE__ */ jsxs4("div", { className: "bf-360-gap__body", children: [
      /* @__PURE__ */ jsx4("div", { className: "bf-360-gap__title", children: gap.title }),
      gap.detail && /* @__PURE__ */ jsx4("div", { className: "bf-360-gap__detail", children: gap.detail })
    ] }),
    gap.action && /* @__PURE__ */ jsx4("button", { className: "bf-btn bf-360-gap__cta", onClick: () => onAction?.(gap.action), children: gap.action.label })
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
  return /* @__PURE__ */ jsxs4("li", { className: "bf-360-person", children: [
    /* @__PURE__ */ jsx4("span", { className: `bf-360-dot bf-360-dot--${member.status}`, title: statusLabel, "aria-label": statusLabel }),
    /* @__PURE__ */ jsxs4("div", { className: "bf-360-person__body", children: [
      /* @__PURE__ */ jsxs4("div", { className: "bf-360-person__top", children: [
        /* @__PURE__ */ jsx4("span", { className: "bf-360-person__name", children: member.name }),
        /* @__PURE__ */ jsx4("span", { className: `bf-360-kind bf-360-kind--${member.kind}`, children: member.kind }),
        /* @__PURE__ */ jsx4("span", { className: "bf-360-person__status", children: statusLabel })
      ] }),
      /* @__PURE__ */ jsx4("div", { className: "bf-360-person__reason", children: member.reason })
    ] }),
    task && /* @__PURE__ */ jsxs4("div", { className: "bf-360-person__actions", children: [
      (member.status === "idle" || member.status === "available") && member.kind !== "human" && /* @__PURE__ */ jsx4("button", { className: "bf-btn bf-360-person__btn", onClick: () => onAction?.({ kind: "run-task", label: labels.member_run, task }), children: labels.member_run }),
      /* @__PURE__ */ jsx4("button", { className: "bf-btn bf-360-person__btn", onClick: () => onAction?.({ kind: "open-task", label: labels.member_open, task }), children: labels.member_open })
    ] })
  ] });
}
export {
  BrainTimeline,
  DEFAULT_PROJECT360_LABELS,
  DEFAULT_TIMELINE_LABELS,
  Markdown,
  Project360View,
  Sunburst,
  attachmentsOf,
  buildTimeline,
  formatDuration,
  formatPayload
};
//# sourceMappingURL=index.mjs.map