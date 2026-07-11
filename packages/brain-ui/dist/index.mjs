// src/BrainTimeline.tsx
import React2, { useEffect, useMemo as useMemo3, useRef, useState as useState3 } from "react";
import { parseDirectedRecipient, parseMessageAuthor, parseMessageProvenance } from "@seanhogg/builderforce-brain-embedded";

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

// src/askUser.tsx
import { useMemo as useMemo2, useState as useState2 } from "react";
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
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
  const lab = useMemo2(() => ({ ...DEFAULT_ASK_USER_LABELS, ...labels }), [labels]);
  const [answered, setAnswered] = useState2(null);
  const [checked, setChecked] = useState2(() => /* @__PURE__ */ new Set());
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
  return /* @__PURE__ */ jsxs3("div", { className: `bf-qcard${answered ? " bf-qcard--done" : ""}`, role: "group", "aria-label": payload.question, children: [
    /* @__PURE__ */ jsx3("div", { className: "bf-qcard__q", children: payload.question }),
    /* @__PURE__ */ jsx3("div", { className: "bf-qcard__opts", children: payload.options.map(
      (opt, i) => multi ? /* @__PURE__ */ jsxs3("label", { className: `bf-qcard__opt bf-qcard__opt--check${checked.has(i) ? " is-checked" : ""}`, children: [
        /* @__PURE__ */ jsx3(
          "input",
          {
            type: "checkbox",
            className: "bf-qcard__cb",
            checked: checked.has(i),
            disabled: !!answered,
            onChange: () => toggle(i)
          }
        ),
        /* @__PURE__ */ jsxs3("span", { className: "bf-qcard__opt-body", children: [
          /* @__PURE__ */ jsx3("span", { className: "bf-qcard__opt-label", children: opt.label }),
          opt.description && /* @__PURE__ */ jsx3("span", { className: "bf-qcard__opt-desc", children: opt.description })
        ] })
      ] }, i) : /* @__PURE__ */ jsxs3(
        "button",
        {
          type: "button",
          className: "bf-qcard__opt bf-qcard__opt--btn",
          disabled: !!answered,
          onClick: () => commit(opt.label),
          children: [
            /* @__PURE__ */ jsx3("span", { className: "bf-qcard__opt-label", children: opt.label }),
            opt.description && /* @__PURE__ */ jsx3("span", { className: "bf-qcard__opt-desc", children: opt.description })
          ]
        },
        i
      )
    ) }),
    multi && !answered && /* @__PURE__ */ jsx3("button", { type: "button", className: "bf-qcard__submit", disabled: checked.size === 0, onClick: submitMulti, children: lab.askSubmit }),
    answered && /* @__PURE__ */ jsx3("div", { className: "bf-qcard__answered", children: `${lab.askAnswered}: ${answered}` })
  ] });
}

// src/timelineModel.ts
import { isStepMessage } from "@seanhogg/builderforce-brain-embedded";
var ORDER = {
  user: 0,
  recall: 1,
  thinking: 2,
  assistant: 3,
  tool: 4,
  learn: 5,
  reconcile: 6,
  error: 7,
  streaming: 8
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
function stepSig(category, label, tsIso) {
  return `${category}|${label}|${tsIso ?? ""}`;
}
function stepNode(step, ts, key) {
  switch (step.category) {
    case "tool":
      return { key, kind: "tool", ts, order: ORDER.tool, label: step.label, args: step.args, result: step.result, isError: !!step.isError, durationMs: step.durationMs };
    case "error":
      return { key, kind: "error", ts, order: ORDER.error, label: step.label, message: typeof step.result === "string" ? step.result : JSON.stringify(step.result ?? "") };
    case "recall": {
      const r = step.result ?? {};
      return { key, kind: "recall", ts, order: ORDER.recall, version: typeof r.version === "number" ? r.version : 0, count: typeof r.count === "number" ? r.count : Array.isArray(r.items) ? r.items.length : 0, items: Array.isArray(r.items) ? r.items : [] };
    }
    case "learn": {
      const r = step.result ?? {};
      return { key, kind: "learn", ts, order: ORDER.learn, version: typeof r.version === "number" ? r.version : 0 };
    }
    case "reconcile": {
      const r = step.result ?? {};
      return { key, kind: "reconcile", ts, order: ORDER.reconcile, version: typeof r.version === "number" ? r.version : 0, count: typeof r.count === "number" ? r.count : 0 };
    }
    default:
      return null;
  }
}
function parseStepMessage(metadata) {
  if (!metadata) return null;
  try {
    const m = JSON.parse(metadata);
    if (m.kind !== "step" || typeof m.category !== "string") return null;
    return {
      step: { category: m.category, label: typeof m.label === "string" ? m.label : m.category, args: m.args, result: m.result, isError: m.isError, durationMs: m.durationMs },
      tsIso: typeof m.ts === "string" ? m.ts : void 0
    };
  } catch {
    return null;
  }
}
function buildSettledTimeline(messages, trace) {
  const nodes = [];
  const traceStepSigs = /* @__PURE__ */ new Set();
  for (const ev of trace) {
    if (ev.category !== "llm" && ev.category !== "message") traceStepSigs.add(stepSig(ev.category, ev.label, ev.ts));
  }
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
    } else if (isStepMessage(message)) {
      const parsed = parseStepMessage(message.metadata);
      if (!parsed) return;
      if (traceStepSigs.has(stepSig(parsed.step.category, parsed.step.label, parsed.tsIso))) return;
      const node = stepNode(parsed.step, parseTs(parsed.tsIso, ts), `msg-${message.id}`);
      if (node) nodes.push(node);
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
    } else if (ev.category === "message") {
    } else {
      const node = stepNode(
        { category: ev.category, label: ev.label, args: ev.args, result: ev.result, isError: ev.isError, durationMs: ev.durationMs },
        ts,
        `trace-${i}`
      );
      if (node) nodes.push(node);
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
import { Fragment as Fragment2, jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
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
  accountByoUnused: "Your connected account wasn't used",
  ranOnEvermind: "Generated by this project's Evermind model",
  recallTitle: "Recalled {count} memories from Evermind v{version}",
  recallHint: "This project's self-learning Evermind recalled these prior learnings and grounded the answer on them.",
  learnTitle: "Contributed this turn to Evermind v{version}",
  learnHint: "This turn was contributed back to the project Evermind \u2014 it will be merged into the learned model.",
  reconcileTitle: "Reconciled {count} learned memories in Evermind v{version}",
  reconcileHint: "The answer restated these recalled learnings, so it updates them (write-through cognition)."
};
function ProvenanceChip({ prov, labels }) {
  const unused = prov.account === "shared_byo_unused";
  const badge = prov.account === "own" ? labels.accountOwn : unused ? labels.accountByoUnused : labels.accountShared;
  const variant = prov.account === "own" ? "bf-tl__prov--own" : unused ? "bf-tl__prov--unused" : "bf-tl__prov--shared";
  const modelTitle = prov.vendor ? `${prov.model} \xB7 ${prov.vendor}` : prov.model;
  return /* @__PURE__ */ jsxs4("div", { className: `bf-tl__prov ${variant}`, children: [
    /* @__PURE__ */ jsx4("span", { className: "bf-tl__prov-model", title: modelTitle, children: prov.model }),
    /* @__PURE__ */ jsx4("span", { className: "bf-tl__prov-badge", children: badge }),
    prov.evermind ? /* @__PURE__ */ jsx4("span", { className: "bf-tl__prov-evermind", title: labels.ranOnEvermind, children: `\u{1F9E0} Evermind v${prov.evermind.version}` }) : null
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
    case "recall":
    case "learn":
    case "reconcile":
      return "\u{1F9E0}";
    default:
      return "\u2022";
  }
}
function CopyButton({ text, labels }) {
  const [copied, setCopied] = useState3(false);
  return /* @__PURE__ */ jsx4(
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
  return /* @__PURE__ */ jsx4(Fragment2, { children: text.split("\n").map((line, i) => /* @__PURE__ */ jsxs4("div", { className: `bf-tl__diff-line ${cls}`, children: [
    /* @__PURE__ */ jsx4("span", { className: "bf-tl__diff-sign", "aria-hidden": true, children: sign }),
    /* @__PURE__ */ jsx4("span", { className: "bf-tl__diff-text", children: line || "\xA0" })
  ] }, i)) });
}
function ToolStep({
  node,
  labels
}) {
  const argsText = formatPayload(node.args);
  const resultText = formatPayload(node.result);
  const preview = toolPreview(node.args);
  return /* @__PURE__ */ jsxs4("details", { className: `bf-tl__tool${node.isError ? " bf-tl__tool--error" : ""}`, children: [
    /* @__PURE__ */ jsxs4("summary", { className: "bf-tl__tool-head", children: [
      /* @__PURE__ */ jsx4("span", { className: "bf-tl__tool-status", "aria-hidden": true, children: node.isError ? "\u2717" : "\u2713" }),
      /* @__PURE__ */ jsx4("span", { className: "bf-tl__tool-name", children: node.label }),
      node.durationMs != null && /* @__PURE__ */ jsx4("span", { className: "bf-tl__tool-dur", children: formatDuration(node.durationMs) }),
      /* @__PURE__ */ jsx4("span", { className: "bf-tl__tool-caret", "aria-hidden": true, children: "\u25B8" })
    ] }),
    /* @__PURE__ */ jsxs4("div", { className: "bf-tl__tool-body", children: [
      preview && /* @__PURE__ */ jsxs4("div", { className: "bf-tl__io", children: [
        /* @__PURE__ */ jsxs4("div", { className: "bf-tl__io-label", children: [
          /* @__PURE__ */ jsxs4("span", { children: [
            labels.preview,
            preview.path ? ` \xB7 ${preview.path}` : ""
          ] }),
          /* @__PURE__ */ jsx4(
            CopyButton,
            {
              text: preview.kind === "edit" ? preview.newText : preview.content,
              labels
            }
          )
        ] }),
        preview.kind === "edit" ? /* @__PURE__ */ jsxs4("div", { className: "bf-tl__diff", children: [
          /* @__PURE__ */ jsx4(DiffLines, { text: preview.oldText, sign: "-" }),
          /* @__PURE__ */ jsx4(DiffLines, { text: preview.newText, sign: "+" })
        ] }) : /* @__PURE__ */ jsx4("pre", { className: "bf-tl__io-pre", children: /* @__PURE__ */ jsx4("code", { children: preview.content }) })
      ] }),
      argsText && /* @__PURE__ */ jsxs4("div", { className: "bf-tl__io", children: [
        /* @__PURE__ */ jsxs4("div", { className: "bf-tl__io-label", children: [
          /* @__PURE__ */ jsx4("span", { children: labels.input }),
          /* @__PURE__ */ jsx4(CopyButton, { text: argsText, labels })
        ] }),
        /* @__PURE__ */ jsx4("pre", { className: "bf-tl__io-pre", children: /* @__PURE__ */ jsx4("code", { children: argsText }) })
      ] }),
      resultText && /* @__PURE__ */ jsxs4("div", { className: "bf-tl__io", children: [
        /* @__PURE__ */ jsxs4("div", { className: "bf-tl__io-label", children: [
          /* @__PURE__ */ jsx4("span", { children: labels.output }),
          /* @__PURE__ */ jsx4(CopyButton, { text: resultText, labels })
        ] }),
        /* @__PURE__ */ jsx4("pre", { className: "bf-tl__io-pre", children: /* @__PURE__ */ jsx4("code", { children: resultText }) })
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
  const labels = useMemo3(() => ({ ...DEFAULT_TIMELINE_LABELS, ...labelOverrides }), [labelOverrides]);
  const assistant = assistantName ?? labels.assistant;
  const settled = useMemo3(() => buildSettledTimeline(messages, trace), [messages, trace]);
  const nodes = useMemo3(() => {
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
  const renderMsg = (msg, role, text) => renderMessage ? renderMessage(msg, { role, text }) : /* @__PURE__ */ jsx4(
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
  return /* @__PURE__ */ jsxs4("div", { className: "bf-tl-scroll", ref: scrollRef, onScroll, children: [
    loading && /* @__PURE__ */ jsx4("div", { className: "bf-tl-status", children: labels.loading }),
    isEmpty && (emptyState ?? /* @__PURE__ */ jsx4("div", { className: "bf-tl-empty", children: labels.empty })),
    /* @__PURE__ */ jsxs4("ol", { className: "bf-tl", ref: contentRef, children: [
      nodes.map((node) => {
        if (node.kind === "user") {
          const to = parseDirectedRecipient(node.message);
          return /* @__PURE__ */ jsxs4("li", { className: "bf-tl__item bf-tl__item--user", children: [
            /* @__PURE__ */ jsx4("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ jsx4("span", { className: "bf-tl__dot", children: dotIcon("user") }) }),
            /* @__PURE__ */ jsxs4("div", { className: "bf-tl__body", children: [
              /* @__PURE__ */ jsxs4("div", { className: "bf-tl__role", style: to ? { display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" } : void 0, children: [
                /* @__PURE__ */ jsx4("span", { children: labels.you }),
                to && /* @__PURE__ */ jsxs4("span", { style: { display: "inline-flex", alignItems: "center", gap: 4, opacity: 0.9 }, children: [
                  /* @__PURE__ */ jsx4("span", { "aria-hidden": true, style: { opacity: 0.6 }, children: "\u2192" }),
                  /* @__PURE__ */ jsx4(Avatar, { name: to.name, kind: to.kind, size: 15 }),
                  /* @__PURE__ */ jsx4("span", { children: to.name })
                ] })
              ] }),
              node.images.length > 0 && /* @__PURE__ */ jsx4("div", { className: "bf-tl__images", children: node.images.map((im, i) => /* @__PURE__ */ jsx4("img", { src: im.url, alt: im.name ?? "", className: "bf-tl__image" }, i)) }),
              node.text && /* @__PURE__ */ jsx4("div", { className: "bf-tl__bubble bf-tl__bubble--user", children: renderMsg(node.message, "user", node.text) })
            ] })
          ] }, node.key);
        }
        if (node.kind === "assistant") {
          const author = parseMessageAuthor(node.message);
          const card = onAnswerQuestion ? parseAskUser(node.text) : null;
          const bodyText = card ? stripAskUser(node.text) : node.text;
          const prov = parseMessageProvenance(node.message);
          return /* @__PURE__ */ jsxs4("li", { className: "bf-tl__item bf-tl__item--assistant", children: [
            /* @__PURE__ */ jsx4("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ jsx4("span", { className: "bf-tl__dot", children: author ? /* @__PURE__ */ jsx4(Avatar, { name: author.name, kind: author.kind, size: 16 }) : dotIcon("assistant") }) }),
            /* @__PURE__ */ jsxs4("div", { className: "bf-tl__body", children: [
              /* @__PURE__ */ jsx4("div", { className: "bf-tl__role", children: author ? author.name : assistant }),
              bodyText && /* @__PURE__ */ jsx4("div", { className: "bf-tl__bubble", children: renderMsg(node.message, "assistant", bodyText) }),
              card && onAnswerQuestion && /* @__PURE__ */ jsx4(
                QuestionCard,
                {
                  payload: card,
                  labels: { askSubmit: labels.askSubmit, askAnswered: labels.askAnswered },
                  onAnswer: onAnswerQuestion
                }
              ),
              renderAssistantActions && /* @__PURE__ */ jsx4("div", { className: "bf-tl__actions", children: renderAssistantActions(node.message) }),
              prov && /* @__PURE__ */ jsx4(ProvenanceChip, { prov, labels })
            ] })
          ] }, node.key);
        }
        if (node.kind === "thinking") {
          const label = labels.thoughtFor.replace("{duration}", formatDuration(node.durationMs));
          return /* @__PURE__ */ jsxs4("li", { className: "bf-tl__item bf-tl__item--thinking", children: [
            /* @__PURE__ */ jsx4("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ jsx4("span", { className: "bf-tl__dot bf-tl__dot--muted", children: dotIcon("thinking") }) }),
            /* @__PURE__ */ jsx4("div", { className: "bf-tl__body", children: /* @__PURE__ */ jsx4("span", { className: "bf-tl__thinking", children: label }) })
          ] }, node.key);
        }
        if (node.kind === "tool") {
          return /* @__PURE__ */ jsxs4("li", { className: "bf-tl__item bf-tl__item--tool", children: [
            /* @__PURE__ */ jsx4("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ jsx4("span", { className: `bf-tl__dot${node.isError ? " bf-tl__dot--error" : ""}`, children: dotIcon("tool", node.isError) }) }),
            /* @__PURE__ */ jsx4("div", { className: "bf-tl__body", children: /* @__PURE__ */ jsx4(ToolStep, { node, labels }) })
          ] }, node.key);
        }
        if (node.kind === "error") {
          return /* @__PURE__ */ jsxs4("li", { className: "bf-tl__item bf-tl__item--error", children: [
            /* @__PURE__ */ jsx4("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ jsx4("span", { className: "bf-tl__dot bf-tl__dot--error", children: dotIcon("error") }) }),
            /* @__PURE__ */ jsxs4("div", { className: "bf-tl__body", children: [
              /* @__PURE__ */ jsx4("div", { className: "bf-tl__role bf-tl__role--error", children: labels.error }),
              /* @__PURE__ */ jsx4("div", { className: "bf-tl__bubble bf-tl__bubble--error", children: node.message })
            ] })
          ] }, node.key);
        }
        if (node.kind === "recall") {
          const title = labels.recallTitle.replace("{count}", String(node.count)).replace("{version}", String(node.version));
          return /* @__PURE__ */ jsxs4("li", { className: "bf-tl__item bf-tl__item--memory", children: [
            /* @__PURE__ */ jsx4("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ jsx4("span", { className: "bf-tl__dot bf-tl__dot--muted", children: dotIcon("recall") }) }),
            /* @__PURE__ */ jsx4("div", { className: "bf-tl__body", children: /* @__PURE__ */ jsxs4("details", { className: "bf-tl__tool bf-tl__memory", children: [
              /* @__PURE__ */ jsxs4("summary", { className: "bf-tl__tool-head", title: labels.recallHint, children: [
                /* @__PURE__ */ jsx4("span", { className: "bf-tl__tool-name", children: title }),
                /* @__PURE__ */ jsx4("span", { className: "bf-tl__tool-caret", "aria-hidden": true, children: "\u25B8" })
              ] }),
              /* @__PURE__ */ jsx4("div", { className: "bf-tl__tool-body", children: /* @__PURE__ */ jsx4("ol", { className: "bf-tl__memory-list", children: node.items.map((it) => /* @__PURE__ */ jsxs4("li", { className: "bf-tl__memory-item", children: [
                /* @__PURE__ */ jsxs4("span", { className: "bf-tl__memory-score", "aria-hidden": true, children: [
                  Math.round(it.score * 100),
                  "%"
                ] }),
                /* @__PURE__ */ jsx4("span", { className: "bf-tl__memory-text", children: it.text })
              ] }, it.id)) }) })
            ] }) })
          ] }, node.key);
        }
        if (node.kind === "learn") {
          const title = labels.learnTitle.replace("{version}", String(node.version));
          return /* @__PURE__ */ jsxs4("li", { className: "bf-tl__item bf-tl__item--memory", children: [
            /* @__PURE__ */ jsx4("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ jsx4("span", { className: "bf-tl__dot bf-tl__dot--muted", children: dotIcon("learn") }) }),
            /* @__PURE__ */ jsx4("div", { className: "bf-tl__body", children: /* @__PURE__ */ jsx4("span", { className: "bf-tl__memory-line", title: labels.learnHint, children: title }) })
          ] }, node.key);
        }
        if (node.kind === "reconcile") {
          const title = labels.reconcileTitle.replace("{count}", String(node.count)).replace("{version}", String(node.version));
          return /* @__PURE__ */ jsxs4("li", { className: "bf-tl__item bf-tl__item--memory", children: [
            /* @__PURE__ */ jsx4("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ jsx4("span", { className: "bf-tl__dot bf-tl__dot--muted", children: dotIcon("reconcile") }) }),
            /* @__PURE__ */ jsx4("div", { className: "bf-tl__body", children: /* @__PURE__ */ jsx4("span", { className: "bf-tl__memory-line", title: labels.reconcileHint, children: title }) })
          ] }, node.key);
        }
        return /* @__PURE__ */ jsxs4("li", { className: "bf-tl__item bf-tl__item--assistant bf-tl__item--streaming", children: [
          /* @__PURE__ */ jsx4("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ jsx4("span", { className: "bf-tl__dot bf-tl__dot--pulse", children: dotIcon("assistant") }) }),
          /* @__PURE__ */ jsxs4("div", { className: "bf-tl__body", children: [
            /* @__PURE__ */ jsx4("div", { className: "bf-tl__role", children: assistant }),
            /* @__PURE__ */ jsx4("div", { className: "bf-tl__bubble", children: renderStreaming ? renderStreaming(node.text) : /* @__PURE__ */ jsx4(Markdown, { content: node.text, onInternalLink, labels }) })
          ] })
        ] }, node.key);
      }),
      isRunning && !streamingText.trim() && /* @__PURE__ */ jsxs4("li", { className: "bf-tl__item bf-tl__item--thinking", "aria-live": "polite", children: [
        /* @__PURE__ */ jsx4("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ jsx4("span", { className: "bf-tl__dot bf-tl__dot--pulse", children: dotIcon("thinking") }) }),
        /* @__PURE__ */ jsx4("div", { className: "bf-tl__body", children: /* @__PURE__ */ jsx4("span", { className: "bf-tl__thinking bf-tl__thinking--live", children: labels.thinking }) })
      ] })
    ] })
  ] });
}
var BrainTimeline = React2.memo(BrainTimelineInner);

// src/HealthRing.tsx
import { jsx as jsx5, jsxs as jsxs5 } from "react/jsx-runtime";
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
  return /* @__PURE__ */ jsxs5("span", { className: "bf-health-ring", style: { display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 2 }, children: [
    /* @__PURE__ */ jsxs5("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: "img", "aria-label": label, children: [
      /* @__PURE__ */ jsx5(
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
      /* @__PURE__ */ jsx5(
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
      /* @__PURE__ */ jsx5(
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
    caption ? /* @__PURE__ */ jsx5("span", { style: { fontSize: 10, color: "var(--bf-health-caption, var(--bf-text-muted, #6b7280))", lineHeight: 1 }, children: caption }) : null
  ] });
}

// src/chatTickets/ChatTicketsPanel.tsx
import { memo, useCallback, useEffect as useEffect2, useMemo as useMemo4, useState as useState4 } from "react";

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
import { jsx as jsx6, jsxs as jsxs6 } from "react/jsx-runtime";
var RUNNABLE = new Set(RUNNABLE_KINDS);
function ChatTicketsPanelInner({ chatId, projectId, chatList, adapter, labels, onChanged, refreshSignal, visibility, onSetVisibility }) {
  const [tickets, setTickets] = useState4([]);
  const [agents, setAgents] = useState4([]);
  const [members, setMembers] = useState4([]);
  const [pool, setPool] = useState4([]);
  const [panel, setPanel] = useState4(null);
  const [lineageKey, setLineageKey] = useState4(null);
  const [lineage, setLineage] = useState4([]);
  const [runKey, setRunKey] = useState4(null);
  const [msg, setMsg] = useState4(null);
  const [busy, setBusy] = useState4(false);
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
  return /* @__PURE__ */ jsxs6("div", { style: S.root, children: [
    /* @__PURE__ */ jsx6("div", { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }, children: tickets.length === 0 ? /* @__PURE__ */ jsx6("span", { style: S.muted, children: labels.none }) : tickets.map((tk) => {
      const key = `${tk.kind}:${tk.ref}`;
      return /* @__PURE__ */ jsxs6("div", { style: S.chip, children: [
        /* @__PURE__ */ jsx6(HealthRing, { percent: tk.progressPct, size: 36, caption: tk.total > 0 ? `${tk.done}/${tk.total}` : void 0, muted: !tk.exists, ariaLabel: labels.ringAria(tk.label, tk.progressPct) }),
        /* @__PURE__ */ jsxs6("div", { style: { display: "flex", flexDirection: "column", minWidth: 0, maxWidth: 160 }, children: [
          /* @__PURE__ */ jsx6("span", { style: S.ticketLabel, title: tk.label, children: tk.label }),
          /* @__PURE__ */ jsxs6("span", { style: S.ticketMeta, children: [
            labels.kind[tk.kind],
            " \xB7 ",
            tk.status,
            tk.linkType === "created" ? ` \xB7 ${labels.spawned}` : ""
          ] })
        ] }),
        /* @__PURE__ */ jsxs6("div", { style: { display: "flex", gap: 2 }, children: [
          RUNNABLE.has(tk.kind) && tk.exists && /* @__PURE__ */ jsx6("button", { type: "button", title: labels.run, onClick: () => setRunKey(runKey === key ? null : key), style: S.icon, children: "\u25B6" }),
          /* @__PURE__ */ jsx6("button", { type: "button", title: labels.lineage, onClick: () => void openLineage(tk), style: S.icon, children: "\u2443" }),
          /* @__PURE__ */ jsx6("button", { type: "button", title: labels.unlink, disabled: busy, onClick: () => void unlink(tk), style: S.icon, children: "\u2715" })
        ] }),
        runKey === key && /* @__PURE__ */ jsxs6("select", { "aria-label": labels.pickAgent, value: "", onChange: (e) => {
          if (e.target.value) void runTicket(tk, e.target.value);
        }, style: S.select, children: [
          /* @__PURE__ */ jsx6("option", { value: "", children: labels.pickAgent }),
          agents.map((a) => /* @__PURE__ */ jsxs6("option", { value: a.agentRef, children: [
            "\u2605 ",
            poolName(a.agentRef)
          ] }, a.id)),
          pool.filter((p) => !agents.some((a) => a.agentRef === p.ref)).map((p) => /* @__PURE__ */ jsx6("option", { value: p.ref, children: p.name }, p.ref))
        ] })
      ] }, tk.linkId);
    }) }),
    lineageKey && /* @__PURE__ */ jsxs6("div", { style: S.drawer, children: [
      /* @__PURE__ */ jsx6("strong", { style: { color: V.text }, children: labels.lineageTitle }),
      lineage.length === 0 ? /* @__PURE__ */ jsx6("span", { style: { marginLeft: 8, ...S.muted }, children: labels.lineageEmpty }) : /* @__PURE__ */ jsx6("ul", { style: { margin: "4px 0 0", paddingLeft: 18 }, children: lineage.map((c) => /* @__PURE__ */ jsxs6("li", { style: { marginBottom: 2 }, children: [
        /* @__PURE__ */ jsx6("span", { style: { fontWeight: c.chatId === chatId ? 700 : 400 }, children: c.title }),
        c.linkType === "created" ? /* @__PURE__ */ jsx6("em", { style: { color: V.accent, marginLeft: 6 }, children: labels.spawned }) : null,
        c.isArchived ? /* @__PURE__ */ jsxs6("span", { style: { marginLeft: 6, ...S.muted }, children: [
          "(",
          labels.merged,
          ")"
        ] }) : null
      ] }, c.chatId)) })
    ] }),
    /* @__PURE__ */ jsxs6("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ jsxs6("button", { type: "button", onClick: () => setPanel(panel === "link" ? null : "link"), style: S.pill(panel === "link"), children: [
        "\uFF0B ",
        labels.link
      ] }),
      /* @__PURE__ */ jsxs6("button", { type: "button", onClick: () => setPanel(panel === "agents" ? null : "agents"), style: S.pill(panel === "agents"), children: [
        "\u{1F465} ",
        labels.agents,
        agents.length ? ` (${agents.length})` : ""
      ] }),
      /* @__PURE__ */ jsxs6("button", { type: "button", onClick: () => setPanel(panel === "people" ? null : "people"), style: S.pill(panel === "people"), children: [
        "\u{1F464} ",
        labels.people,
        members.length ? ` (${members.length})` : ""
      ] }),
      /* @__PURE__ */ jsxs6("button", { type: "button", onClick: () => setPanel(panel === "merge" ? null : "merge"), style: S.pill(panel === "merge"), children: [
        "\u29C9 ",
        labels.merge
      ] }),
      msg && /* @__PURE__ */ jsx6("span", { style: { fontSize: 12, color: V.accent, alignSelf: "center" }, children: msg })
    ] }),
    panel === "link" && /* @__PURE__ */ jsx6(LinkForm, { search: adapter.searchTickets, projectId, existing: tickets, labels, onLink: async (kind, ref, linkType) => {
      try {
        await adapter.linkTicket(chatId, { kind, ref, linkType });
        await load();
      } catch (e) {
        flash(e instanceof Error ? e.message : labels.linkFailed);
      }
    } }),
    panel === "agents" && /* @__PURE__ */ jsx6(
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
    panel === "people" && /* @__PURE__ */ jsx6(
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
    panel === "merge" && /* @__PURE__ */ jsx6(
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
  const [kind, setKind] = useState4("task");
  const [ref, setRef] = useState4("");
  const [query, setQuery] = useState4("");
  const [linkType, setLinkType] = useState4("linked");
  const [busy, setBusy] = useState4(false);
  const [results, setResults] = useState4([]);
  const [loading, setLoading] = useState4(false);
  useEffect2(() => {
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
  const shown = useMemo4(
    () => results.filter((o) => !existing.some((e) => e.kind === kind && e.ref === o.ref)),
    [results, existing, kind]
  );
  const atCap = results.length >= SEARCH_LIMIT;
  useEffect2(() => {
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
  return /* @__PURE__ */ jsxs6("div", { style: S.section, children: [
    /* @__PURE__ */ jsx6("select", { "aria-label": labels.kindLabel, value: kind, onChange: (e) => {
      setKind(e.target.value);
      setRef("");
      setQuery("");
    }, style: S.select, children: TICKET_KINDS.map((k) => /* @__PURE__ */ jsx6("option", { value: k, children: labels.kind[k] }, k)) }),
    /* @__PURE__ */ jsx6(
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
    /* @__PURE__ */ jsxs6("select", { "aria-label": labels.pickTicket, value: ref, onChange: (e) => setRef(e.target.value), style: { ...S.select, minWidth: 200 }, children: [
      /* @__PURE__ */ jsx6("option", { value: "", children: labels.pickTicket }),
      shown.map((o) => /* @__PURE__ */ jsx6("option", { value: o.ref, children: o.label }, o.ref))
    ] }),
    loading ? /* @__PURE__ */ jsx6("span", { style: S.muted, children: labels.searching }) : shown.length === 0 ? /* @__PURE__ */ jsx6("span", { style: S.muted, children: labels.noMatches }) : atCap ? /* @__PURE__ */ jsx6("span", { style: S.muted, children: labels.refine }) : null,
    /* @__PURE__ */ jsxs6("select", { "aria-label": labels.linkTypeLabel, value: linkType, onChange: (e) => setLinkType(e.target.value), style: S.select, children: [
      /* @__PURE__ */ jsx6("option", { value: "linked", children: labels.linkTypeLinked }),
      /* @__PURE__ */ jsx6("option", { value: "created", children: labels.linkTypeCreated })
    ] }),
    /* @__PURE__ */ jsx6("button", { type: "button", onClick: () => void submit(), disabled: busy || !ref, style: S.pill(true), children: busy ? "\u2026" : labels.linkAction })
  ] });
}
function AgentsSection({ agents, pool, labels, onInvite, onRemove, busy }) {
  const poolName = (ref) => pool.find((p) => p.ref === ref)?.name ?? ref;
  const uninvited = pool.filter((p) => !agents.some((a) => a.agentRef === p.ref));
  return /* @__PURE__ */ jsxs6("div", { style: { ...S.section, flexDirection: "column", alignItems: "stretch" }, children: [
    /* @__PURE__ */ jsx6("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, children: agents.length === 0 ? /* @__PURE__ */ jsx6("span", { style: S.muted, children: labels.noAgents }) : agents.map((a) => /* @__PURE__ */ jsxs6("span", { style: S.agentChip, children: [
      /* @__PURE__ */ jsx6("span", { "aria-hidden": true, children: "\u{1F916}" }),
      poolName(a.agentRef),
      /* @__PURE__ */ jsx6("button", { type: "button", title: labels.removeAgent, disabled: busy, onClick: () => void onRemove(a.id), style: { ...S.icon, fontSize: 11 }, children: "\u2715" })
    ] }, a.id)) }),
    /* @__PURE__ */ jsxs6("select", { "aria-label": labels.inviteAgent, value: "", onChange: (e) => {
      const p = pool.find((x) => x.ref === e.target.value);
      if (p) void onInvite(p.ref, p.kind);
    }, style: { ...S.select, maxWidth: 260 }, children: [
      /* @__PURE__ */ jsx6("option", { value: "", children: labels.inviteAgent }),
      uninvited.map((p) => /* @__PURE__ */ jsxs6("option", { value: p.ref, children: [
        p.name,
        " \u2014 ",
        p.meta
      ] }, p.ref))
    ] }),
    /* @__PURE__ */ jsx6("span", { style: { fontSize: 11, ...S.muted }, children: labels.agentsHint })
  ] });
}
function PeopleSection({ members, labels, visibility, onSetVisibility, onInvite, onRemove, busy }) {
  const [email, setEmail] = useState4("");
  const submit = async () => {
    const e = email.trim();
    if (!e) return;
    await onInvite(e);
    setEmail("");
  };
  const locked = visibility === "locked";
  return /* @__PURE__ */ jsxs6("div", { style: { ...S.section, flexDirection: "column", alignItems: "stretch" }, children: [
    visibility && onSetVisibility && /* @__PURE__ */ jsxs6("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ jsx6("button", { type: "button", disabled: busy, onClick: () => void onSetVisibility(locked ? "shared" : "locked"), style: S.pill(locked), children: locked ? `\u{1F512} ${labels.visibilityLocked}` : `\u{1F513} ${labels.visibilityShared}` }),
      /* @__PURE__ */ jsx6("span", { style: { fontSize: 11, ...S.muted }, children: labels.lockHint })
    ] }),
    /* @__PURE__ */ jsx6("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, children: members.length === 0 ? /* @__PURE__ */ jsx6("span", { style: S.muted, children: labels.noPeople }) : members.map((m) => /* @__PURE__ */ jsxs6("span", { style: S.agentChip, children: [
      /* @__PURE__ */ jsx6("span", { "aria-hidden": true, children: m.status === "pending" ? "\u2709\uFE0F" : "\u{1F464}" }),
      m.name,
      /* @__PURE__ */ jsx6("button", { type: "button", title: labels.removePerson, disabled: busy, onClick: () => void onRemove(m.id), style: { ...S.icon, fontSize: 11 }, children: "\u2715" })
    ] }, m.id)) }),
    /* @__PURE__ */ jsxs6("div", { style: { display: "flex", gap: 6 }, children: [
      /* @__PURE__ */ jsx6(
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
      /* @__PURE__ */ jsx6("button", { type: "button", disabled: busy || !email.trim(), onClick: () => void submit(), style: S.pill(false), children: "\uFF0B" })
    ] }),
    /* @__PURE__ */ jsx6("span", { style: { fontSize: 11, ...S.muted }, children: labels.invitePersonHint })
  ] });
}
function MergeSection({ chatId, chatList, labels, onMerge, busy }) {
  const [selected, setSelected] = useState4([]);
  const candidates = chatList.filter((c) => c.id !== chatId);
  const toggle = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  return /* @__PURE__ */ jsxs6("div", { style: { ...S.section, flexDirection: "column", alignItems: "stretch" }, children: [
    /* @__PURE__ */ jsx6("span", { style: { fontSize: 12, color: V.text2 }, children: labels.mergeHint }),
    /* @__PURE__ */ jsx6("div", { style: { maxHeight: 160, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }, children: candidates.length === 0 ? /* @__PURE__ */ jsx6("span", { style: S.muted, children: labels.mergeNoOthers }) : candidates.map((c) => /* @__PURE__ */ jsxs6("label", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "3px 4px", cursor: "pointer" }, children: [
      /* @__PURE__ */ jsx6("input", { type: "checkbox", checked: selected.includes(c.id), onChange: () => toggle(c.id) }),
      /* @__PURE__ */ jsx6("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: c.title })
    ] }, c.id)) }),
    /* @__PURE__ */ jsx6("button", { type: "button", onClick: () => {
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
import { useEffect as useEffect3, useMemo as useMemo5, useState as useState5 } from "react";
function useChatParticipants(adapter, chatId, refreshSignal = 0) {
  const [pool, setPool] = useState5([]);
  const [invited, setInvited] = useState5([]);
  const [members, setMembers] = useState5([]);
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
  return useMemo5(
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
import { useCallback as useCallback2, useEffect as useEffect4, useMemo as useMemo6, useState as useState6 } from "react";
import {
  activeMentionToken,
  filterMentionCandidates
} from "@seanhogg/builderforce-brain-embedded";
import { jsx as jsx7, jsxs as jsxs7 } from "react/jsx-runtime";
function useMentionAutocomplete(opts) {
  const { textareaRef, value, setValue, participants, onPick, labels, disabled } = opts;
  const [token, setToken] = useState6(null);
  const [index, setIndex] = useState6(0);
  const matches = useMemo6(
    () => token && !disabled ? filterMentionCandidates(participants, token.query) : [],
    [token, participants, disabled]
  );
  const open = !disabled && token != null && matches.length > 0;
  const recompute = useCallback2(() => {
    const el = textareaRef.current;
    if (!el || disabled || participants.length === 0) {
      setToken(null);
      return;
    }
    const next = activeMentionToken(el.value, el.selectionStart ?? el.value.length);
    setToken(next);
    setIndex(0);
  }, [textareaRef, disabled, participants.length]);
  useEffect4(() => {
    recompute();
  }, [value, recompute]);
  const choose = useCallback2((r) => {
    const el = textareaRef.current;
    const tk = token ?? (el ? activeMentionToken(el.value, el.selectionStart ?? 0) : null);
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
  const onKeyDown = useCallback2((e) => {
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
  const popup = open ? /* @__PURE__ */ jsx7(MentionPopup, { matches, index, labels, onHover: setIndex, onPick: choose }) : null;
  return { onKeyDown, onSelect: recompute, popup, open };
}
function MentionPopup({ matches, index, labels, onHover, onPick }) {
  return /* @__PURE__ */ jsx7("div", { style: POP.anchor, children: /* @__PURE__ */ jsxs7("ul", { role: "listbox", "aria-label": labels?.title ?? "Direct to", style: POP.list, children: [
    labels?.title && /* @__PURE__ */ jsx7("li", { "aria-hidden": true, style: POP.group, children: labels.title }),
    matches.map((m, i) => /* @__PURE__ */ jsxs7(
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
          /* @__PURE__ */ jsx7(Avatar, { name: m.name, kind: m.kind, size: 20 }),
          /* @__PURE__ */ jsx7("span", { style: POP.name, children: m.name }),
          /* @__PURE__ */ jsx7("span", { style: POP.kind, children: m.kind === "agent" ? labels?.agent ?? "Agent" : labels?.human ?? "Person" })
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
import { useCallback as useCallback3, useEffect as useEffect5, useMemo as useMemo7, useState as useState7 } from "react";

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
  evalDelta: (pct) => `${pct}% vs prev`,
  evalFlat: "no change",
  evalTooltip: (version, base, next, size) => `Regression check on v${version}: held-out loss ${base} \u2192 ${next} across ${size} prior task(s).`,
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
  validateCta: "Validate",
  validating: "Checking\u2026",
  validateHint: "Check which learned memories would answer this task \u2014 before you teach it.",
  validateResultTitle: (p) => `Memories that would answer \u201C${p}\u201D`,
  validateEmpty: "No learned memory matches this task yet \u2014 teaching it would add new knowledge.",
  validatePrimaryBadge: "Most likely used",
  validateScore: (pct) => `${pct}% match`,
  validateClear: "Clear",
  validateMethod: (m) => m === "embedding" ? "Semantic recall" : "Lexical recall (fallback)",
  inspectTitle: "Recently learned",
  inspectEmpty: "Nothing learned yet. Runs and teaching will appear here.",
  kindText: "Run",
  kindDelta: "Delta",
  deltaEntry: "Weight delta contributed by an agent run.",
  versionTag: (v) => `v${v}`,
  weightTag: (w) => `\xD7${w}`,
  viewDetail: "View detail",
  hideDetail: "Hide detail",
  detailPromptLabel: "Task",
  detailTextLabel: "Learned",
  refresh: "Refresh",
  errorGeneric: "Something went wrong. Try again."
};

// src/evermind/EvermindConsole.tsx
import { Fragment as Fragment3, jsx as jsx8, jsxs as jsxs8 } from "react/jsx-runtime";
var C = {
  surface: "var(--bf-ev-surface, var(--bg-surface, var(--bf-surface, var(--vscode-editorWidget-background, transparent))))",
  surface2: "var(--bf-ev-surface-2, var(--bg-elevated, var(--bf-surface-2, var(--vscode-textBlockQuote-background, rgba(148,163,184,0.08)))))",
  border: "var(--bf-ev-border, var(--border-subtle, var(--bf-border, var(--vscode-panel-border, rgba(148,163,184,0.3)))))",
  text: "var(--bf-ev-text, var(--text-primary, var(--bf-text, inherit)))",
  text2: "var(--bf-ev-text-2, var(--text-secondary, var(--bf-text-muted, #6b7280)))",
  accent: "var(--bf-ev-accent, var(--coral-bright, var(--accent, var(--bf-accent, #ff6b5e))))",
  danger: "var(--bf-ev-danger, var(--danger-text, #d9534f))"
};
function EvermindConsole({ adapter, canManage, labels, refreshMs = 2e4, projectName, showRecent = true, onValidate }) {
  const t = useMemo7(() => ({ ...DEFAULT_EVERMIND_LABELS, ...labels ?? {} }), [labels]);
  const [data, setData] = useState7(null);
  const [seedModels, setSeedModels] = useState7([]);
  const [teacherOpts, setTeacherOpts] = useState7(null);
  const [selectedSlug, setSelectedSlug] = useState7("");
  const [teachPrompt, setTeachPrompt] = useState7("");
  const [teachText, setTeachText] = useState7("");
  const [busy, setBusy] = useState7(false);
  const [validating, setValidating] = useState7(false);
  const [validateResult, setValidateResult] = useState7(null);
  const [notice, setNotice] = useState7(null);
  const [error, setError] = useState7(null);
  const [loaded, setLoaded] = useState7(false);
  const [loadFailed, setLoadFailed] = useState7(false);
  const reload = useCallback3(async () => {
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
  useEffect5(() => {
    setLoaded(false);
    void reload();
  }, [reload]);
  useEffect5(() => {
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
  useEffect5(() => {
    if (!refreshMs) return;
    const id = setInterval(() => {
      if (!busy) void reload();
    }, refreshMs);
    return () => clearInterval(id);
  }, [refreshMs, busy, reload]);
  const runValidate = useCallback3(async (prompt) => {
    const task = prompt.trim();
    if (task.length < 3) return;
    setValidating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await adapter.validate(task);
      setValidateResult(result);
      onValidate?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errorGeneric);
    } finally {
      setValidating(false);
    }
  }, [adapter, onValidate, t.errorGeneric]);
  const clearValidate = useCallback3(() => {
    setValidateResult(null);
    onValidate?.(null);
  }, [onValidate]);
  const run = useCallback3(async (op, successNotice) => {
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
  if (!loaded) return /* @__PURE__ */ jsx8(Section, { "aria-busy": true, children: /* @__PURE__ */ jsx8("p", { style: { margin: 0, color: C.text2, fontSize: "0.82rem" }, children: t.loading }) });
  const seeded = !!data?.seeded;
  const frozen = data?.mode === "offline-frozen";
  const scopeName = projectName?.trim();
  const Header = /* @__PURE__ */ jsxs8("header", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
    /* @__PURE__ */ jsx8("span", { "aria-hidden": true, style: { fontSize: "1.05rem" }, children: "\u{1F9E0}" }),
    /* @__PURE__ */ jsx8("h3", { style: { margin: 0, fontSize: "0.95rem", fontWeight: 700, color: C.text }, children: t.title }),
    scopeName && /* @__PURE__ */ jsxs8("span", { style: { fontSize: "0.8rem", color: C.text2 }, title: scopeName, children: [
      "\xB7 ",
      scopeName
    ] }),
    !loadFailed && /* @__PURE__ */ jsx8("span", { style: pill(seeded), children: seeded ? t.statusSeeded(data?.version ?? 0) : t.statusUnseeded }),
    !loadFailed && seeded && /* @__PURE__ */ jsx8(RegressionChip, { t, evalPoint: data?.eval ?? null }),
    /* @__PURE__ */ jsx8("button", { type: "button", onClick: () => void reload(), disabled: busy, style: ghostBtn, title: t.refresh, "aria-label": t.refresh, children: "\u21BB" })
  ] });
  if (loadFailed) {
    return /* @__PURE__ */ jsxs8(Section, { "aria-label": t.title, children: [
      Header,
      /* @__PURE__ */ jsx8("p", { style: { margin: 0, fontSize: "0.8rem", lineHeight: 1.5, color: C.danger }, role: "alert", children: t.errorGeneric }),
      /* @__PURE__ */ jsx8("button", { type: "button", onClick: () => void reload(), disabled: busy, style: primaryBtn(busy), children: t.refresh })
    ] });
  }
  return /* @__PURE__ */ jsxs8(Section, { "aria-label": t.title, children: [
    Header,
    /* @__PURE__ */ jsx8("p", { style: { margin: 0, fontSize: "0.8rem", lineHeight: 1.5, color: C.text2 }, children: t.description }),
    !canManage && /* @__PURE__ */ jsx8("p", { style: { margin: 0, fontSize: "0.72rem", color: C.text2, fontStyle: "italic" }, children: t.managerOnlyHint }),
    !seeded ? /* @__PURE__ */ jsx8(
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
    ) : /* @__PURE__ */ jsxs8(Fragment3, { children: [
      /* @__PURE__ */ jsx8(StatRow, { t, data }),
      /* @__PURE__ */ jsx8(
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
      /* @__PURE__ */ jsx8(
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
      /* @__PURE__ */ jsx8(
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
      /* @__PURE__ */ jsx8(
        TeachBox,
        {
          t,
          busy,
          validating,
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
          ),
          onValidate: () => runValidate(data?.teacherModel ? teachPrompt : teachPrompt.trim() || teachText)
        }
      ),
      validateResult && /* @__PURE__ */ jsx8(ValidateResults, { t, result: validateResult, onClear: clearValidate }),
      canManage && /* @__PURE__ */ jsxs8("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }, children: [
        /* @__PURE__ */ jsx8(
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
        (data?.pending ?? 0) > 0 && /* @__PURE__ */ jsxs8("span", { style: { fontSize: "0.74rem", color: C.text2 }, children: [
          t.pendingLabel,
          ": ",
          data?.pending
        ] })
      ] }),
      showRecent && /* @__PURE__ */ jsx8(RecentList, { t, entries: data?.recent ?? [] })
    ] }),
    notice && /* @__PURE__ */ jsx8("p", { style: { margin: 0, fontSize: "0.74rem", color: C.accent }, role: "status", children: notice }),
    error && /* @__PURE__ */ jsx8("p", { style: { margin: 0, fontSize: "0.76rem", color: C.danger }, role: "alert", children: error })
  ] });
}
function RegressionChip({ t, evalPoint }) {
  if (!evalPoint || !(evalPoint.baseLoss > 0)) return null;
  const frac = evalPoint.delta / evalPoint.baseLoss;
  const pct = Math.abs(frac) * 100;
  const tone = pct < 0.5 ? "flat" : frac > 0 ? "up" : "down";
  const arrow = tone === "up" ? "\u25B2" : tone === "down" ? "\u25BC" : "\u2248";
  const color = tone === "up" ? "#22c55e" : tone === "down" ? "#f87171" : C.text2;
  const label = tone === "flat" ? t.evalFlat : t.evalDelta(pct.toFixed(1));
  const title = t.evalTooltip(evalPoint.version, evalPoint.baseLoss.toFixed(3), evalPoint.newLoss.toFixed(3), evalPoint.evalSize);
  return /* @__PURE__ */ jsxs8(
    "span",
    {
      title,
      "aria-label": title,
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: 11,
        fontWeight: 700,
        color,
        border: `1px solid ${color}`,
        borderRadius: 999,
        padding: "2px 8px"
      },
      children: [
        /* @__PURE__ */ jsx8("span", { "aria-hidden": true, children: arrow }),
        label
      ]
    }
  );
}
function Section({ children, ...rest }) {
  return /* @__PURE__ */ jsx8(
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
  if (!canManage) return /* @__PURE__ */ jsx8("p", { style: italic, children: t.notSetUp });
  if (models.length === 0) return /* @__PURE__ */ jsx8("p", { style: italic, children: t.noModels });
  return /* @__PURE__ */ jsxs8("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: [
    /* @__PURE__ */ jsx8("label", { style: fieldLabel, children: t.pickModelLabel }),
    /* @__PURE__ */ jsxs8("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }, children: [
      /* @__PURE__ */ jsx8("select", { value: selectedSlug, onChange: (e) => onSelect(e.target.value), disabled: busy, style: { ...select, flex: "1 1 200px" }, children: models.map((m) => /* @__PURE__ */ jsx8("option", { value: m.slug, style: optionStyle, children: m.name }, m.slug)) }),
      /* @__PURE__ */ jsx8("button", { type: "button", onClick: onSeed, disabled: busy || !selectedSlug, style: primaryBtn(busy || !selectedSlug), children: busy ? t.working : t.enableCta })
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
  return /* @__PURE__ */ jsx8("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(88px, 1fr))", gap: 8 }, children: stats.map((s) => /* @__PURE__ */ jsxs8("div", { style: { background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px" }, children: [
    /* @__PURE__ */ jsx8("div", { style: { fontSize: "0.66rem", textTransform: "uppercase", letterSpacing: "0.04em", color: C.text2 }, children: s.label }),
    /* @__PURE__ */ jsx8("div", { style: { fontSize: "0.9rem", fontWeight: 700, color: C.text, marginTop: 2, wordBreak: "break-word" }, children: s.value })
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
  return /* @__PURE__ */ jsxs8("div", { style: { display: "flex", gap: 10, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }, children: [
    /* @__PURE__ */ jsxs8("div", { style: { flex: "1 1 200px", minWidth: 0 }, children: [
      /* @__PURE__ */ jsx8("div", { style: fieldTitle, children: label }),
      /* @__PURE__ */ jsx8("div", { style: fieldHint, children: hint })
    ] }),
    /* @__PURE__ */ jsx8(
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
  return /* @__PURE__ */ jsxs8("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [
    /* @__PURE__ */ jsxs8("div", { children: [
      /* @__PURE__ */ jsx8("div", { style: fieldTitle, children: t.teacherLabel }),
      /* @__PURE__ */ jsx8("div", { style: fieldHint, children: t.teacherHint })
    ] }),
    !canManage ? /* @__PURE__ */ jsx8("div", { style: { ...select, color: C.text2 }, children: value || t.teacherNone }) : opts && !opts.isPaid ? /* @__PURE__ */ jsx8("p", { style: italic, children: t.teacherPaidOnly }) : /* @__PURE__ */ jsxs8("select", { value, onChange: (e) => onChange(e.target.value), disabled: busy, "aria-label": t.teacherLabel, style: { ...select, maxWidth: 340 }, children: [
      /* @__PURE__ */ jsx8("option", { value: "", style: optionStyle, children: t.teacherNone }),
      options.map((m) => /* @__PURE__ */ jsx8("option", { value: m, style: optionStyle, children: m }, m))
    ] }),
    value && /* @__PURE__ */ jsx8("div", { style: { fontSize: "0.72rem", lineHeight: 1.4, color: C.accent, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px" }, children: t.teacherActiveHint(value) })
  ] });
}
function TeachBox({
  t,
  busy,
  validating,
  prompt,
  text,
  onPrompt,
  onText,
  onTeach,
  onValidate,
  teacherModel
}) {
  const teaching = !!teacherModel;
  const canTeach = teaching ? prompt.trim().length >= 20 : text.trim().length >= 20;
  const canValidate = (teaching ? prompt : prompt.trim() || text).trim().length >= 3;
  return /* @__PURE__ */ jsxs8("div", { style: { display: "flex", flexDirection: "column", gap: 6, borderTop: `1px solid ${C.border}`, paddingTop: 10 }, children: [
    /* @__PURE__ */ jsx8("div", { style: fieldTitle, children: teaching ? t.teachTeacherTitle : t.teachTitle }),
    /* @__PURE__ */ jsx8("div", { style: fieldHint, children: teaching ? t.teachTeacherHint(teacherModel) : t.teachHint }),
    teaching ? /* @__PURE__ */ jsx8("textarea", { value: prompt, onChange: (e) => onPrompt(e.target.value), disabled: busy, placeholder: t.teachTaskPlaceholder, rows: 3, style: { ...select, width: "100%", resize: "vertical", fontFamily: "inherit" } }) : /* @__PURE__ */ jsxs8(Fragment3, { children: [
      /* @__PURE__ */ jsx8("input", { value: prompt, onChange: (e) => onPrompt(e.target.value), disabled: busy, placeholder: t.teachPromptPlaceholder, style: { ...select, width: "100%" } }),
      /* @__PURE__ */ jsx8("textarea", { value: text, onChange: (e) => onText(e.target.value), disabled: busy, placeholder: t.teachTextPlaceholder, rows: 3, style: { ...select, width: "100%", resize: "vertical", fontFamily: "inherit" } })
    ] }),
    /* @__PURE__ */ jsxs8("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ jsx8("button", { type: "button", onClick: onTeach, disabled: busy || !canTeach, style: primaryBtn(busy || !canTeach), children: busy ? t.teaching : teaching ? t.teachTeacherCta : t.teachCta }),
      /* @__PURE__ */ jsx8("button", { type: "button", onClick: onValidate, disabled: busy || validating || !canValidate, style: secondaryBtn(busy || validating || !canValidate), title: t.validateHint, children: validating ? t.validating : t.validateCta })
    ] })
  ] });
}
function ValidateResults({ t, result, onClear }) {
  return /* @__PURE__ */ jsxs8("div", { style: { display: "flex", flexDirection: "column", gap: 6, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px" }, children: [
    /* @__PURE__ */ jsxs8("div", { style: { display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ jsx8("span", { style: { ...fieldTitle, flex: 1, minWidth: 0 }, children: t.validateResultTitle(result.prompt) }),
      /* @__PURE__ */ jsx8("span", { style: { fontSize: "0.64rem", fontWeight: 600, color: C.text2, border: `1px solid ${C.border}`, borderRadius: 999, padding: "1px 8px" }, children: t.validateMethod(result.method) }),
      /* @__PURE__ */ jsx8("button", { type: "button", onClick: onClear, style: { ...ghostBtn, marginLeft: 0 }, children: t.validateClear })
    ] }),
    result.matches.length === 0 ? /* @__PURE__ */ jsx8("p", { style: italic, children: t.validateEmpty }) : /* @__PURE__ */ jsx8("ul", { style: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }, children: result.matches.map((m) => {
      const primary = m.id === result.primaryId;
      const pct = Math.round(m.score * 100);
      return /* @__PURE__ */ jsxs8("li", { style: { display: "flex", flexDirection: "column", gap: 4, border: `1px solid ${primary ? C.accent : C.border}`, borderRadius: 6, padding: "6px 8px", background: C.surface }, children: [
        /* @__PURE__ */ jsxs8("div", { style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }, children: [
          primary && /* @__PURE__ */ jsx8("span", { style: tag(false), children: t.validatePrimaryBadge }),
          /* @__PURE__ */ jsx8("span", { style: { fontSize: "0.68rem", color: C.text2 }, children: t.versionTag(m.version) }),
          /* @__PURE__ */ jsx8("span", { style: { marginLeft: "auto", fontSize: "0.68rem", fontWeight: 700, color: C.accent }, children: t.validateScore(pct) })
        ] }),
        /* @__PURE__ */ jsx8("div", { style: { height: 4, borderRadius: 999, background: C.border, overflow: "hidden" }, children: /* @__PURE__ */ jsx8("div", { style: { width: `${pct}%`, height: "100%", background: C.accent } }) }),
        m.prompt && /* @__PURE__ */ jsx8("div", { style: { fontSize: "0.74rem", fontWeight: 600, color: C.text, wordBreak: "break-word" }, children: m.prompt }),
        m.text && /* @__PURE__ */ jsx8("div", { style: { fontSize: "0.72rem", color: C.text2, lineHeight: 1.4, wordBreak: "break-word", whiteSpace: "pre-wrap", maxHeight: 54, overflow: "hidden" }, children: m.text })
      ] }, m.id);
    }) })
  ] });
}
function RecentList({ t, entries }) {
  return /* @__PURE__ */ jsxs8("div", { style: { display: "flex", flexDirection: "column", gap: 6, borderTop: `1px solid ${C.border}`, paddingTop: 10 }, children: [
    /* @__PURE__ */ jsx8("div", { style: fieldTitle, children: t.inspectTitle }),
    entries.length === 0 ? /* @__PURE__ */ jsx8("p", { style: italic, children: t.inspectEmpty }) : /* @__PURE__ */ jsx8("ul", { style: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }, children: entries.map((e) => /* @__PURE__ */ jsx8(RecentRow, { t, entry: e }, e.id)) })
  ] });
}
function RecentRow({ t, entry }) {
  const [open, setOpen] = useState7(false);
  const body = entry.kind === "delta" ? t.deltaEntry : entry.text ?? "";
  const hasDetail = entry.kind !== "delta" && (!!entry.prompt || !!entry.text);
  return /* @__PURE__ */ jsxs8("li", { style: { background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 3 }, children: [
    /* @__PURE__ */ jsxs8("div", { style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ jsx8("span", { style: tag(entry.kind === "delta"), children: entry.kind === "delta" ? t.kindDelta : t.kindText }),
      /* @__PURE__ */ jsx8("span", { style: { fontSize: "0.68rem", color: C.text2 }, children: t.versionTag(entry.version) }),
      /* @__PURE__ */ jsx8("span", { style: { fontSize: "0.68rem", color: C.text2 }, children: t.weightTag(entry.weight) }),
      /* @__PURE__ */ jsx8("span", { style: { marginLeft: "auto", fontSize: "0.68rem", color: C.text2 }, children: t.formatWhen(entry.at) })
    ] }),
    entry.prompt && /* @__PURE__ */ jsx8("div", { style: { fontSize: "0.76rem", fontWeight: 600, color: C.text, wordBreak: "break-word" }, children: entry.prompt }),
    open ? /* @__PURE__ */ jsx8("div", { style: { display: "flex", flexDirection: "column", gap: 6, marginTop: 2 }, children: entry.text && /* @__PURE__ */ jsxs8("div", { children: [
      /* @__PURE__ */ jsx8("div", { style: { fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.04em", color: C.text2 }, children: t.detailTextLabel }),
      /* @__PURE__ */ jsx8("div", { style: { fontSize: "0.74rem", color: C.text, lineHeight: 1.5, wordBreak: "break-word", whiteSpace: "pre-wrap" }, children: entry.text })
    ] }) }) : body && /* @__PURE__ */ jsx8("div", { style: { fontSize: "0.74rem", color: C.text2, lineHeight: 1.45, wordBreak: "break-word", whiteSpace: "pre-wrap", maxHeight: 72, overflow: "hidden" }, children: body }),
    hasDetail && /* @__PURE__ */ jsx8("button", { type: "button", onClick: () => setOpen((v) => !v), style: { ...linkBtn, alignSelf: "flex-start" }, children: open ? t.hideDetail : t.viewDetail })
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
function secondaryBtn(disabled) {
  return {
    padding: "8px 14px",
    fontSize: "0.8rem",
    fontWeight: 600,
    borderRadius: 8,
    border: `1px solid ${C.border}`,
    background: "transparent",
    color: disabled ? C.text2 : C.text,
    cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
    opacity: disabled ? 0.7 : 1
  };
}
var linkBtn = {
  padding: 0,
  fontSize: "0.7rem",
  fontWeight: 600,
  border: "none",
  background: "transparent",
  color: C.accent,
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
import { useMemo as useMemo8, useState as useState8 } from "react";

// src/project360/Sunburst.tsx
import { jsx as jsx9, jsxs as jsxs9 } from "react/jsx-runtime";
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
  return /* @__PURE__ */ jsxs9(
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
          return /* @__PURE__ */ jsxs9("g", { children: [
            /* @__PURE__ */ jsx9(
              "path",
              {
                d: sector(R_INNER_0, R_INNER_1, pStart + 0.6, pEnd - 0.6),
                fill: pillar.color,
                fillOpacity: 0.9,
                className: "bf-360-arc bf-360-arc--pillar"
              }
            ),
            /* @__PURE__ */ jsx9(
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
              return /* @__PURE__ */ jsxs9(
                "g",
                {
                  className: "bf-360-arc-group",
                  onClick: () => onSelect?.(isSel ? null : dim.key),
                  role: "button",
                  "aria-pressed": isSel,
                  "aria-label": `${dim.label}: ${dim.score} of 100`,
                  children: [
                    /* @__PURE__ */ jsx9(
                      "path",
                      {
                        d: sector(R_OUTER_0, R_OUTER_1, dStart + 0.6, dEnd - 0.6),
                        fill: dim.color,
                        fillOpacity: isSel ? 1 : 0.82,
                        className: `bf-360-arc bf-360-arc--dim${isSel ? " is-selected" : ""}`
                      }
                    ),
                    /* @__PURE__ */ jsx9(
                      "text",
                      {
                        x: lab.x,
                        y: lab.y,
                        className: "bf-360-arc-label",
                        textAnchor: "middle",
                        dominantBaseline: "central",
                        children: lines.map((ln, li) => /* @__PURE__ */ jsx9("tspan", { x: lab.x, dy: li === 0 ? lines.length > 1 ? "-0.5em" : "0" : "1em", children: ln }, li))
                      }
                    )
                  ]
                },
                dim.key
              );
            })
          ] }, pillar.key);
        }),
        /* @__PURE__ */ jsx9("circle", { cx: CX, cy: CY, r: R_CENTER, className: "bf-360-center", onClick: () => onSelect?.(null), role: "button", "aria-label": "Clear selection" }),
        /* @__PURE__ */ jsx9("circle", { cx: CX, cy: CY, r: R_CENTER, fill: "none", stroke: overall.color, strokeWidth: 3, className: "bf-360-center-ring" }),
        /* @__PURE__ */ jsx9("text", { x: CX, y: CY - 8, className: "bf-360-center-score", textAnchor: "middle", dominantBaseline: "central", fill: overall.color, children: overall.score }),
        /* @__PURE__ */ jsx9("text", { x: CX, y: CY + 14, className: "bf-360-center-label", textAnchor: "middle", dominantBaseline: "central", children: "HEALTH" })
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
import { Fragment as Fragment4, jsx as jsx10, jsxs as jsxs10 } from "react/jsx-runtime";
var STATUS_ORDER = ["working", "awaiting", "blocked", "idle", "available"];
function Project360View({ data, loading, error, labels, onAction, onRefresh }) {
  const L = useMemo8(() => ({ ...DEFAULT_PROJECT360_LABELS, ...labels ?? {} }), [labels]);
  const [selected, setSelected] = useState8(null);
  const sortedWorkforce = useMemo8(
    () => [...data?.workforce ?? []].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)),
    [data?.workforce]
  );
  if (error) {
    return /* @__PURE__ */ jsxs10("div", { className: "bf-360-state", children: [
      /* @__PURE__ */ jsx10("div", { className: "bf-360-state__title", children: L.loadError }),
      /* @__PURE__ */ jsx10("div", { className: "bf-360-state__hint", children: error }),
      onRefresh && /* @__PURE__ */ jsx10("button", { className: "bf-btn", onClick: onRefresh, children: L.refresh })
    ] });
  }
  if (!data || loading) {
    return /* @__PURE__ */ jsxs10("div", { className: "bf-360-state", children: [
      /* @__PURE__ */ jsx10("div", { className: "bf-360-spinner" }),
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
  return /* @__PURE__ */ jsxs10("div", { className: "bf-360", children: [
    /* @__PURE__ */ jsxs10("header", { className: "bf-360-head", children: [
      /* @__PURE__ */ jsxs10("div", { className: "bf-360-head__id", children: [
        /* @__PURE__ */ jsx10("span", { className: "bf-360-head__title", children: project.name }),
        project.key && /* @__PURE__ */ jsx10("span", { className: "bf-360-head__key", children: project.key })
      ] }),
      /* @__PURE__ */ jsx10("div", { className: "bf-360-head__spacer" }),
      /* @__PURE__ */ jsx10("button", { className: "bf-btn", onClick: () => onAction?.({ kind: "board", label: L.openBoard }), children: L.openBoard }),
      gaps.length > 0 && /* @__PURE__ */ jsx10("button", { className: "bf-btn bf-btn--primary", onClick: improveAll, children: L.improveAll }),
      onRefresh && /* @__PURE__ */ jsx10("button", { className: "bf-btn bf-btn--icon", title: L.refresh, "aria-label": L.refresh, onClick: onRefresh, children: "\u27F3" })
    ] }),
    !hasData ? /* @__PURE__ */ jsxs10("div", { className: "bf-360-state", children: [
      /* @__PURE__ */ jsx10("div", { className: "bf-360-state__title", children: L.noData }),
      /* @__PURE__ */ jsx10("div", { className: "bf-360-state__hint", children: L.noDataHint }),
      /* @__PURE__ */ jsx10("button", { className: "bf-btn", onClick: () => onAction?.({ kind: "board", label: L.openBoard }), children: L.openBoard })
    ] }) : /* @__PURE__ */ jsxs10("div", { className: "bf-360-grid", children: [
      /* @__PURE__ */ jsxs10("section", { className: "bf-360-col bf-360-col--wheel", children: [
        /* @__PURE__ */ jsx10(
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
        /* @__PURE__ */ jsxs10("div", { className: "bf-360-overall", children: [
          /* @__PURE__ */ jsx10("div", { className: "bf-360-progress", "aria-label": `${L.progress} ${overall.progressPct}%`, children: /* @__PURE__ */ jsx10("div", { className: "bf-360-progress__fill", style: { width: `${overall.progressPct}%`, background: overall.color } }) }),
          /* @__PURE__ */ jsxs10("div", { className: "bf-360-progress__label", children: [
            L.progress,
            ": ",
            overall.progressPct,
            "%"
          ] }),
          /* @__PURE__ */ jsxs10("div", { className: "bf-360-counts", children: [
            /* @__PURE__ */ jsx10(Count, { n: counts.open, label: L.counts_open }),
            /* @__PURE__ */ jsx10(Count, { n: counts.blocked, label: L.counts_blocked, tone: counts.blocked ? "warn" : void 0 }),
            /* @__PURE__ */ jsx10(Count, { n: counts.overdue, label: L.counts_overdue, tone: counts.overdue ? "bad" : void 0 }),
            /* @__PURE__ */ jsx10(Count, { n: counts.activeRuns, label: L.counts_running, tone: counts.activeRuns ? "good" : void 0 })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxs10("section", { className: "bf-360-col bf-360-col--detail", children: [
        /* @__PURE__ */ jsxs10("div", { className: "bf-360-legend-head", children: [
          /* @__PURE__ */ jsx10("span", { children: selectedDim ? selectedDim.label : L.allDimensions }),
          selectedDim && /* @__PURE__ */ jsxs10("button", { className: "bf-360-clear", onClick: () => setSelected(null), children: [
            L.allDimensions,
            " \u2715"
          ] })
        ] }),
        selectedDim ? /* @__PURE__ */ jsxs10("div", { className: "bf-360-dim-detail", children: [
          /* @__PURE__ */ jsx10(ScoreDot, { score: selectedDim.score, color: selectedDim.color }),
          /* @__PURE__ */ jsx10("div", { className: "bf-360-dim-detail__summary", children: selectedDim.summary })
        ] }) : /* @__PURE__ */ jsx10("ul", { className: "bf-360-dim-list", children: dimensions.map((d) => /* @__PURE__ */ jsx10("li", { children: /* @__PURE__ */ jsxs10(
          "button",
          {
            className: "bf-360-dim-row",
            onClick: () => setSelected(d.key),
            children: [
              /* @__PURE__ */ jsx10(ScoreDot, { score: d.score, color: d.color }),
              /* @__PURE__ */ jsx10("span", { className: "bf-360-dim-row__label", children: d.label }),
              /* @__PURE__ */ jsx10("span", { className: "bf-360-dim-row__summary", children: d.summary })
            ]
          }
        ) }, d.key)) })
      ] })
    ] }),
    hasData && /* @__PURE__ */ jsxs10(Fragment4, { children: [
      /* @__PURE__ */ jsxs10("section", { className: "bf-360-section", children: [
        /* @__PURE__ */ jsxs10("h3", { className: "bf-360-section__title", children: [
          L.missingItems,
          shownGaps.length > 0 && /* @__PURE__ */ jsx10("span", { className: "bf-360-section__count", children: shownGaps.length })
        ] }),
        shownGaps.length === 0 ? /* @__PURE__ */ jsx10("p", { className: "bf-360-empty", children: L.noGaps }) : /* @__PURE__ */ jsx10("ul", { className: "bf-360-gaps", children: shownGaps.map((g) => /* @__PURE__ */ jsx10(GapRow, { gap: g, onAction }, g.id)) })
      ] }),
      /* @__PURE__ */ jsxs10("section", { className: "bf-360-section", children: [
        /* @__PURE__ */ jsxs10("h3", { className: "bf-360-section__title", children: [
          L.workforce,
          workforce.length > 0 && /* @__PURE__ */ jsx10("span", { className: "bf-360-section__count", children: workforce.length })
        ] }),
        workforce.length === 0 ? /* @__PURE__ */ jsx10("p", { className: "bf-360-empty", children: L.noWorkforce }) : /* @__PURE__ */ jsx10("ul", { className: "bf-360-people", children: sortedWorkforce.map((m) => /* @__PURE__ */ jsx10(MemberRow, { member: m, labels: L, onAction }, m.ref)) })
      ] })
    ] })
  ] });
}
function Count({ n, label, tone }) {
  return /* @__PURE__ */ jsxs10("span", { className: `bf-360-count${tone ? ` bf-360-count--${tone}` : ""}`, children: [
    /* @__PURE__ */ jsx10("b", { children: n }),
    " ",
    label
  ] });
}
function ScoreDot({ score, color }) {
  return /* @__PURE__ */ jsx10("span", { className: "bf-360-scoredot", style: { borderColor: color, color }, children: score });
}
function GapRow({ gap, onAction }) {
  return /* @__PURE__ */ jsxs10("li", { className: `bf-360-gap bf-360-gap--${gap.severity}`, children: [
    /* @__PURE__ */ jsx10("span", { className: `bf-360-sev bf-360-sev--${gap.severity}`, "aria-hidden": true }),
    /* @__PURE__ */ jsxs10("div", { className: "bf-360-gap__body", children: [
      /* @__PURE__ */ jsx10("div", { className: "bf-360-gap__title", children: gap.title }),
      gap.detail && /* @__PURE__ */ jsx10("div", { className: "bf-360-gap__detail", children: gap.detail })
    ] }),
    gap.action && /* @__PURE__ */ jsx10("button", { className: "bf-btn bf-360-gap__cta", onClick: () => onAction?.(gap.action), children: gap.action.label })
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
  return /* @__PURE__ */ jsxs10("li", { className: "bf-360-person", children: [
    /* @__PURE__ */ jsx10("span", { className: `bf-360-dot bf-360-dot--${member.status}`, title: statusLabel, "aria-label": statusLabel }),
    /* @__PURE__ */ jsxs10("div", { className: "bf-360-person__body", children: [
      /* @__PURE__ */ jsxs10("div", { className: "bf-360-person__top", children: [
        /* @__PURE__ */ jsx10("span", { className: "bf-360-person__name", children: member.name }),
        /* @__PURE__ */ jsx10("span", { className: `bf-360-kind bf-360-kind--${member.kind}`, children: member.kind }),
        /* @__PURE__ */ jsx10("span", { className: "bf-360-person__status", children: statusLabel })
      ] }),
      /* @__PURE__ */ jsx10("div", { className: "bf-360-person__reason", children: member.reason })
    ] }),
    task && /* @__PURE__ */ jsxs10("div", { className: "bf-360-person__actions", children: [
      (member.status === "idle" || member.status === "available") && member.kind !== "human" && /* @__PURE__ */ jsx10("button", { className: "bf-btn bf-360-person__btn", onClick: () => onAction?.({ kind: "run-task", label: labels.member_run, task }), children: labels.member_run }),
      /* @__PURE__ */ jsx10("button", { className: "bf-btn bf-360-person__btn", onClick: () => onAction?.({ kind: "open-task", label: labels.member_open, task }), children: labels.member_open })
    ] })
  ] });
}

// src/projectList/ProjectListView.tsx
import { useMemo as useMemo9 } from "react";

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
import { jsx as jsx11, jsxs as jsxs11 } from "react/jsx-runtime";
function ProjectListView({ title, subtitle, data, loading, error, labels, onAction, onRefresh }) {
  const L = useMemo9(() => ({ ...DEFAULT_PROJECT_LIST_LABELS, ...labels ?? {} }), [labels]);
  const header = /* @__PURE__ */ jsxs11("header", { className: "bf-list-head", children: [
    /* @__PURE__ */ jsxs11("div", { className: "bf-list-head__id", children: [
      /* @__PURE__ */ jsx11("span", { className: "bf-list-head__title", children: title }),
      data && /* @__PURE__ */ jsxs11("span", { className: "bf-list-head__count", children: [
        data.total,
        " ",
        L.items
      ] })
    ] }),
    subtitle && /* @__PURE__ */ jsx11("div", { className: "bf-list-head__sub", children: subtitle }),
    /* @__PURE__ */ jsx11("div", { className: "bf-list-head__spacer" }),
    onRefresh && /* @__PURE__ */ jsx11("button", { className: "bf-btn bf-btn--icon", title: L.refresh, "aria-label": L.refresh, onClick: onRefresh, children: "\u27F3" })
  ] });
  if (error) {
    return /* @__PURE__ */ jsxs11("div", { className: "bf-list", children: [
      header,
      /* @__PURE__ */ jsxs11("div", { className: "bf-360-state", children: [
        /* @__PURE__ */ jsx11("div", { className: "bf-360-state__title", children: L.loadError }),
        /* @__PURE__ */ jsx11("div", { className: "bf-360-state__hint", children: error }),
        onRefresh && /* @__PURE__ */ jsx11("button", { className: "bf-btn", onClick: onRefresh, children: L.refresh })
      ] })
    ] });
  }
  if (!data || loading) {
    return /* @__PURE__ */ jsxs11("div", { className: "bf-list", children: [
      header,
      /* @__PURE__ */ jsxs11("div", { className: "bf-360-state", children: [
        /* @__PURE__ */ jsx11("div", { className: "bf-360-spinner" }),
        L.connecting
      ] })
    ] });
  }
  if (data.total === 0) {
    return /* @__PURE__ */ jsxs11("div", { className: "bf-list", children: [
      header,
      /* @__PURE__ */ jsxs11("div", { className: "bf-360-state", children: [
        /* @__PURE__ */ jsx11("div", { className: "bf-360-state__title", children: L.empty }),
        L.emptyHint && /* @__PURE__ */ jsx11("div", { className: "bf-360-state__hint", children: L.emptyHint })
      ] })
    ] });
  }
  return /* @__PURE__ */ jsxs11("div", { className: "bf-list", children: [
    header,
    data.groups.filter((g) => g.items.length > 0).map((g) => /* @__PURE__ */ jsxs11("section", { className: "bf-list-group", children: [
      /* @__PURE__ */ jsxs11("h3", { className: "bf-list-group__title", children: [
        /* @__PURE__ */ jsx11("span", { className: `bf-list-group__dot bf-list-tone--${g.tone ?? "default"}`, "aria-hidden": true }),
        g.label,
        /* @__PURE__ */ jsx11("span", { className: "bf-360-section__count", children: g.items.length })
      ] }),
      /* @__PURE__ */ jsx11("ul", { className: "bf-list-rows", children: g.items.map((it) => /* @__PURE__ */ jsx11(Row, { item: it, onAction }, it.id)) })
    ] }, g.key))
  ] });
}
function Row({ item, onAction }) {
  const act = item.action;
  const clickable = !!act && !!onAction;
  return /* @__PURE__ */ jsx11("li", { className: "bf-list-row", children: /* @__PURE__ */ jsxs11(
    "button",
    {
      className: "bf-list-row__main",
      disabled: !clickable,
      onClick: clickable ? () => onAction(act) : void 0,
      title: clickable ? act.label : void 0,
      children: [
        item.key && /* @__PURE__ */ jsx11("span", { className: "bf-list-row__key", children: item.key }),
        /* @__PURE__ */ jsxs11("span", { className: "bf-list-row__body", children: [
          /* @__PURE__ */ jsx11("span", { className: "bf-list-row__title", children: item.title }),
          item.subtitle && /* @__PURE__ */ jsx11("span", { className: "bf-list-row__sub", children: item.subtitle })
        ] }),
        item.badges && item.badges.length > 0 && /* @__PURE__ */ jsx11("span", { className: "bf-list-row__badges", children: item.badges.map((b, i) => /* @__PURE__ */ jsx11("span", { className: `bf-list-badge bf-list-tone--${b.tone ?? "default"}`, children: b.label }, i)) })
      ]
    }
  ) });
}
export {
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
};
//# sourceMappingURL=index.mjs.map