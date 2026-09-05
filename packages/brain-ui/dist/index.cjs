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
  BUILDERFORCE_PRODUCT_NAME: () => import_builderforce_brain_embedded6.BUILDERFORCE_PRODUCT_NAME,
  BrainTimeline: () => BrainTimeline,
  ChatErrorBanner: () => ChatErrorBanner,
  ChatTicketsPanel: () => ChatTicketsPanel,
  DEFAULT_ASK_USER_LABELS: () => DEFAULT_ASK_USER_LABELS,
  DEFAULT_CHAT_ERROR_LABELS: () => DEFAULT_CHAT_ERROR_LABELS,
  DEFAULT_CHAT_TICKETS_LABELS: () => DEFAULT_CHAT_TICKETS_LABELS,
  DEFAULT_EVERMIND_LABELS: () => DEFAULT_EVERMIND_LABELS,
  DEFAULT_LIVE_ACTIVITY_LABELS: () => DEFAULT_LIVE_ACTIVITY_LABELS,
  DEFAULT_MODEL_IDENTITY: () => import_builderforce_brain_embedded6.DEFAULT_MODEL_IDENTITY,
  DEFAULT_PENDING_CHANGES_LABELS: () => DEFAULT_PENDING_CHANGES_LABELS,
  DEFAULT_PROJECT360_LABELS: () => DEFAULT_PROJECT360_LABELS,
  DEFAULT_PROJECT_LIST_LABELS: () => DEFAULT_PROJECT_LIST_LABELS,
  DEFAULT_PROMPT_OPTIONS_LABELS: () => DEFAULT_PROMPT_OPTIONS_LABELS,
  DEFAULT_TIMELINE_LABELS: () => DEFAULT_TIMELINE_LABELS,
  EvermindConsole: () => EvermindConsole,
  HealthRing: () => HealthRing,
  LiveActivity: () => LiveActivity,
  MODEL_CATEGORIES: () => import_builderforce_brain_embedded6.MODEL_CATEGORIES,
  Markdown: () => Markdown,
  PROJECT_EVERMIND_MODEL_PREFIX: () => import_builderforce_brain_embedded6.PROJECT_EVERMIND_MODEL_PREFIX,
  ParticipantBadge: () => ParticipantBadge,
  PendingChangesBar: () => PendingChangesBar,
  PendingQuestionBanner: () => PendingQuestionBanner,
  Project360View: () => Project360View,
  ProjectListView: () => ProjectListView,
  PromptOptionsMenu: () => PromptOptionsMenu,
  PromptPanel: () => PromptPanel,
  QuestionCard: () => QuestionCard,
  RUNNABLE_KINDS: () => RUNNABLE_KINDS,
  SLOW_AFTER_MS: () => SLOW_AFTER_MS,
  Sunburst: () => Sunburst,
  TICKET_KINDS: () => TICKET_KINDS,
  activeModelKey: () => import_builderforce_brain_embedded6.activeModelKey,
  askUserAnchorId: () => askUserAnchorId,
  attachmentsOf: () => attachmentsOf,
  avatarColor: () => avatarColor,
  buildModelItems: () => import_builderforce_brain_embedded6.buildModelItems,
  buildSettledTimeline: () => buildSettledTimeline,
  buildTimeline: () => buildTimeline,
  byoVendorLabel: () => import_builderforce_brain_embedded6.byoVendorLabel,
  displayModelName: () => import_builderforce_brain_embedded6.displayModelName,
  evermindLearnedStatus: () => evermindLearnedStatus,
  evermindNextAction: () => evermindNextAction,
  filterModelItems: () => import_builderforce_brain_embedded6.filterModelItems,
  formatDuration: () => formatDuration,
  formatElapsed: () => formatElapsed,
  formatPayload: () => formatPayload,
  healthRingColor: () => healthRingColor,
  initialsOf: () => initialsOf,
  modelCategoryLabel: () => import_builderforce_brain_embedded6.modelCategoryLabel,
  modelInUse: () => import_builderforce_brain_embedded6.modelInUse,
  parseAskUser: () => parseAskUser,
  perMillionUsd: () => import_builderforce_brain_embedded6.perMillionUsd,
  premiumCostLabel: () => import_builderforce_brain_embedded6.premiumCostLabel,
  productForPlan: () => import_builderforce_brain_embedded6.productForPlan,
  productModelName: () => import_builderforce_brain_embedded6.productModelName,
  promptOptionsLabels: () => promptOptionsLabels,
  revealsModelId: () => import_builderforce_brain_embedded6.revealsModelId,
  selectPendingAskUser: () => selectPendingAskUser,
  serializeAskUser: () => serializeAskUser,
  splitThinkSegments: () => splitThinkSegments,
  streamingNode: () => streamingNode,
  stripAskUser: () => stripAskUser,
  useChatParticipants: () => useChatParticipants,
  useMentionAutocomplete: () => useMentionAutocomplete
});
module.exports = __toCommonJS(src_exports);

// src/BrainTimeline.tsx
var import_react4 = __toESM(require("react"), 1);
var import_builderforce_brain_embedded2 = require("@seanhogg/builderforce-brain-embedded");

// src/Markdown.tsx
var import_react = __toESM(require("react"), 1);
var import_react_markdown = __toESM(require("react-markdown"), 1);
var import_remark_gfm = __toESM(require("remark-gfm"), 1);

// src/thinkBlocks.ts
function splitThinkSegments(content) {
  if (!/<\/?think\s*>/i.test(content)) return [{ kind: "answer", content }];
  const segments = [];
  const tags = /<\/?think\s*>/gi;
  let kind = "answer";
  let offset = 0;
  let match;
  const push = (end) => {
    const value = content.slice(offset, end).trim();
    if (value) segments.push({ kind, content: value });
  };
  while ((match = tags.exec(content)) !== null) {
    push(match.index);
    kind = match[0].startsWith("</") ? "answer" : "thought";
    offset = match.index + match[0].length;
  }
  push(content.length);
  if (segments.length === 0) return [{ kind: "answer", content }];
  return promoteSwallowedAnswer(segments);
}
var MAX_FRAGMENT_CHARS = 40;
var REPLY_OPENER = /^[A-Z0-9#*\-_>`[|("']/;
function isFragment(text) {
  return text.length > 0 && text.length <= MAX_FRAGMENT_CHARS && !REPLY_OPENER.test(text);
}
function promoteSwallowedAnswer(segments) {
  const answers = segments.filter((s) => s.kind === "answer");
  if (answers.length === 0) return segments;
  const answerText = answers.map((s) => s.content).join(" ").trim();
  if (!isFragment(answerText)) return segments;
  const thoughts = segments.filter((s) => s.kind === "thought");
  const richest = thoughts.reduce(
    (best, s) => !best || s.content.length > best.content.length ? s : best,
    null
  );
  if (!richest || richest.content.length <= answerText.length) return segments;
  const promoted = [{ kind: "answer", content: `${richest.content} ${answerText}`.trim() }];
  for (const s of thoughts) if (s !== richest) promoted.unshift(s);
  return promoted;
}

// src/Markdown.tsx
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
  const segments = (0, import_react.useMemo)(() => splitThinkSegments(content), [content]);
  const components = {
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
      const { className, children } = props;
      const raw = String(children ?? "");
      const text = raw.replace(/\n$/, "");
      const isBlock = className != null || raw.endsWith("\n");
      if (!isBlock) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { className: "bf-md__inline", children });
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CodeBlock, { code: text, onApplyCode, onCreateFile, labels: lab });
    },
    pre({ children }) {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children });
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bf-md", children: segments.map((segment, index) => segment.kind === "thought" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { className: "bf-md__think", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: "Thought" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bf-md__think-body", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_react_markdown.default, { remarkPlugins: [import_remark_gfm.default], components, children: segment.content }) })
  ] }, `${segment.kind}-${index}`) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_react_markdown.default, { remarkPlugins: [import_remark_gfm.default], components, children: segment.content }, `${segment.kind}-${index}`)) });
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
  askAnswered: "Answered",
  askPending: "Answer needed",
  askJumpTo: "Show in conversation"
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
function askUserAnchorId(messageId) {
  return `bf-ask-${messageId}`;
}
function selectPendingAskUser(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") return null;
    if (msg.role !== "assistant") continue;
    const payload = parseAskUser(msg.content);
    if (payload) return { payload, messageId: msg.id };
  }
  return null;
}
function QuestionCard({
  payload,
  labels,
  onAnswer,
  anchorId
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
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { id: anchorId, className: `bf-qcard${answered ? " bf-qcard--done" : ""}`, role: "group", "aria-label": payload.question, children: [
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
function PendingQuestionBanner({
  payload,
  labels,
  onAnswer,
  onReveal
}) {
  const lab = (0, import_react2.useMemo)(() => ({ ...DEFAULT_ASK_USER_LABELS, ...labels }), [labels]);
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "bf-qpend", role: "region", "aria-label": lab.askPending, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "bf-qpend__bar", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "bf-qpend__badge", children: lab.askPending }),
      onReveal && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "bf-qpend__jump", onClick: onReveal, children: lab.askJumpTo })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(QuestionCard, { payload, labels: lab, onAnswer })
  ] });
}

// src/timelineModel.ts
var import_builderforce_brain_embedded = require("@seanhogg/builderforce-brain-embedded");
var LEARN_SKIP_REASONS = ["not-attached", "not-seeded", "frozen"];
function isLearnSkipReason(v) {
  return typeof v === "string" && LEARN_SKIP_REASONS.includes(v);
}
var ORDER = {
  user: 0,
  recall: 1,
  thinking: 2,
  assistant: 3,
  // An activity line reports what happened AFTER the turn that triggered it, so it sorts
  // with the tool steps rather than ahead of the narration.
  activity: 4,
  tool: 4,
  learn: 5,
  reconcile: 6,
  error: 7,
  streaming: 8
};
var TRACE_RANK = ORDER.tool;
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
      const skipped = r.skipped && isLearnSkipReason(r.reason) ? r.reason : void 0;
      const targets = Array.isArray(r.targets) ? r.targets : void 0;
      return { key, kind: "learn", ts, order: ORDER.learn, version: typeof r.version === "number" ? r.version : 0, ...skipped ? { skipped } : {}, ...targets ? { targets } : {} };
    }
    case "reconcile": {
      const r = step.result ?? {};
      return { key, kind: "reconcile", ts, order: ORDER.reconcile, version: typeof r.version === "number" ? r.version : 0, count: typeof r.count === "number" ? r.count : 0 };
    }
    default:
      return null;
  }
}
function buildSettledTimeline(messages, trace) {
  const nodes = [];
  const traceStepSigs = /* @__PURE__ */ new Set();
  for (const ev of trace) {
    if (ev.category !== "llm" && ev.category !== "message") traceStepSigs.add((0, import_builderforce_brain_embedded.stepSig)(ev.category, ev.label, ev.ts));
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
    } else if ((0, import_builderforce_brain_embedded.isStepMessage)(message)) {
      const parsed = (0, import_builderforce_brain_embedded.parseStepMessage)(message.metadata);
      if (!parsed) return;
      if (traceStepSigs.has((0, import_builderforce_brain_embedded.stepSig)(parsed.step.category, parsed.step.label, parsed.tsIso))) return;
      const node = stepNode(parsed.step, parseTs(parsed.tsIso, ts), `msg-${message.id}`);
      if (node) nodes.push(node);
    } else {
      const activity = (0, import_builderforce_brain_embedded.parseChatActivity)(message);
      if (activity) {
        nodes.push({
          key: `msg-${message.id}`,
          kind: "activity",
          ts,
          order: ORDER.activity,
          message,
          activity,
          // Pre-structured rows carry only the server's English sentence; showing it
          // beats showing nothing, so it rides along as the fallback.
          fallbackText: message.content
        });
        return;
      }
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
  const messageNodeCount = nodes.length;
  let step = 0;
  trace.forEach((ev, i) => {
    const ts = parseTs(ev.ts, 1e15 + i);
    if (ev.category === "llm") {
      nodes.push({ key: `trace-${i}`, kind: "thinking", ts, order: ORDER.thinking, durationMs: ev.ttftMs ?? ev.durationMs, step: step++ });
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
  const rank = (n, i) => i < messageNodeCount ? n.order : TRACE_RANK;
  return nodes.map((node, i) => ({ node, i, rank: rank(node, i) })).sort((a, b) => a.node.ts - b.node.ts || a.rank - b.rank || a.i - b.i).map((e) => e.node);
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

// src/LiveActivity.tsx
var import_react3 = __toESM(require("react"), 1);
var import_jsx_runtime4 = require("react/jsx-runtime");
var SLOW_AFTER_MS = 12e3;
var TICK_MS = 1e3;
var DEFAULT_LIVE_ACTIVITY_LABELS = {
  starting: "Starting\u2026",
  thinking: "Thinking\u2026",
  writing: "Writing the reply\u2026",
  tool: "Running {tool}",
  awaiting: "Waiting for you to approve {tool}",
  finishing: "Wrapping up\u2026",
  on: " on {target}",
  step: "step {step}",
  slow: "Still working \u2014 {elapsed} elapsed",
  ariaLabel: "Current activity"
};
function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1e3));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}
var PHASE_GLYPH = {
  starting: "\u25C7",
  thinking: "\u25CD",
  writing: "\u258D",
  tool: "\u27F3",
  awaiting: "\u23F8",
  finishing: "\u25C6"
};
function phaseLine(activity, labels) {
  const tool = activity.label ?? "";
  const base = activity.phase === "starting" ? labels.starting : activity.phase === "thinking" ? labels.thinking : activity.phase === "writing" ? labels.writing : activity.phase === "finishing" ? labels.finishing : activity.phase === "awaiting" ? labels.awaiting.replace("{tool}", tool) : labels.tool.replace("{tool}", tool);
  return activity.detail ? `${base}${labels.on.replace("{target}", activity.detail)}` : base;
}
function LiveActivityInner({ activity, isRunning, labels: partial }) {
  const labels = { ...DEFAULT_LIVE_ACTIVITY_LABELS, ...partial };
  const [fallbackStart, setFallbackStart] = (0, import_react3.useState)(() => isRunning ? Date.now() : null);
  (0, import_react3.useEffect)(() => {
    setFallbackStart((prev) => isRunning ? prev ?? Date.now() : null);
  }, [isRunning]);
  const live = activity ?? (isRunning && fallbackStart != null ? { phase: "starting", startedAt: fallbackStart, step: 0 } : null);
  const [now, setNow] = (0, import_react3.useState)(() => Date.now());
  const startedAt = live?.startedAt;
  (0, import_react3.useEffect)(() => {
    if (startedAt == null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [startedAt]);
  if (!live) return null;
  const elapsed = Math.max(0, now - live.startedAt);
  const slow = elapsed >= SLOW_AFTER_MS;
  const waiting = live.phase === "awaiting";
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
    "li",
    {
      className: `bf-tl__item bf-tl__item--live bf-tl__item--live-${live.phase}`,
      "aria-live": "polite",
      "aria-label": labels.ariaLabel,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: `bf-tl__dot ${waiting ? "bf-tl__dot--muted" : "bf-tl__dot--working"}`, "aria-hidden": true, children: PHASE_GLYPH[live.phase] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bf-tl__body", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bf-tl__live-head", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: `bf-tl__live-line${waiting ? "" : " bf-tl__live-line--shimmer"}`, children: phaseLine(live, labels) }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__live-elapsed", children: formatElapsed(elapsed) }),
            live.step > 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__live-step", children: labels.step.replace("{step}", String(live.step)) })
          ] }),
          !waiting && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__live-bar", "aria-hidden": true, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__live-bar-fill" }) }),
          slow && !waiting && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "bf-tl__live-slow", children: labels.slow.replace("{elapsed}", formatElapsed(elapsed)) })
        ] })
      ]
    }
  );
}
var LiveActivity = import_react3.default.memo(LiveActivityInner);

// src/BrainTimeline.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
var DEFAULT_TIMELINE_LABELS = {
  thinking: "Thinking\u2026",
  live: DEFAULT_LIVE_ACTIVITY_LABELS,
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
  replay: "Send again",
  rateUp: "Good response",
  rateDown: "Bad response",
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
  learnSkippedTitle: "Not learned this turn \u2014 {reason}",
  learnSkippedHint: "This turn wasn't contributed to the project Evermind. \u201CLearning \u2014 Connected\u201D reflects the selected project's model, not whether this chat feeds it.",
  learnSkipReason: {
    "not-attached": "this chat isn\u2019t attached to a project",
    "not-seeded": "this project has no Evermind model yet",
    frozen: "this project\u2019s Evermind is frozen (read-only)"
  },
  learnTargetContributed: "Contributed to {name} (project #{projectId} v{version})",
  learnTargetSkipped: "Skipped {name} (project #{projectId}) \u2014 {reason}",
  reconcileTitle: "Reconciled {count} learned memories in Evermind v{version}",
  reconcileHint: "The answer restated these recalled learnings, so it updates them (write-through cognition).",
  activity: import_builderforce_brain_embedded2.DEFAULT_CHAT_ACTIVITY_LABELS
};
function ProvenanceChip({
  prov,
  labels,
  identity
}) {
  const unused = prov.account === "shared_byo_unused";
  const badge = prov.account === "own" ? labels.accountOwn : unused ? labels.accountByoUnused : prov.account === "shared" ? labels.accountShared : null;
  const variant = prov.account === "own" ? "bf-tl__prov--own" : unused ? "bf-tl__prov--unused" : "bf-tl__prov--shared";
  const name = (0, import_builderforce_brain_embedded2.displayModelName)(prov.model, identity, { account: prov.account });
  const modelTitle = prov.vendor && name === prov.model ? `${name} \xB7 ${prov.vendor}` : name;
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: `bf-tl__prov ${variant}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__prov-model", title: modelTitle, children: name }),
    badge && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__prov-badge", children: badge }),
    prov.evermind ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__prov-evermind", title: labels.ranOnEvermind, children: `\u{1F9E0} Evermind v${prov.evermind.version}` }) : null
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
function CopyButton({ text, labels, icon = false }) {
  const [copied, setCopied] = (0, import_react4.useState)(false);
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
    "button",
    {
      type: "button",
      className: icon ? "bf-tl__act" : "bf-tl__copy",
      title: copied ? labels.copied : labels.copy,
      "aria-label": copied ? labels.copied : labels.copy,
      "data-state": copied ? "done" : void 0,
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
      children: icon ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { "aria-hidden": true, children: copied ? "\u2713" : "\u29C9" }) : copied ? labels.copied : labels.copy
    }
  );
}
function MessageActions({
  message,
  role,
  text,
  labels,
  onReplay,
  onRate,
  rating
}) {
  if (!text.trim()) return null;
  const rate = (next) => (event) => {
    event.stopPropagation();
    onRate?.(message, rating === next ? 0 : next);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(CopyButton, { text, labels, icon: true }),
    onReplay && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      "button",
      {
        type: "button",
        className: "bf-tl__act",
        title: labels.replay,
        "aria-label": labels.replay,
        onClick: (e) => {
          e.stopPropagation();
          onReplay(message, role);
        },
        children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { "aria-hidden": true, children: "\u21BB" })
      }
    ),
    onRate && role === "assistant" && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        "button",
        {
          type: "button",
          className: "bf-tl__act",
          title: labels.rateUp,
          "aria-label": labels.rateUp,
          "aria-pressed": rating === 1,
          "data-state": rating === 1 ? "done" : void 0,
          onClick: rate(1),
          children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { "aria-hidden": true, children: "\u{1F44D}" })
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        "button",
        {
          type: "button",
          className: "bf-tl__act",
          title: labels.rateDown,
          "aria-label": labels.rateDown,
          "aria-pressed": rating === -1,
          "data-state": rating === -1 ? "done" : void 0,
          onClick: rate(-1),
          children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { "aria-hidden": true, children: "\u{1F44E}" })
        }
      )
    ] })
  ] });
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
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_jsx_runtime5.Fragment, { children: text.split("\n").map((line, i) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: `bf-tl__diff-line ${cls}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__diff-sign", "aria-hidden": true, children: sign }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__diff-text", children: line || "\xA0" })
  ] }, i)) });
}
function ToolStep({
  node,
  labels
}) {
  const argsText = formatPayload(node.args);
  const resultText = formatPayload(node.result);
  const preview = toolPreview(node.args);
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("details", { className: `bf-tl__tool${node.isError ? " bf-tl__tool--error" : ""}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("summary", { className: "bf-tl__tool-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__tool-status", "aria-hidden": true, children: node.isError ? "\u2717" : "\u2713" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__tool-name", children: node.label }),
      node.durationMs != null && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__tool-dur", children: formatDuration(node.durationMs) }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__tool-caret", "aria-hidden": true, children: "\u25B8" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "bf-tl__tool-body", children: [
      preview && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "bf-tl__io", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "bf-tl__io-label", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { children: [
            labels.preview,
            preview.path ? ` \xB7 ${preview.path}` : ""
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            CopyButton,
            {
              text: preview.kind === "edit" ? preview.newText : preview.content,
              labels
            }
          )
        ] }),
        preview.kind === "edit" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "bf-tl__diff", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(DiffLines, { text: preview.oldText, sign: "-" }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(DiffLines, { text: preview.newText, sign: "+" })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("pre", { className: "bf-tl__io-pre", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("code", { children: preview.content }) })
      ] }),
      argsText && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "bf-tl__io", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "bf-tl__io-label", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: labels.input }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(CopyButton, { text: argsText, labels })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("pre", { className: "bf-tl__io-pre", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("code", { children: argsText }) })
      ] }),
      resultText && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "bf-tl__io", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "bf-tl__io-label", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: labels.output }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(CopyButton, { text: resultText, labels })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("pre", { className: "bf-tl__io-pre", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("code", { children: resultText }) })
      ] })
    ] })
  ] });
}
function BrainTimelineInner({
  messages,
  trace,
  streamingText,
  isRunning,
  activity,
  loading,
  labels: labelOverrides,
  modelIdentity = import_builderforce_brain_embedded2.DEFAULT_MODEL_IDENTITY,
  assistantName,
  emptyState,
  renderMessage,
  renderStreaming,
  renderAssistantActions,
  onReplayMessage,
  onRateMessage,
  ratings,
  onInternalLink,
  onApplyCode,
  onCreateFile,
  onAnswerQuestion,
  autoScroll = true
}) {
  const labels = (0, import_react4.useMemo)(() => ({ ...DEFAULT_TIMELINE_LABELS, ...labelOverrides }), [labelOverrides]);
  const assistant = assistantName ?? labels.assistant;
  const settled = (0, import_react4.useMemo)(() => buildSettledTimeline(messages, trace), [messages, trace]);
  const nodes = (0, import_react4.useMemo)(() => {
    const streaming = streamingNode(streamingText, isRunning);
    return streaming ? [...settled, streaming] : settled;
  }, [settled, streamingText, isRunning]);
  const scrollRef = (0, import_react4.useRef)(null);
  const contentRef = (0, import_react4.useRef)(null);
  const pinnedRef = (0, import_react4.useRef)(true);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  (0, import_react4.useEffect)(() => {
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
  const renderMsg = (msg, role, text) => renderMessage ? renderMessage(msg, { role, text }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
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
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "bf-tl-scroll", ref: scrollRef, onScroll, children: [
    loading && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "bf-tl-status", children: labels.loading }),
    isEmpty && (emptyState ?? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "bf-tl-empty", children: labels.empty })),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("ol", { className: "bf-tl", ref: contentRef, children: [
      nodes.map((node) => {
        if (node.kind === "user") {
          const to = (0, import_builderforce_brain_embedded2.parseDirectedRecipient)(node.message);
          const author = (0, import_builderforce_brain_embedded2.parseMessageAuthor)(node.message);
          return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("li", { className: "bf-tl__item bf-tl__item--user", children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__dot", children: author ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Avatar, { name: author.name, kind: author.kind, size: 16 }) : dotIcon("user") }) }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "bf-tl__body", children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "bf-tl__role", style: to ? { display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" } : void 0, children: [
                /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: author ? author.name : labels.you }),
                to && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 4, opacity: 0.9 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { "aria-hidden": true, style: { opacity: 0.6 }, children: "\u2192" }),
                  /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Avatar, { name: to.name, kind: to.kind, size: 15 }),
                  /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: to.name })
                ] })
              ] }),
              node.images.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "bf-tl__images", children: node.images.map((im, i) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("img", { src: im.url, alt: im.name ?? "", className: "bf-tl__image" }, i)) }),
              node.text && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "bf-tl__bubble bf-tl__bubble--user", children: renderMsg(node.message, "user", node.text) }),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "bf-tl__actions bf-tl__actions--hover", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(MessageActions, { message: node.message, role: "user", text: node.text, labels, onReplay: onReplayMessage }) })
            ] })
          ] }, node.key);
        }
        if (node.kind === "assistant") {
          const author = (0, import_builderforce_brain_embedded2.parseMessageAuthor)(node.message);
          const card = onAnswerQuestion ? parseAskUser(node.text) : null;
          const bodyText = card ? stripAskUser(node.text) : node.text;
          const prov = (0, import_builderforce_brain_embedded2.parseMessageProvenance)(node.message);
          return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("li", { className: "bf-tl__item bf-tl__item--assistant", children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__dot", children: author ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Avatar, { name: author.name, kind: author.kind, size: 16 }) : dotIcon("assistant") }) }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "bf-tl__body", children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "bf-tl__role", children: author ? author.name : assistant }),
              bodyText && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "bf-tl__bubble", children: renderMsg(node.message, "assistant", bodyText) }),
              card && onAnswerQuestion && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
                QuestionCard,
                {
                  payload: card,
                  labels: { askSubmit: labels.askSubmit, askAnswered: labels.askAnswered },
                  onAnswer: onAnswerQuestion,
                  anchorId: askUserAnchorId(node.message.id)
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "bf-tl__actions", children: [
                /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
                  MessageActions,
                  {
                    message: node.message,
                    role: "assistant",
                    text: bodyText,
                    labels,
                    onReplay: onReplayMessage,
                    onRate: onRateMessage,
                    rating: ratings?.[node.message.id]
                  }
                ),
                renderAssistantActions?.(node.message)
              ] }),
              prov && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(ProvenanceChip, { prov, labels, identity: modelIdentity })
            ] })
          ] }, node.key);
        }
        if (node.kind === "thinking") {
          const label = labels.thoughtFor.replace("{duration}", formatDuration(node.durationMs));
          return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("li", { className: "bf-tl__item bf-tl__item--thinking", children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__dot bf-tl__dot--muted", children: dotIcon("thinking") }) }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "bf-tl__body", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__thinking", children: label }) })
          ] }, node.key);
        }
        if (node.kind === "tool") {
          return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("li", { className: "bf-tl__item bf-tl__item--tool", children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: `bf-tl__dot${node.isError ? " bf-tl__dot--error" : ""}`, children: dotIcon("tool", node.isError) }) }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "bf-tl__body", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(ToolStep, { node, labels }) })
          ] }, node.key);
        }
        if (node.kind === "error") {
          return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("li", { className: "bf-tl__item bf-tl__item--error", children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__dot bf-tl__dot--error", children: dotIcon("error") }) }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "bf-tl__body", children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "bf-tl__role bf-tl__role--error", children: labels.error }),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "bf-tl__bubble bf-tl__bubble--error", children: node.message })
            ] })
          ] }, node.key);
        }
        if (node.kind === "recall") {
          const title = labels.recallTitle.replace("{count}", String(node.count)).replace("{version}", String(node.version));
          return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("li", { className: "bf-tl__item bf-tl__item--memory", children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__dot bf-tl__dot--muted", children: dotIcon("recall") }) }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "bf-tl__body", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("details", { className: "bf-tl__tool bf-tl__memory", children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("summary", { className: "bf-tl__tool-head", title: labels.recallHint, children: [
                /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__tool-name", children: title }),
                /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__tool-caret", "aria-hidden": true, children: "\u25B8" })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "bf-tl__tool-body", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("ol", { className: "bf-tl__memory-list", children: node.items.map((it) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("li", { className: "bf-tl__memory-item", children: [
                /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { className: "bf-tl__memory-score", "aria-hidden": true, children: [
                  Math.round(it.score * 100),
                  "%"
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__memory-text", children: it.text })
              ] }, it.id)) }) })
            ] }) })
          ] }, node.key);
        }
        if (node.kind === "learn") {
          if (node.targets && node.targets.length > 0) {
            const lines = node.targets.map((tg) => {
              if (tg.learned) {
                return labels.learnTargetContributed.replace("{name}", tg.name).replace("{projectId}", String(tg.projectId)).replace("{version}", String(tg.version));
              }
              const reasonLabel = tg.reason && tg.reason !== "too-short" ? labels.learnSkipReason[tg.reason] : null;
              return reasonLabel ? labels.learnTargetSkipped.replace("{name}", tg.name).replace("{projectId}", String(tg.projectId)).replace("{reason}", reasonLabel) : null;
            }).filter((s) => !!s);
            if (lines.length === 0) return null;
            return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("li", { className: "bf-tl__item bf-tl__item--memory", children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__dot bf-tl__dot--muted", children: dotIcon("learn") }) }),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "bf-tl__body", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__memory-line", children: lines.join("; ") }) })
            ] }, node.key);
          }
          const title = node.skipped ? labels.learnSkippedTitle.replace("{reason}", labels.learnSkipReason[node.skipped]) : labels.learnTitle.replace("{version}", String(node.version));
          const hint = node.skipped ? labels.learnSkippedHint : labels.learnHint;
          return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("li", { className: "bf-tl__item bf-tl__item--memory", children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__dot bf-tl__dot--muted", children: dotIcon("learn") }) }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "bf-tl__body", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__memory-line", title: hint, children: title }) })
          ] }, node.key);
        }
        if (node.kind === "activity") {
          const text = (0, import_builderforce_brain_embedded2.chatActivityText)(node.activity, labels.activity) || node.fallbackText;
          const tone = (0, import_builderforce_brain_embedded2.activityTone)(node.activity);
          return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("li", { className: `bf-tl__item bf-tl__item--activity bf-tl__item--activity-${tone}`, children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__dot bf-tl__dot--activity", "aria-hidden": true, children: (0, import_builderforce_brain_embedded2.activityIcon)(node.activity) }) }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "bf-tl__body", children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__activity-line", children: text }),
              node.activity.kind === "milestone" && node.activity.note && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__activity-note", children: node.activity.note })
            ] })
          ] }, node.key);
        }
        if (node.kind === "reconcile") {
          const title = labels.reconcileTitle.replace("{count}", String(node.count)).replace("{version}", String(node.version));
          return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("li", { className: "bf-tl__item bf-tl__item--memory", children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__dot bf-tl__dot--muted", children: dotIcon("reconcile") }) }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "bf-tl__body", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__memory-line", title: labels.reconcileHint, children: title }) })
          ] }, node.key);
        }
        return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("li", { className: "bf-tl__item bf-tl__item--assistant bf-tl__item--streaming", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__gutter", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "bf-tl__dot bf-tl__dot--pulse", children: dotIcon("assistant") }) }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "bf-tl__body", children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "bf-tl__role", children: assistant }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "bf-tl__bubble", children: renderStreaming ? renderStreaming(node.text) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Markdown, { content: node.text, onInternalLink, labels }) })
          ] })
        ] }, node.key);
      }),
      isRunning && !(streamingText.trim() && activity?.phase === "writing") && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(LiveActivity, { activity, isRunning, labels: labels.live })
    ] })
  ] });
}
var BrainTimeline = import_react4.default.memo(BrainTimelineInner);

// src/ChatErrorBanner.tsx
var import_jsx_runtime6 = require("react/jsx-runtime");
var DEFAULT_CHAT_ERROR_LABELS = {
  reconnect: "Reconnect",
  upgrade: "Upgrade",
  upgradeToPlan: "Upgrade to {plan}",
  addCard: "Add a card",
  dismiss: "Dismiss"
};
function planLabel(plan) {
  return plan.replace(/^./, (ch) => ch.toUpperCase());
}
function ChatErrorBanner({
  error,
  action,
  onDismiss,
  onReconnect,
  onUpgrade,
  onValidateCard,
  labels: labelOverrides,
  style,
  className
}) {
  const labels = { ...DEFAULT_CHAT_ERROR_LABELS, ...labelOverrides };
  if (!error) return null;
  const kind = action?.kind;
  const plan = action?.requiredPlan ? planLabel(action.requiredPlan) : null;
  const primary = kind === "auth" && onReconnect ? { label: labels.reconnect, onClick: onReconnect } : kind === "upgrade" && onUpgrade ? {
    label: plan ? labels.upgradeToPlan.replace("{plan}", plan) : labels.upgrade,
    onClick: onUpgrade
  } : kind === "validate_card" && onValidateCard ? { label: labels.addCard, onClick: onValidateCard } : null;
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
    "div",
    {
      className,
      role: "alert",
      style: {
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        flexWrap: "wrap",
        fontSize: 13,
        ...style
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { flex: 1, minWidth: 0, overflowWrap: "anywhere" }, children: error }),
        primary && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          "button",
          {
            type: "button",
            onClick: primary.onClick,
            style: {
              flex: "0 0 auto",
              padding: "4px 10px",
              fontSize: 12,
              fontWeight: 700,
              color: "inherit",
              background: "transparent",
              border: "1px solid currentColor",
              borderRadius: 6,
              cursor: "pointer"
            },
            children: primary.label
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          "button",
          {
            type: "button",
            onClick: onDismiss,
            title: labels.dismiss,
            "aria-label": labels.dismiss,
            style: {
              flex: "0 0 auto",
              background: "transparent",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
              padding: 0
            },
            children: "\xD7"
          }
        )
      ]
    }
  );
}

// src/PromptPanel.tsx
var import_jsx_runtime7 = require("react/jsx-runtime");
function PromptPanel({
  input,
  actions,
  status,
  overlay,
  active = false,
  dragging = false,
  className,
  style,
  ...rest
}) {
  const panelStyle = {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: "var(--prompt-panel-gap, var(--chat-ctl-gap, 6px))",
    width: "100%",
    boxSizing: "border-box",
    padding: "var(--prompt-panel-pad-y, var(--chat-ctl-pad-y, 8px)) var(--prompt-panel-pad-x, var(--chat-ctl-pad-x, 10px))",
    borderRadius: "var(--prompt-panel-radius, 18px)",
    border: `1px solid ${active ? "var(--prompt-panel-active-border, var(--chat-input-active-border, #3b82f6))" : "var(--prompt-panel-border, var(--chat-input-border, rgba(148,163,184,.35)))"}`,
    background: "var(--prompt-panel-bg, var(--chat-input-bg, rgba(15,23,42,.96)))",
    boxShadow: active ? "var(--prompt-panel-active-ring, var(--chat-input-active-ring, 0 0 0 1px #3b82f6)), var(--prompt-panel-shadow, var(--chat-input-shadow, 0 8px 24px rgba(0,0,0,.16)))" : "var(--prompt-panel-shadow, var(--chat-input-shadow, 0 8px 24px rgba(0,0,0,.16)))",
    transition: "border-color 120ms ease, box-shadow 120ms ease, background 120ms ease",
    ...dragging ? { borderStyle: "dashed", background: "var(--prompt-panel-drag-bg, var(--surface-interactive, rgba(59,130,246,.1)))" } : null,
    ...style
  };
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
    "div",
    {
      ...rest,
      className: ["bf-prompt-panel", active && "bf-prompt-panel--active", dragging && "bf-prompt-panel--drag", className].filter(Boolean).join(" "),
      style: panelStyle,
      children: [
        overlay,
        status ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "bf-prompt-panel__status", children: status }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "bf-prompt-panel__input", style: { display: "flex", width: "100%", minWidth: 0 }, children: input }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
          "div",
          {
            className: "bf-prompt-panel__actions",
            style: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "var(--prompt-panel-action-gap, var(--chat-ctl-gap, 6px))", minWidth: 0 },
            children: actions
          }
        )
      ]
    }
  );
}

// src/promptOptions/PromptOptionsMenu.tsx
var import_react5 = require("react");
var import_builderforce_brain_embedded4 = require("@seanhogg/builderforce-brain-embedded");

// src/promptOptions/types.ts
var import_builderforce_brain_embedded3 = require("@seanhogg/builderforce-brain-embedded");
var DEFAULT_PROMPT_OPTIONS_LABELS = {
  ...import_builderforce_brain_embedded3.DEFAULT_MODEL_CHOICE_LABELS,
  options: "Options",
  mode: "Mode",
  memory: "Memory",
  autoMode: "Auto mode",
  autoModeHint: "Auto-approve actions without asking",
  conversation: "Conversation",
  consolidate: "Consolidate",
  consolidating: "Consolidating\u2026",
  consolidateHint: "Summarize this chat into a compact context the rest of the conversation builds on",
  fork: "Fork",
  forking: "Forking\u2026",
  forkHint: "Summarize this chat and continue in a new one from that summary",
  sessionUnavailable: "Available once this chat has a few messages and no run in flight",
  effort: "Effort",
  effortQuick: "Quick",
  effortBalanced: "Balanced",
  effortThorough: "Thorough",
  thinking: "Thinking",
  on: "On",
  off: "Off",
  model: "Model",
  modelInUse: "Model in use",
  searchModels: "Search models\u2026",
  filterModels: "Filter models",
  chooseModel: "Choose model",
  noModels: "No matching models",
  all: "All",
  modelLocked: "Model choice needs a paid plan or a connected provider account.",
  accountSettings: "Account settings"
};
function promptOptionsLabels(overrides) {
  return overrides ? { ...DEFAULT_PROMPT_OPTIONS_LABELS, ...overrides } : DEFAULT_PROMPT_OPTIONS_LABELS;
}

// src/promptOptions/PromptOptionsMenu.tsx
var import_jsx_runtime8 = require("react/jsx-runtime");
var IconConsolidate = () => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("svg", { width: "13", height: "13", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("path", { d: "M2 5.5 4.5 8 2 10.5M14 5.5 11.5 8 14 10.5M6.5 3v10M9.5 3v10", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round", strokeLinejoin: "round" }) });
var IconFork = () => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("svg", { width: "13", height: "13", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [
  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("circle", { cx: "4", cy: "3.5", r: "1.5", fill: "currentColor" }),
  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("circle", { cx: "4", cy: "12.5", r: "1.5", fill: "currentColor" }),
  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("circle", { cx: "12", cy: "3.5", r: "1.5", fill: "currentColor" }),
  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("path", { d: "M4 5v6M4 8h4.5A3.5 3.5 0 0 0 12 4.5V5", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round", strokeLinejoin: "round" })
] });
var EFFORT_LEVELS = ["quick", "balanced", "thorough"];
var EFFORT_ICON = { quick: "\u{1F3C3}", balanced: "\u2696\uFE0F", thorough: "\u{1F3AF}" };
function PromptOptionsMenu({
  labels: labelOverrides,
  disabled = false,
  mode,
  memory,
  autoMode,
  session,
  effort,
  onEffortChange,
  describeEffort,
  thinking,
  onThinkingChange,
  describeThinking,
  model,
  onAccountSettings,
  className
}) {
  const labels = (0, import_react5.useMemo)(() => promptOptionsLabels(labelOverrides), [labelOverrides]);
  const [open, setOpen] = (0, import_react5.useState)(false);
  const [query, setQuery] = (0, import_react5.useState)("");
  const [filter, setFilter] = (0, import_react5.useState)("all");
  const rootRef = (0, import_react5.useRef)(null);
  (0, import_react5.useEffect)(() => {
    if (!open) return;
    const onDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const identity = model?.identity ?? import_builderforce_brain_embedded4.DEFAULT_MODEL_IDENTITY;
  const items = (0, import_react5.useMemo)(() => model ? (0, import_builderforce_brain_embedded4.buildModelItems)(model.options, labels, identity) : [], [model, labels, identity]);
  const inUse = (0, import_react5.useMemo)(
    () => model ? (0, import_builderforce_brain_embedded4.modelInUse)(model.selection, items, labels, model.effective, identity) : null,
    [model, items, labels, identity]
  );
  const categories = (0, import_react5.useMemo)(
    () => import_builderforce_brain_embedded4.MODEL_CATEGORIES.filter((category) => items.some((item) => item.category === category)),
    [items]
  );
  const visible = (0, import_react5.useMemo)(() => (0, import_builderforce_brain_embedded4.filterModelItems)(items, labels, query, filter), [items, labels, query, filter]);
  if (!mode && !memory && !autoMode && !session && !onEffortChange && !onThinkingChange && !model && !onAccountSettings) return null;
  const canChoose = identity.canChoose;
  const activeKey = model ? (0, import_builderforce_brain_embedded4.activeModelKey)(model.selection) : "";
  const activeMode = mode?.choices.find((choice) => choice.value === mode.value);
  const title = [
    labels.options,
    activeMode && `${labels.mode}: ${activeMode.label}`,
    inUse && `${labels.modelInUse}: ${inUse.name}`
  ].filter(Boolean).join(" \xB7 ");
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { ref: rootRef, className: ["bf-pmenu", className].filter(Boolean).join(" "), children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
      "button",
      {
        type: "button",
        className: `bf-pmenu__trigger${open ? " is-open" : ""}`,
        disabled,
        title,
        "aria-label": title,
        "aria-haspopup": "menu",
        "aria-expanded": open,
        onClick: () => setOpen((value) => !value),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__slash", "aria-hidden": "true", children: "/" }),
          activeMode && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { className: "bf-pmenu__mode", children: [
            activeMode.icon && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { "aria-hidden": "true", children: activeMode.icon }),
            activeMode.label
          ] }),
          inUse && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__model", children: inUse.name })
        ]
      }
    ),
    open && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "bf-pmenu__pop", role: "menu", children: [
      mode && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "bf-pmenu__group", children: labels.mode }),
        mode.choices.map((choice) => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
          "button",
          {
            type: "button",
            role: "menuitemradio",
            "aria-checked": choice.value === mode.value,
            className: `bf-pmenu__item${choice.value === mode.value ? " is-active" : ""}`,
            onClick: () => {
              mode.onChange(choice.value);
              setOpen(false);
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__ico", "aria-hidden": "true", children: choice.icon ?? "" }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { className: "bf-pmenu__lbl", children: [
                choice.label,
                choice.hint && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__desc", children: choice.hint })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__check", "aria-hidden": "true", children: choice.value === mode.value ? "\u2713" : "" })
            ]
          },
          choice.value
        ))
      ] }),
      memory && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
        mode && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "bf-pmenu__sep" }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
          "button",
          {
            type: "button",
            role: "menuitemcheckbox",
            "aria-checked": memory.enabled,
            disabled: !!memory.unavailableReason,
            className: `bf-pmenu__item${memory.enabled && !memory.unavailableReason ? " is-active" : ""}`,
            title: memory.unavailableReason,
            onClick: () => {
              if (!memory.unavailableReason) memory.onChange(!memory.enabled);
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__ico", "aria-hidden": "true", children: "\u{1F9E0}" }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { className: "bf-pmenu__lbl", children: [
                labels.memory,
                (memory.unavailableReason ?? memory.describe?.(memory.enabled)) && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__desc", children: memory.unavailableReason ?? memory.describe?.(memory.enabled) })
              ] }),
              !memory.unavailableReason && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__hint", children: memory.enabled ? labels.on : labels.off }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__check", "aria-hidden": "true", children: memory.enabled && !memory.unavailableReason ? "\u2713" : "" })
            ]
          }
        )
      ] }),
      autoMode && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
        (mode || memory) && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "bf-pmenu__sep" }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
          "button",
          {
            type: "button",
            role: "menuitemcheckbox",
            "aria-checked": autoMode.enabled,
            className: `bf-pmenu__item${autoMode.enabled ? " is-active" : ""}`,
            onClick: () => autoMode.onChange(!autoMode.enabled),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__ico", "aria-hidden": "true", children: "\u26A1" }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { className: "bf-pmenu__lbl", children: [
                labels.autoMode,
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__desc", children: autoMode.description ?? labels.autoModeHint })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__hint", children: autoMode.enabled ? labels.on : labels.off }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__check", "aria-hidden": "true", children: autoMode.enabled ? "\u2713" : "" })
            ]
          }
        )
      ] }),
      onEffortChange && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
        (mode || memory || autoMode) && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "bf-pmenu__sep" }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "bf-pmenu__group", children: labels.effort }),
        EFFORT_LEVELS.map((level) => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
          "button",
          {
            type: "button",
            role: "menuitemradio",
            "aria-checked": effort === level,
            className: `bf-pmenu__item${effort === level ? " is-active" : ""}`,
            onClick: () => onEffortChange(level),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__ico", "aria-hidden": "true", children: EFFORT_ICON[level] }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { className: "bf-pmenu__lbl", children: [
                level === "quick" ? labels.effortQuick : level === "balanced" ? labels.effortBalanced : labels.effortThorough,
                describeEffort && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__desc", children: describeEffort(level) })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__check", "aria-hidden": "true", children: effort === level ? "\u2713" : "" })
            ]
          },
          level
        ))
      ] }),
      onThinkingChange && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
        (mode || memory || autoMode || onEffortChange) && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "bf-pmenu__sep" }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
          "button",
          {
            type: "button",
            role: "menuitemcheckbox",
            "aria-checked": !!thinking,
            className: `bf-pmenu__item${thinking ? " is-active" : ""}`,
            onClick: () => onThinkingChange(!thinking),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__ico", "aria-hidden": "true", children: "\u{1F4AD}" }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { className: "bf-pmenu__lbl", children: [
                labels.thinking,
                describeThinking && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__desc", children: describeThinking(!!thinking) })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__hint", children: thinking ? labels.on : labels.off }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__check", "aria-hidden": "true", children: thinking ? "\u2713" : "" })
            ]
          }
        )
      ] }),
      model && inUse && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
        (mode || memory || autoMode || onEffortChange || onThinkingChange) && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "bf-pmenu__sep" }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "bf-pmenu__group", children: labels.model }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "bf-pmenu__info", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__ico", "aria-hidden": "true", children: "\u{1F9E0}" }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { className: "bf-pmenu__lbl", children: [
            inUse.name,
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__desc", children: inUse.detail })
          ] })
        ] }),
        canChoose ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
            "input",
            {
              className: "bf-pmenu__search",
              value: query,
              onChange: (event) => setQuery(event.target.value),
              placeholder: labels.searchModels,
              "aria-label": labels.searchModels
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "bf-pmenu__filters", "aria-label": labels.filterModels, children: ["all", ...categories].map((category) => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
            "button",
            {
              type: "button",
              className: `bf-pmenu__filter${filter === category ? " is-active" : ""}`,
              "aria-pressed": filter === category,
              onClick: () => setFilter(category),
              children: category === "all" ? labels.all : (0, import_builderforce_brain_embedded4.modelCategoryLabel)(category, labels)
            },
            category
          )) }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "bf-pmenu__list", role: "listbox", "aria-label": labels.chooseModel, children: [
            visible.map((item) => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
              "button",
              {
                type: "button",
                role: "option",
                "aria-selected": item.key === activeKey,
                className: `bf-pmenu__option${item.key === activeKey ? " is-active" : ""}`,
                onClick: () => {
                  model.onChange(item.selection);
                  setQuery("");
                  setOpen(false);
                },
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__optName", children: item.label }),
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__optTag", children: (0, import_builderforce_brain_embedded4.modelCategoryLabel)(item.category, labels) }),
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__optDetail", children: item.detail })
                ]
              },
              item.key
            )),
            !visible.length && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "bf-pmenu__empty", children: labels.noModels })
          ] })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "bf-pmenu__info", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__ico", "aria-hidden": "true", children: "\u{1F512}" }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__lbl", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__desc", children: labels.modelLocked }) })
        ] })
      ] }),
      session && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "bf-pmenu__sep" }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "bf-pmenu__group", children: labels.conversation }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
          "button",
          {
            type: "button",
            role: "menuitem",
            className: "bf-pmenu__item",
            disabled: !session.canConsolidate || !!session.consolidating || !!session.forking,
            onClick: () => {
              setOpen(false);
              session.onConsolidate();
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__ico", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(IconConsolidate, {}) }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { className: "bf-pmenu__lbl", children: [
                session.consolidating ? labels.consolidating : labels.consolidate,
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__desc", children: session.canConsolidate ? labels.consolidateHint : labels.sessionUnavailable })
              ] })
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
          "button",
          {
            type: "button",
            role: "menuitem",
            className: "bf-pmenu__item",
            disabled: !session.canConsolidate || !!session.consolidating || !!session.forking,
            onClick: () => {
              setOpen(false);
              session.onFork();
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__ico", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(IconFork, {}) }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { className: "bf-pmenu__lbl", children: [
                session.forking ? labels.forking : labels.fork,
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__desc", children: session.canConsolidate ? labels.forkHint : labels.sessionUnavailable })
              ] })
            ]
          }
        )
      ] }),
      onAccountSettings && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "bf-pmenu__sep" }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
          "button",
          {
            type: "button",
            role: "menuitem",
            className: "bf-pmenu__item",
            onClick: () => {
              setOpen(false);
              onAccountSettings();
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__ico", "aria-hidden": "true", children: "\u2699" }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "bf-pmenu__lbl", children: labels.accountSettings })
            ]
          }
        )
      ] })
    ] })
  ] });
}

// src/index.ts
var import_builderforce_brain_embedded6 = require("@seanhogg/builderforce-brain-embedded");

// src/HealthRing.tsx
var import_jsx_runtime9 = require("react/jsx-runtime");
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
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("span", { className: "bf-health-ring", style: { display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 2 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: "img", "aria-label": label, children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
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
    caption ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { style: { fontSize: 10, color: "var(--bf-health-caption, var(--bf-text-muted, #6b7280))", lineHeight: 1 }, children: caption }) : null
  ] });
}

// src/pendingChanges/PendingChangesBar.tsx
var import_react6 = require("react");
var import_jsx_runtime10 = require("react/jsx-runtime");
var DEFAULT_PENDING_CHANGES_LABELS = {
  summary: "{count} uncommitted changes",
  summaryOne: "1 uncommitted change",
  hint: "Changed in your workspace and not committed yet.",
  expand: "Show the changed files",
  collapse: "Hide the changed files",
  review: "Review",
  staged: "staged",
  status: {
    modified: "modified",
    added: "added",
    deleted: "deleted",
    renamed: "renamed",
    untracked: "new",
    conflict: "conflict",
    typechange: "type changed"
  }
};
function statusColor(status) {
  switch (status) {
    case "added":
    case "untracked":
      return "var(--bf-success, #2e9e5b)";
    case "deleted":
      return "var(--bf-danger, var(--bf-error, #d64545))";
    case "conflict":
      return "var(--bf-warning, #c98a1b)";
    default:
      return "var(--bf-accent, #4a8cf7)";
  }
}
function splitPath(path) {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? { dir: "", file: path } : { dir: path.slice(0, cut + 1), file: path.slice(cut + 1) };
}
function PendingChangesBar({
  changes,
  onOpenChange,
  onReview,
  defaultExpanded = false,
  labels: labelOverrides,
  className,
  style
}) {
  const [expanded, setExpanded] = (0, import_react6.useState)(defaultExpanded);
  const labels = {
    ...DEFAULT_PENDING_CHANGES_LABELS,
    ...labelOverrides,
    status: { ...DEFAULT_PENDING_CHANGES_LABELS.status, ...labelOverrides?.status }
  };
  if (!changes.length) return null;
  const heading = changes.length === 1 ? labels.summaryOne : labels.summary.replace("{count}", String(changes.length));
  const showRepo = new Set(changes.map((c) => c.repo ?? "")).size > 1;
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(
    "section",
    {
      className,
      "aria-label": heading,
      style: {
        border: "1px solid var(--bf-border, rgba(128, 128, 128, 0.35))",
        borderRadius: 8,
        background: "var(--bf-surface-2, var(--bf-surface, transparent))",
        fontSize: 12,
        color: "var(--bf-text, inherit)",
        overflow: "hidden",
        ...style
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 8px" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(
            "button",
            {
              type: "button",
              onClick: () => setExpanded((v) => !v),
              "aria-expanded": expanded,
              title: expanded ? labels.collapse : labels.expand,
              style: {
                display: "flex",
                alignItems: "center",
                gap: 6,
                flex: "1 1 auto",
                minWidth: 0,
                padding: 0,
                background: "transparent",
                border: "none",
                color: "inherit",
                font: "inherit",
                textAlign: "left",
                cursor: "pointer"
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { "aria-hidden": true, style: { flex: "0 0 auto", opacity: 0.7 }, children: expanded ? "\u25BE" : "\u25B8" }),
                /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
                  "span",
                  {
                    "aria-hidden": true,
                    style: {
                      flex: "0 0 auto",
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "var(--bf-accent, #4a8cf7)"
                    }
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { style: { fontWeight: 600, minWidth: 0, overflowWrap: "anywhere" }, children: heading })
              ]
            }
          ),
          onReview && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
            "button",
            {
              type: "button",
              onClick: onReview,
              style: {
                flex: "0 0 auto",
                padding: "3px 10px",
                fontSize: 11,
                fontWeight: 700,
                color: "inherit",
                background: "transparent",
                border: "1px solid currentColor",
                borderRadius: 6,
                cursor: "pointer"
              },
              children: labels.review
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: { padding: "0 8px 6px 30px", color: "var(--bf-text-muted, #8a8a8a)" }, children: labels.hint }),
        expanded && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("ul", { style: { listStyle: "none", margin: 0, padding: "0 4px 6px" }, children: changes.map((change) => {
          const { dir, file } = splitPath(change.path);
          const state = change.staged ? `${labels.status[change.status]} \xB7 ${labels.staged}` : labels.status[change.status];
          return /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(
            "button",
            {
              type: "button",
              onClick: () => onOpenChange(change),
              title: `${change.path} \u2014 ${state}`,
              style: {
                display: "flex",
                alignItems: "baseline",
                gap: 6,
                width: "100%",
                padding: "3px 6px",
                background: "transparent",
                border: "none",
                borderRadius: 4,
                color: "inherit",
                font: "inherit",
                textAlign: "left",
                cursor: "pointer"
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
                  "span",
                  {
                    "aria-hidden": true,
                    style: { flex: "0 0 auto", width: 6, height: 6, borderRadius: "50%", background: statusColor(change.status) }
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("span", { style: { minWidth: 0, overflowWrap: "anywhere", fontFamily: "var(--bf-font-mono, monospace)" }, children: [
                  dir && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { style: { opacity: 0.6 }, children: dir }),
                  /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { children: file })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { style: { flex: "1 1 auto" } }),
                showRepo && change.repo && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { style: { flex: "0 0 auto", color: "var(--bf-text-muted, #8a8a8a)" }, children: change.repo }),
                /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { style: { flex: "0 0 auto", color: "var(--bf-text-muted, #8a8a8a)" }, children: state })
              ]
            }
          ) }, change.id ?? `${change.repo ?? ""}:${change.path}`);
        }) })
      ]
    }
  );
}

// src/chatTickets/ChatTicketsPanel.tsx
var import_react7 = require("react");

// src/optionStyle.ts
var nativeOptionStyle = {
  background: "var(--bf-ev-surface-solid, var(--bg-surface, var(--vscode-dropdown-background, Canvas)))",
  color: "var(--bf-ev-text, var(--text-primary, var(--vscode-dropdown-foreground, CanvasText)))"
};

// src/chatTickets/runGate.ts
function resolveRunGate(adapter) {
  const probe = adapter.canRunTicket?.();
  if (!probe) return { allowed: true };
  return { allowed: probe.allowed, reason: probe.reason };
}

// src/chatTickets/types.ts
var TICKET_KINDS = ["task", "epic", "gap", "objective", "initiative", "portfolio", "roadmap", "spec", "retro", "poker"];
var RUNNABLE_KINDS = ["task", "epic", "gap"];
var DEFAULT_CHAT_TICKETS_LABELS = {
  none: "No tickets linked yet.",
  spawned: "spawned here",
  run: "Run agent on ticket",
  open: "Open",
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
  questions: "Questions",
  noQuestions: "No pending questions.",
  answerPlaceholder: "Type your answer\u2026",
  submitAnswer: "Answer",
  answering: "Sending\u2026",
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
  showTickets: "Show linked tickets",
  hideTickets: "Hide linked tickets",
  kind: { task: "Task", epic: "Epic", gap: "Gap", objective: "Objective", initiative: "Initiative", portfolio: "Portfolio", roadmap: "Roadmap", spec: "Spec", retro: "Retrospective", poker: "Planning poker" },
  ringAria: (label, pct) => `${label}: ${pct}% done`,
  ticketCount: (n) => `${n} ticket${n === 1 ? "" : "s"}`,
  overallAria: (pct) => `Overall progress: ${pct}% done`,
  runStarted: (agent) => `Started ${agent} on the ticket.`,
  mergeAction: (n) => `Merge ${n} here`,
  mergedN: (n) => `Merged ${n} chat(s).`
};

// src/chatTickets/ChatTicketsPanel.tsx
var import_jsx_runtime11 = require("react/jsx-runtime");
var RUNNABLE = new Set(RUNNABLE_KINDS);
var COLLAPSE_THRESHOLD = 8;
function ChatTicketsPanelInner({ chatId, projectId, chatList, adapter, labels, onChanged, refreshSignal, visibility, onSetVisibility, onOpenTicket }) {
  const [tickets, setTickets] = (0, import_react7.useState)([]);
  const [agents, setAgents] = (0, import_react7.useState)([]);
  const [members, setMembers] = (0, import_react7.useState)([]);
  const [pool, setPool] = (0, import_react7.useState)([]);
  const [questions, setQuestions] = (0, import_react7.useState)([]);
  const [panel, setPanel] = (0, import_react7.useState)(null);
  const [lineageKey, setLineageKey] = (0, import_react7.useState)(null);
  const [lineage, setLineage] = (0, import_react7.useState)([]);
  const [runKey, setRunKey] = (0, import_react7.useState)(null);
  const [msg, setMsg] = (0, import_react7.useState)(null);
  const [busy, setBusy] = (0, import_react7.useState)(false);
  const [collapsed, setCollapsed] = (0, import_react7.useState)(null);
  const userCollapsed = (0, import_react7.useRef)(false);
  const load = (0, import_react7.useCallback)(async () => {
    const [tk, ag, mem, qs] = await Promise.all([
      adapter.listTickets(chatId).catch(() => []),
      adapter.listAgents(chatId).catch(() => []),
      adapter.listMembers(chatId).catch(() => []),
      adapter.listQuestions(chatId).catch(() => [])
    ]);
    setTickets(tk);
    setAgents(ag);
    setMembers(mem);
    setQuestions(qs);
    if (!userCollapsed.current) setCollapsed(tk.length > COLLAPSE_THRESHOLD);
  }, [adapter, chatId]);
  (0, import_react7.useEffect)(() => {
    void load();
  }, [load, refreshSignal]);
  (0, import_react7.useEffect)(() => {
    adapter.loadAgentPool().then(setPool).catch(() => setPool([]));
  }, [adapter]);
  const flash = (m) => {
    setMsg(m);
    if (typeof window !== "undefined") window.setTimeout(() => setMsg(null), 3500);
  };
  const poolName = (0, import_react7.useCallback)((ref) => pool.find((p) => p.ref === ref)?.name ?? ref, [pool]);
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
  const runGate = resolveRunGate(adapter);
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
  const agg = (0, import_react7.useMemo)(() => {
    let done = 0, total = 0, sumPct = 0;
    for (const tk of tickets) {
      done += tk.done;
      total += tk.total;
      sumPct += tk.progressPct;
    }
    const pct = total > 0 ? Math.round(done / total * 100) : tickets.length ? Math.round(sumPct / tickets.length) : 0;
    return { pct, done, total };
  }, [tickets]);
  const isCollapsed = tickets.length > 0 && (collapsed ?? tickets.length > COLLAPSE_THRESHOLD);
  const toggleCollapsed = () => {
    userCollapsed.current = true;
    setCollapsed(!isCollapsed);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { style: S.root, children: [
    tickets.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(
      "button",
      {
        type: "button",
        onClick: toggleCollapsed,
        "aria-expanded": !isCollapsed,
        title: isCollapsed ? labels.showTickets : labels.hideTickets,
        style: S.ticketsHeader,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { "aria-hidden": true, style: { ...S.caret, transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)" }, children: "\u25B8" }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(HealthRing, { percent: agg.pct, size: 22, muted: false, ariaLabel: labels.overallAria(agg.pct) }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: S.ticketsCount, children: labels.ticketCount(tickets.length) }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", { style: S.ticketsAgg, children: [
            agg.pct,
            "%",
            agg.total > 0 ? ` \xB7 ${agg.done}/${agg.total}` : ""
          ] })
        ]
      }
    ),
    !isCollapsed && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }, children: tickets.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: S.muted, children: labels.none }) : tickets.map((tk) => {
      const key = `${tk.kind}:${tk.ref}`;
      return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { style: S.chip, children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(HealthRing, { percent: tk.progressPct, size: 36, caption: tk.total > 0 ? `${tk.done}/${tk.total}` : void 0, muted: !tk.exists, ariaLabel: labels.ringAria(tk.label, tk.progressPct) }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { style: { display: "flex", flexDirection: "column", minWidth: 0, maxWidth: 160 }, children: [
          onOpenTicket && tk.exists ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("button", { type: "button", title: `${labels.open} \xB7 ${tk.label}`, onClick: () => onOpenTicket(tk), style: S.ticketLink, children: tk.label }) : /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: S.ticketLabel, title: tk.label, children: tk.label }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", { style: S.ticketMeta, children: [
            labels.kind[tk.kind],
            " \xB7 ",
            tk.status,
            tk.linkType === "created" ? ` \xB7 ${labels.spawned}` : ""
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { style: { display: "flex", gap: 2 }, children: [
          onOpenTicket && tk.exists && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("button", { type: "button", title: `${labels.open} \xB7 ${tk.label}`, onClick: () => onOpenTicket(tk), style: S.icon, children: "\u2197" }),
          RUNNABLE.has(tk.kind) && tk.exists && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
            "button",
            {
              type: "button",
              disabled: !runGate.allowed,
              "aria-disabled": !runGate.allowed,
              title: runGate.allowed ? labels.run : runGate.reason ?? labels.run,
              onClick: () => setRunKey(runKey === key ? null : key),
              style: runGate.allowed ? S.icon : { ...S.icon, opacity: 0.45, cursor: "not-allowed" },
              children: "\u25B6"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("button", { type: "button", title: labels.lineage, onClick: () => void openLineage(tk), style: S.icon, children: "\u2443" }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("button", { type: "button", title: labels.unlink, disabled: busy, onClick: () => void unlink(tk), style: S.icon, children: "\u2715" })
        ] }),
        runKey === key && /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("select", { "aria-label": labels.pickAgent, value: "", onChange: (e) => {
          if (e.target.value) void runTicket(tk, e.target.value);
        }, style: S.select, children: [
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("option", { style: S.option, value: "", children: labels.pickAgent }),
          agents.map((a) => /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("option", { style: S.option, value: a.agentRef, children: [
            "\u2605 ",
            poolName(a.agentRef)
          ] }, a.id)),
          pool.filter((p) => !agents.some((a) => a.agentRef === p.ref)).map((p) => /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("option", { style: S.option, value: p.ref, children: p.name }, p.ref))
        ] })
      ] }, tk.linkId);
    }) }),
    lineageKey && /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { style: S.drawer, children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("strong", { style: { color: V.text }, children: labels.lineageTitle }),
      lineage.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: { marginLeft: 8, ...S.muted }, children: labels.lineageEmpty }) : /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("ul", { style: { margin: "4px 0 0", paddingLeft: 18 }, children: lineage.map((c) => /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("li", { style: { marginBottom: 2 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: { fontWeight: c.chatId === chatId ? 700 : 400 }, children: c.title }),
        c.linkType === "created" ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("em", { style: { color: V.accent, marginLeft: 6 }, children: labels.spawned }) : null,
        c.isArchived ? /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", { style: { marginLeft: 6, ...S.muted }, children: [
          "(",
          labels.merged,
          ")"
        ] }) : null
      ] }, c.chatId)) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("button", { type: "button", onClick: () => setPanel(panel === "link" ? null : "link"), style: S.pill(panel === "link"), children: [
        "\uFF0B ",
        labels.link
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("button", { type: "button", onClick: () => setPanel(panel === "agents" ? null : "agents"), style: S.pill(panel === "agents"), children: [
        "\u{1F465} ",
        labels.agents,
        agents.length ? ` (${agents.length})` : ""
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("button", { type: "button", onClick: () => setPanel(panel === "people" ? null : "people"), style: S.pill(panel === "people"), children: [
        "\u{1F464} ",
        labels.people,
        members.length ? ` (${members.length})` : ""
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("button", { type: "button", onClick: () => setPanel(panel === "merge" ? null : "merge"), style: S.pill(panel === "merge"), children: [
        "\u29C9 ",
        labels.merge
      ] }),
      questions.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("button", { type: "button", onClick: () => setPanel(panel === "questions" ? null : "questions"), style: S.pill(panel === "questions"), children: [
        "\u2753 ",
        labels.questions,
        " (",
        questions.length,
        ")"
      ] }),
      msg && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: { fontSize: 12, color: V.accent, alignSelf: "center" }, children: msg })
    ] }),
    panel === "link" && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(LinkForm, { search: adapter.searchTickets, projectId, existing: tickets, labels, onLink: async (kind, ref, linkType) => {
      try {
        await adapter.linkTicket(chatId, { kind, ref, linkType });
        await load();
      } catch (e) {
        flash(e instanceof Error ? e.message : labels.linkFailed);
      }
    } }),
    panel === "agents" && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
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
    panel === "people" && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
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
    panel === "merge" && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
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
    ),
    panel === "questions" && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
      QuestionsSection,
      {
        questions,
        labels,
        onAnswer: async (id, answer) => {
          await adapter.answerQuestion(id, answer);
          await load();
          onChanged?.();
        }
      }
    )
  ] });
}
function QuestionsSection({ questions, labels, onAnswer }) {
  const [answers, setAnswers] = (0, import_react7.useState)({});
  const [sending, setSending] = (0, import_react7.useState)(null);
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { style: S.drawer, children: questions.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: S.muted, children: labels.noQuestions }) : questions.map((q, index) => {
    const value = answers[q.id] ?? "";
    return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { style: { padding: "10px 0", borderBottom: index < questions.length - 1 ? `1px solid ${V.border}` : void 0 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { style: { color: V.text, fontSize: 13, lineHeight: 1.45, whiteSpace: "pre-wrap", marginBottom: 8 }, children: q.description }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { style: { display: "flex", gap: 8, alignItems: "flex-start" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
          "textarea",
          {
            value,
            onChange: (e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value })),
            placeholder: labels.answerPlaceholder,
            rows: 2,
            disabled: sending === q.id,
            style: { ...S.select, flex: 1, resize: "vertical", minHeight: 54, fontFamily: "inherit" }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("button", { type: "button", disabled: !value.trim() || sending === q.id, style: S.pill(true), onClick: () => {
          setSending(q.id);
          void onAnswer(q.id, value.trim()).finally(() => setSending(null));
        }, children: sending === q.id ? labels.answering : labels.submitAnswer })
      ] })
    ] }, q.id);
  }) });
}
var SEARCH_LIMIT = 40;
function LinkForm({ search, projectId, existing, labels, onLink }) {
  const [kind, setKind] = (0, import_react7.useState)("task");
  const [ref, setRef] = (0, import_react7.useState)("");
  const [query, setQuery] = (0, import_react7.useState)("");
  const [linkType, setLinkType] = (0, import_react7.useState)("linked");
  const [busy, setBusy] = (0, import_react7.useState)(false);
  const [results, setResults] = (0, import_react7.useState)([]);
  const [loading, setLoading] = (0, import_react7.useState)(false);
  (0, import_react7.useEffect)(() => {
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
  const shown = (0, import_react7.useMemo)(
    () => results.filter((o) => !existing.some((e) => e.kind === kind && e.ref === o.ref)),
    [results, existing, kind]
  );
  const atCap = results.length >= SEARCH_LIMIT;
  (0, import_react7.useEffect)(() => {
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
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { style: S.section, children: [
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("select", { "aria-label": labels.kindLabel, value: kind, onChange: (e) => {
      setKind(e.target.value);
      setRef("");
      setQuery("");
    }, style: S.select, children: TICKET_KINDS.map((k) => /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("option", { style: S.option, value: k, children: labels.kind[k] }, k)) }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
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
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("select", { "aria-label": labels.pickTicket, value: ref, onChange: (e) => setRef(e.target.value), style: { ...S.select, minWidth: 200 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("option", { style: S.option, value: "", children: labels.pickTicket }),
      shown.map((o) => /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("option", { style: S.option, value: o.ref, children: o.label }, o.ref))
    ] }),
    loading ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: S.muted, children: labels.searching }) : shown.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: S.muted, children: labels.noMatches }) : atCap ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: S.muted, children: labels.refine }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("select", { "aria-label": labels.linkTypeLabel, value: linkType, onChange: (e) => setLinkType(e.target.value), style: S.select, children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("option", { style: S.option, value: "linked", children: labels.linkTypeLinked }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("option", { style: S.option, value: "created", children: labels.linkTypeCreated })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("button", { type: "button", onClick: () => void submit(), disabled: busy || !ref, style: S.pill(true), children: busy ? "\u2026" : labels.linkAction })
  ] });
}
function AgentsSection({ agents, pool, labels, onInvite, onRemove, busy }) {
  const poolName = (ref) => pool.find((p) => p.ref === ref)?.name ?? ref;
  const uninvited = pool.filter((p) => !agents.some((a) => a.agentRef === p.ref));
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { style: { ...S.section, flexDirection: "column", alignItems: "stretch" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, children: agents.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: S.muted, children: labels.noAgents }) : agents.map((a) => /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", { style: S.agentChip, children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { "aria-hidden": true, children: "\u{1F916}" }),
      poolName(a.agentRef),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("button", { type: "button", title: labels.removeAgent, disabled: busy, onClick: () => void onRemove(a.id), style: { ...S.icon, fontSize: 11 }, children: "\u2715" })
    ] }, a.id)) }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("select", { "aria-label": labels.inviteAgent, value: "", onChange: (e) => {
      const p = pool.find((x) => x.ref === e.target.value);
      if (p) void onInvite(p.ref, p.kind);
    }, style: { ...S.select, maxWidth: 260 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("option", { style: S.option, value: "", children: labels.inviteAgent }),
      uninvited.map((p) => /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("option", { style: S.option, value: p.ref, children: [
        p.name,
        " \u2014 ",
        p.meta
      ] }, p.ref))
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: { fontSize: 11, ...S.muted }, children: labels.agentsHint })
  ] });
}
function PeopleSection({ members, labels, visibility, onSetVisibility, onInvite, onRemove, busy }) {
  const [email, setEmail] = (0, import_react7.useState)("");
  const submit = async () => {
    const e = email.trim();
    if (!e) return;
    await onInvite(e);
    setEmail("");
  };
  const locked = visibility === "locked";
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { style: { ...S.section, flexDirection: "column", alignItems: "stretch" }, children: [
    visibility && onSetVisibility && /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("button", { type: "button", disabled: busy, onClick: () => void onSetVisibility(locked ? "shared" : "locked"), style: S.pill(locked), children: locked ? `\u{1F512} ${labels.visibilityLocked}` : `\u{1F513} ${labels.visibilityShared}` }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: { fontSize: 11, ...S.muted }, children: labels.lockHint })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, children: members.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: S.muted, children: labels.noPeople }) : members.map((m) => /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", { style: S.agentChip, children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { "aria-hidden": true, children: m.status === "pending" ? "\u2709\uFE0F" : "\u{1F464}" }),
      m.name,
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("button", { type: "button", title: labels.removePerson, disabled: busy, onClick: () => void onRemove(m.id), style: { ...S.icon, fontSize: 11 }, children: "\u2715" })
    ] }, m.id)) }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { style: { display: "flex", gap: 6 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("button", { type: "button", disabled: busy || !email.trim(), onClick: () => void submit(), style: S.pill(false), children: "\uFF0B" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: { fontSize: 11, ...S.muted }, children: labels.invitePersonHint })
  ] });
}
function MergeSection({ chatId, chatList, labels, onMerge, busy }) {
  const [selected, setSelected] = (0, import_react7.useState)([]);
  const candidates = chatList.filter((c) => c.id !== chatId);
  const toggle = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { style: { ...S.section, flexDirection: "column", alignItems: "stretch" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: { fontSize: 12, color: V.text2 }, children: labels.mergeHint }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { style: { maxHeight: 160, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }, children: candidates.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: S.muted, children: labels.mergeNoOthers }) : candidates.map((c) => /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "3px 4px", cursor: "pointer" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("input", { type: "checkbox", checked: selected.includes(c.id), onChange: () => toggle(c.id) }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: c.title })
    ] }, c.id)) }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("button", { type: "button", onClick: () => {
      if (selected.length) void onMerge(selected).then(() => setSelected([]));
    }, disabled: busy || selected.length === 0, style: S.pill(true), children: busy ? "\u2026" : labels.mergeAction(selected.length) })
  ] });
}
var ChatTicketsPanel = (0, import_react7.memo)(ChatTicketsPanelInner);
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
  // Collapsible ticket-summary header — full-width, button-reset, subtle hover-less
  // affordance that carries a caret, an overall health ring and the linked count.
  ticketsHeader: { display: "flex", alignItems: "center", gap: 8, padding: "2px 4px", width: "100%", background: "transparent", border: "none", cursor: "pointer", textAlign: "left", color: V.text },
  caret: { display: "inline-block", fontSize: 11, color: V.muted, transition: "transform 120ms ease" },
  ticketsCount: { fontSize: 12, fontWeight: 600, color: V.text },
  ticketsAgg: { fontSize: 11, color: V.muted },
  chip: { display: "flex", alignItems: "center", gap: 6, padding: "2px 6px", border: `1px solid ${V.border}`, borderRadius: 8 },
  ticketLabel: { fontSize: 12, fontWeight: 600, color: V.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  // Clickable variant of the label — opens the artifact. Underlined-on-hover link
  // affordance, theme-driven accent, left-aligned and truncating like the span.
  ticketLink: { fontSize: 12, fontWeight: 600, color: V.accent, background: "transparent", border: "none", padding: 0, textAlign: "left", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "underline", textUnderlineOffset: 2 },
  ticketMeta: { fontSize: 10, color: V.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  drawer: { fontSize: 12, color: V.text2, borderTop: `1px dashed ${V.border}`, paddingTop: 6 },
  section: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", borderTop: `1px dashed ${V.border}`, paddingTop: 8 },
  agentChip: { display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 8px", borderRadius: 999, background: V.surface2, border: `1px solid ${V.border}`, fontSize: 12, color: V.text },
  // `colorScheme` makes the browser draw the native <select> (and its OS/UA popup)
  // in the editor's active scheme even where the token background doesn't reach.
  select: { minWidth: 120, padding: "4px 8px", fontSize: 12, borderRadius: 8, border: `1px solid ${V.border}`, background: V.field, color: V.fieldText, colorScheme: "inherit" },
  // The option popup is drawn by the OS and does NOT inherit `select`'s background,
  // so each option needs its own opaque pair — see nativeOptionStyle.
  option: nativeOptionStyle,
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
var import_react8 = require("react");
function useChatParticipants(adapter, chatId, refreshSignal = 0) {
  const [pool, setPool] = (0, import_react8.useState)([]);
  const [invited, setInvited] = (0, import_react8.useState)([]);
  const [members, setMembers] = (0, import_react8.useState)([]);
  (0, import_react8.useEffect)(() => {
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
  (0, import_react8.useEffect)(() => {
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
  return (0, import_react8.useMemo)(
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
var import_react9 = require("react");
var import_builderforce_brain_embedded5 = require("@seanhogg/builderforce-brain-embedded");
var import_jsx_runtime12 = require("react/jsx-runtime");
function useMentionAutocomplete(opts) {
  const { textareaRef, value, setValue, participants, onPick, labels, disabled } = opts;
  const [token, setToken] = (0, import_react9.useState)(null);
  const [index, setIndex] = (0, import_react9.useState)(0);
  const matches = (0, import_react9.useMemo)(
    () => token && !disabled ? (0, import_builderforce_brain_embedded5.filterMentionCandidates)(participants, token.query) : [],
    [token, participants, disabled]
  );
  const open = !disabled && token != null && matches.length > 0;
  const recompute = (0, import_react9.useCallback)(() => {
    const el = textareaRef.current;
    if (!el || disabled || participants.length === 0) {
      setToken(null);
      return;
    }
    const next = (0, import_builderforce_brain_embedded5.activeMentionToken)(el.value, el.selectionStart ?? el.value.length);
    setToken(next);
    setIndex(0);
  }, [textareaRef, disabled, participants.length]);
  (0, import_react9.useEffect)(() => {
    recompute();
  }, [value, recompute]);
  const choose = (0, import_react9.useCallback)((r) => {
    const el = textareaRef.current;
    const tk = token ?? (el ? (0, import_builderforce_brain_embedded5.activeMentionToken)(el.value, el.selectionStart ?? 0) : null);
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
  const onKeyDown = (0, import_react9.useCallback)((e) => {
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
  const popup = open ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(MentionPopup, { matches, index, labels, onHover: setIndex, onPick: choose }) : null;
  return { onKeyDown, onSelect: recompute, popup, open };
}
function MentionPopup({ matches, index, labels, onHover, onPick }) {
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { style: POP.anchor, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("ul", { role: "listbox", "aria-label": labels?.title ?? "Direct to", style: POP.list, children: [
    labels?.title && /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("li", { "aria-hidden": true, style: POP.group, children: labels.title }),
    matches.map((m, i) => /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
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
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Avatar, { name: m.name, kind: m.kind, size: 20 }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { style: POP.name, children: m.name }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { style: POP.kind, children: m.kind === "agent" ? labels?.agent ?? "Agent" : labels?.human ?? "Person" })
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
var import_react15 = require("react");

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
  inheritedHint: "This build shares its parent project\u2019s Evermind, so everything it has learned is available here. Training and settings live on the parent project.",
  statusSeeded: (v) => `Learning \xB7 v${v}`,
  statusUnseeded: "Not set up",
  quarantinedBadge: "Quarantined",
  quarantinedHint: (reason) => `This Evermind auto-disabled after producing incoherent output (${reason}). Retrain it past the coherence bar to re-enable inference.`,
  targetsTitle: "Everminds under this project",
  targetsHint: "Every Evermind this project contributes learning to.",
  targetsEmpty: "No Everminds resolved for this project yet.",
  targetSelfBadge: "This project",
  targetBuildBadge: "IDE build",
  targetSeeded: (version) => `v${version}`,
  targetUnseeded: "not seeded",
  targetInferenceOn: "inference",
  targetConnected: "connected",
  targetFrozen: "frozen",
  targetProjectId: (id) => `project #${id}`,
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
  taughtDistilled: (m, v) => `Taught: ${m} answered it and the model learned that answer (v${v}).`,
  taughtSelf: (v) => `Taught: learned from your text, with no teacher model (v${v}).`,
  taughtTeacherFault: (m, reason) => `Learned, but the teacher ${m} produced nothing (${reason}) \u2014 so the model learned your raw text, not an ideal answer.`,
  taughtDropped: "Not learned: the merge could not use this contribution.",
  taughtStillPending: "Still queued \u2014 this will merge on the next learning pass.",
  teachTeacherTitle: "Teach a task",
  teachTeacherHint: (m) => `Describe a task and ${m} answers it \u2014 your Evermind learns from the ideal answer. No transcript needed.`,
  teachTaskPlaceholder: "Describe a task to teach \u2014 the teacher will answer it\u2026",
  teachTeacherCta: "Teach from teacher",
  flushCta: "Learn now",
  flushing: "Learning\u2026",
  flushedNone: "Nothing queued to learn yet.",
  flushedN: (merged, version) => `Merged ${merged} contribution(s) into v${version}.`,
  importTitle: "Import from builderforce-memory",
  importHint: "Fold a local memory snapshot into this model, then compact the absorbed facts to stubs so they stop filling your context.",
  importCta: "Import & compact\u2026",
  importing: "Importing\u2026",
  importDone: (absorbed, version, compacted, savedKb) => `Absorbed ${absorbed} memor${absorbed === 1 ? "y" : "ies"} into v${version}; compacted ${compacted} to stubs (~${savedKb} KB recovered).`,
  importNothing: "Nothing to import \u2014 no learnable facts in that file.",
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
  notDistilled: "Not distilled",
  distilledBy: (model) => `via ${model}`,
  teacherFault: (model, reason) => `The teacher${model ? ` (${model})` : ""} produced no answer (${reason}), so nothing was learned for this task. Check the pinned teacher model and your frontier credit, then teach it again.`,
  testTitle: "Test bench",
  testHint: "Run a prompt through the model and see exactly what it writes, graded the same way a real reply is. This is how you check the model is worth switching on \u2014 before anyone chats with it.",
  testPlaceholder: "Ask the model something, e.g. \u201CSummarise where this project stands.\u201D",
  testRunCta: "Run prompt",
  testReadinessCta: "Readiness check",
  testRunning: "Generating\u2026",
  testResultReadiness: (passed, total) => `Readiness check \u2014 ${passed} of ${total} answers usable`,
  testResultPrompt: "What the model produced",
  testServable: "Usable",
  testRefused: "Refused",
  testRefusedBecause: (detail) => `This would not be shown to a user: ${detail}.`,
  testEmptyOutput: "(the model produced nothing)",
  testVerdictReady: "This model is coherent enough to serve replies.",
  testVerdictNotReady: "This model is not coherent enough to serve replies yet. Teach it more, set a teacher model, or re-seed it below.",
  maintenanceTitle: "Maintenance",
  maintenanceHint: "Repair and tidy the model when it has gone wrong. None of this deletes your project\u2019s work.",
  reseedLabel: "Replace the model",
  reseedHint: "Start over from a known-good base, keeping the project. Use this when the model has trained itself into nonsense. Replies stay switched off until it passes a readiness check again.",
  reseedCta: "Replace\u2026",
  reseedConfirm: "Replace this model\u2019s brain with a fresh base? What it has learned so far will no longer shape its answers. This cannot be undone.",
  reseedStarterOption: "Fresh starter base (untrained)",
  reseedDone: (version) => `Model replaced \u2014 now at v${version}. Run a readiness check before switching replies back on.`,
  reindexLabel: "Rebuild recall index",
  reindexHint: "Re-file every memory against the current model. Memories are filed when they are learned, so recall drifts as the model changes \u2014 rebuild if it starts recalling the wrong things.",
  reindexCta: "Rebuild index",
  reindexDone: (reindexed) => `Re-filed ${reindexed} memor${reindexed === 1 ? "y" : "ies"}.`,
  cleanupLabel: "Clean up",
  cleanupHint: "Throw away anything queued but not yet learned, and clear cached answers so repeat questions are answered fresh. Learned knowledge is untouched.",
  cleanupCta: "Clean up",
  cleanupConfirm: "Discard everything queued but not yet learned, and clear cached answers?",
  cleanupDone: (discarded, cached) => `Discarded ${discarded} queued item(s) and cleared ${cached} cached answer(s).`,
  analyzeTitle: "Check what it has learned",
  analyzeHint: "Read back everything the model has learned and have a frontier model check it for mistakes, stale facts and nonsense \u2014 then fix what is wrong by teaching the corrections.",
  analyzeCta: "Check knowledge",
  analyzing: "Checking\u2026",
  analyzeClean: (analyzed) => `Checked ${analyzed} memor${analyzed === 1 ? "y" : "ies"} \u2014 nothing looks wrong.`,
  analyzeSummary: (issues, analyzed, model) => `${issues} of ${analyzed} memories need attention (checked by ${model}).`,
  analyzeSummaryLocal: (issues, analyzed) => `${issues} of ${analyzed} memories need attention.`,
  analyzeVerdict: (verdict) => ({
    ok: "Fine",
    incoherent: "Nonsense",
    incorrect: "Wrong",
    outdated: "Out of date",
    unusable: "Not an answer",
    redundant: "Duplicate"
  })[verdict] ?? verdict,
  analyzeCorrectionLabel: "Will be replaced with",
  analyzeSelectAll: "Select all",
  analyzeSelectNone: "Clear selection",
  analyzeApplyCta: (count) => `Fix ${count} selected`,
  analyzeApplying: "Fixing\u2026",
  analyzeApplied: (corrected, forgotten, version) => `${corrected} corrected and re-taught, ${forgotten} removed from recall (already-learned influence is superseded by the correction, not erased). Model is now at v${version}.`,
  analyzeCoverage: (analyzed, total) => `Reviewed the ${analyzed} most recent of ${total} memories \u2014 run again to continue through the rest.`,
  analyzeSkipped: (count) => `${count} could not be applied.`,
  tabsLabel: "Evermind controls",
  tabTeach: "Teach",
  tabTest: "Test",
  tabCheck: "Check",
  tabMaintain: "Maintain",
  diagnosticsTitle: "Diagnostics",
  diagnosticsHint: "Copy everything on this panel \u2014 the model\u2019s state, what it actually produced, what it has learned and any problems found \u2014 as text you can paste to support or to an AI assistant.",
  diagnosticsCta: "Copy diagnostics",
  diagnosticsCopied: "Copied to your clipboard.",
  diagnosticsShow: "Show report",
  diagnosticsHide: "Hide report",
  diagnosticsManualHint: "Copying automatically was blocked here \u2014 the report is selected below, press Ctrl/Cmd+C to copy it.",
  refresh: "Refresh",
  errorGeneric: "Something went wrong. Try again."
};

// src/evermind/learnedStatus.ts
function evermindLearnedStatus(entry) {
  if (entry.kind === "delta") return { state: "delta" };
  if (entry.distilled) {
    return { state: "distilled", ...entry.teacherModel ? { teacherModel: entry.teacherModel } : {} };
  }
  if (entry.skipReason) {
    if (entry.skipReason === "not_pinned" || entry.skipReason === "legacy") return { state: "self" };
    return {
      state: "fault",
      reason: entry.skipReason,
      ...entry.attemptedTeacherModel ? { teacherModel: entry.attemptedTeacherModel } : {},
      ...entry.skipDetail ? { detail: entry.skipDetail } : {}
    };
  }
  const prompt = entry.prompt?.trim();
  const text = entry.text?.trim();
  if (prompt && text && prompt === text) return { state: "fault", reason: "unknown" };
  return { state: "self" };
}

// src/evermind/actionGuide.ts
function evermindNextAction(input) {
  if (!input.seeded) return { id: "seed", tone: "attention", title: "Set up the model", detail: "Choose a known-good base before teaching or serving replies.", destination: "Setup", cta: "Choose base model" };
  if (input.quarantinedAt) {
    if (input.probe?.ready) return { id: "enable", tone: "good", title: "Readiness passed \u2014 enable replies", detail: "The current version passed the coherence gate and can be promoted back to serving.", destination: "Run on Evermind", cta: "Enable replies" };
    if (input.probe && !input.probe.ready && !input.teacherModel) return { id: "teacher", tone: "danger", title: "Readiness failed \u2014 add a teacher", detail: "Pin a frontier teacher so future tasks become clean exemplars instead of raw run transcripts, then teach and test again.", destination: "Teach \u2192 Teacher model", cta: "Choose teacher" };
    if (input.probe && !input.probe.ready) return { id: "check", tone: "danger", title: "Readiness failed \u2014 check learned knowledge", detail: "Audit recent learnings, repair bad memories, then rerun the readiness check.", destination: "Check", cta: "Check knowledge" };
    return { id: "test", tone: "danger", title: "Quarantined \u2014 run readiness first", detail: "Replies are safely off. Test the current version before changing inference or replacing the model.", destination: "Test \u2192 Readiness check", cta: "Run readiness check" };
  }
  const recent = input.recent ?? [];
  const teacherFaults = recent.filter((entry) => evermindLearnedStatus(entry).state === "fault").length;
  if (teacherFaults > 0) return { id: "teacher", tone: "danger", title: "Fix failed distillation", detail: `${teacherFaults} recent learning${teacherFaults === 1 ? "" : "s"} received no usable teacher answer. Check the pinned teacher before teaching again.`, destination: "Teach \u2192 Teacher model", cta: "Check teacher" };
  if ((input.pending ?? 0) > 0) return { id: "merge", tone: "attention", title: "Merge queued learning", detail: `${input.pending} contribution${input.pending === 1 ? " is" : "s are"} waiting to be folded into the next version.`, destination: "Teach \u2192 Learn now", cta: "Learn now" };
  if ((input.eval?.delta ?? 0) < 0) return { id: "check", tone: "attention", title: "Review the latest regression", detail: "Held-out loss increased on the latest version. Audit what changed before serving it.", destination: "Check", cta: "Check knowledge" };
  if (!input.inferenceEnabled) return { id: "test", tone: "attention", title: "Test before enabling replies", detail: "Run the readiness suite against the current version, then enable inference only if it passes.", destination: "Test \u2192 Readiness check", cta: "Run readiness check" };
  if (input.mode === "offline-frozen") return { id: "learn", tone: "neutral", title: "Learning is frozen", detail: "Replies are live, but completed work is not updating this model.", destination: "Learning", cta: "Connect learning" };
  return { id: "none", tone: "good", title: "No action required", detail: "Learning is connected and replies are enabled. Review recent learnings as new work lands.", destination: "Recently learned", cta: "Review learnings" };
}

// src/evermind/EvermindTestBench.tsx
var import_react10 = require("react");

// src/evermind/consoleStyles.ts
var C = {
  surface: "var(--bf-ev-surface, var(--bg-surface, var(--bf-surface, var(--vscode-editorWidget-background, transparent))))",
  surface2: "var(--bf-ev-surface-2, var(--bg-elevated, var(--bf-surface-2, var(--vscode-textBlockQuote-background, rgba(148,163,184,0.08)))))",
  border: "var(--bf-ev-border, var(--border-subtle, var(--bf-border, var(--vscode-panel-border, rgba(148,163,184,0.3)))))",
  text: "var(--bf-ev-text, var(--text-primary, var(--bf-text, inherit)))",
  text2: "var(--bf-ev-text-2, var(--text-secondary, var(--bf-text-muted, #6b7280)))",
  accent: "var(--bf-ev-accent, var(--coral-bright, var(--accent, var(--bf-accent, #ff6b5e))))",
  danger: "var(--bf-ev-danger, var(--danger-text, #d9534f))",
  ok: "var(--bf-ev-ok, var(--success-text, #16a34a))",
  warnText: "var(--bf-warn-text, #92400e)",
  warnBg: "var(--bf-warn-bg, #fef3c7)",
  warnBorder: "var(--bf-warn-border, #f59e0b)"
};
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
var optionStyle = nativeOptionStyle;
var sectionBlock = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  borderTop: `1px solid ${C.border}`,
  paddingTop: 10
};
var outputBox = {
  fontFamily: "var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace)",
  fontSize: "0.74rem",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  padding: "8px 10px",
  color: C.text,
  maxHeight: 220,
  overflow: "auto"
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
function dangerBtn(disabled) {
  return {
    padding: "8px 14px",
    fontSize: "0.8rem",
    fontWeight: 600,
    borderRadius: 8,
    border: `1px solid ${disabled ? C.border : C.danger}`,
    background: "transparent",
    color: disabled ? C.text2 : C.danger,
    cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
    opacity: disabled ? 0.7 : 1
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
function tag(muted) {
  return {
    fontSize: "0.64rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    padding: "1px 6px",
    borderRadius: 5,
    border: `1px solid ${C.border}`,
    color: muted ? C.text2 : C.accent,
    background: C.surface
  };
}
function verdictTag(tone) {
  const color = tone === "ok" ? C.ok : tone === "warn" ? C.warnText : C.danger;
  return {
    fontSize: "0.62rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    padding: "1px 6px",
    borderRadius: 5,
    whiteSpace: "nowrap",
    color,
    border: `1px solid ${color}`,
    ...tone === "warn" ? { background: C.warnBg } : {}
  };
}
var warnBox = {
  margin: 0,
  fontSize: "0.74rem",
  lineHeight: 1.5,
  borderRadius: 6,
  padding: "6px 8px",
  color: C.warnText,
  background: C.warnBg,
  border: `1px solid ${C.warnBorder}`
};

// src/evermind/EvermindTestBench.tsx
var import_jsx_runtime13 = require("react/jsx-runtime");
function EvermindTestBench({ t, disabled, onProbe, result, onResult }) {
  const [prompt, setPrompt] = (0, import_react10.useState)("");
  const [running, setRunning] = (0, import_react10.useState)(false);
  const [error, setError] = (0, import_react10.useState)(null);
  const run = (0, import_react10.useCallback)(async (withPrompt) => {
    setRunning(true);
    setError(null);
    try {
      onResult(await onProbe(withPrompt ? prompt.trim() : void 0));
    } catch (err) {
      onResult(null);
      setError(err instanceof Error ? err.message : t.errorGeneric);
    } finally {
      setRunning(false);
    }
  }, [onProbe, onResult, prompt, t.errorGeneric]);
  const busy = disabled || running;
  const canRunPrompt = prompt.trim().length >= 3;
  const passed = result?.samples.filter((s) => s.coherent).length ?? 0;
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { style: sectionBlock, children: [
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { style: fieldTitle, children: t.testTitle }),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { style: fieldHint, children: t.testHint }),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
      "textarea",
      {
        value: prompt,
        onChange: (e) => setPrompt(e.target.value),
        disabled: busy,
        placeholder: t.testPlaceholder,
        rows: 2,
        style: { ...select, width: "100%", resize: "vertical", fontFamily: "inherit" }
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("button", { type: "button", onClick: () => void run(true), disabled: busy || !canRunPrompt, style: primaryBtn(busy || !canRunPrompt), children: running ? t.testRunning : t.testRunCta }),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("button", { type: "button", onClick: () => void run(false), disabled: busy, style: secondaryBtn(busy), children: t.testReadinessCta })
    ] }),
    error && /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { style: { margin: 0, fontSize: "0.76rem", color: C.danger }, role: "alert", children: error }),
    result && /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 8, marginTop: 2 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { style: { ...fieldTitle, flex: "1 1 auto", minWidth: 0 }, children: result.mode === "readiness" ? t.testResultReadiness(passed, result.samples.length) : t.testResultPrompt }),
        /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { style: verdictTag(result.ready ? "ok" : "bad"), children: result.ready ? t.testServable : t.testRefused })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { style: { margin: 0, fontSize: "0.74rem", lineHeight: 1.5, color: result.ready ? C.text2 : C.danger }, children: result.ready ? t.testVerdictReady : t.testVerdictNotReady }),
      result.samples.map((s, i) => /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 4 }, children: [
        result.samples.length > 1 && /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { style: verdictTag(s.coherent ? "ok" : "bad"), children: s.coherent ? t.testServable : t.testRefused }),
          /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { style: { fontSize: "0.72rem", fontWeight: 600, color: C.text, wordBreak: "break-word", minWidth: 0 }, children: s.prompt })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { style: outputBox, children: s.text.trim() || t.testEmptyOutput }),
        !s.coherent && s.detail && /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { style: { ...italic, color: C.danger, fontStyle: "normal", fontSize: "0.72rem" }, children: t.testRefusedBecause(s.detail) })
      ] }, `${s.prompt}-${i}`))
    ] })
  ] });
}

// src/evermind/EvermindMaintenance.tsx
var import_react11 = require("react");
var import_jsx_runtime14 = require("react/jsx-runtime");
function EvermindMaintenance({
  t,
  disabled,
  seedModels,
  onReseed,
  onReindex,
  onCleanup
}) {
  const [slug, setSlug] = (0, import_react11.useState)("");
  const [pending, setPending] = (0, import_react11.useState)(null);
  const doReseed = (0, import_react11.useCallback)(async () => {
    setPending(null);
    await onReseed?.(slug || void 0);
  }, [onReseed, slug]);
  const doCleanup = (0, import_react11.useCallback)(async () => {
    setPending(null);
    await onCleanup?.();
  }, [onCleanup]);
  if (!onReseed && !onReindex && !onCleanup) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { style: sectionBlock, children: [
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { style: fieldTitle, children: t.maintenanceTitle }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { style: fieldHint, children: t.maintenanceHint }),
    onReindex && /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
      Row,
      {
        title: t.reindexLabel,
        hint: t.reindexHint,
        action: /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("button", { type: "button", onClick: () => void onReindex(), disabled, style: secondaryBtn(disabled), children: t.reindexCta })
      }
    ),
    onCleanup && /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
      Row,
      {
        title: t.cleanupLabel,
        hint: t.cleanupHint,
        action: /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("button", { type: "button", onClick: () => setPending("cleanup"), disabled: disabled || pending === "cleanup", style: secondaryBtn(disabled || pending === "cleanup"), children: t.cleanupCta }),
        confirm: pending === "cleanup" ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
          Confirm,
          {
            message: t.cleanupConfirm,
            confirmLabel: t.cleanupCta,
            cancelLabel: t.validateClear,
            disabled,
            onConfirm: () => void doCleanup(),
            onCancel: () => setPending(null)
          }
        ) : null
      }
    ),
    onReseed && /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
      Row,
      {
        title: t.reseedLabel,
        hint: t.reseedHint,
        action: /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)(
            "select",
            {
              value: slug,
              onChange: (e) => setSlug(e.target.value),
              disabled,
              "aria-label": t.reseedLabel,
              style: { ...select, maxWidth: 200 },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("option", { value: "", style: optionStyle, children: t.reseedStarterOption }),
                seedModels.map((m) => /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("option", { value: m.slug, style: optionStyle, children: m.name }, m.slug))
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("button", { type: "button", onClick: () => setPending("reseed"), disabled: disabled || pending === "reseed", style: dangerBtn(disabled || pending === "reseed"), children: t.reseedCta })
        ] }),
        confirm: pending === "reseed" ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
          Confirm,
          {
            message: t.reseedConfirm,
            confirmLabel: t.reseedCta,
            cancelLabel: t.validateClear,
            danger: true,
            disabled,
            onConfirm: () => void doReseed(),
            onCancel: () => setPending(null)
          }
        ) : null
      }
    )
  ] });
}
function Row({ title, hint, action, confirm }) {
  return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { style: { display: "flex", gap: 10, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { style: { flex: "1 1 200px", minWidth: 0 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { style: { fontSize: "0.8rem", fontWeight: 600, color: C.text }, children: title }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { style: fieldHint, children: hint })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { style: { flex: "0 1 auto" }, children: action })
    ] }),
    confirm
  ] });
}
function Confirm({
  message,
  confirmLabel,
  cancelLabel,
  danger,
  disabled,
  onConfirm,
  onCancel
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { style: { ...warnBox, display: "flex", flexDirection: "column", gap: 8 }, role: "alertdialog", "aria-label": message, children: [
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", { children: message }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("button", { type: "button", onClick: onConfirm, disabled, style: danger ? dangerBtn(disabled) : secondaryBtn(disabled), children: confirmLabel }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("button", { type: "button", onClick: onCancel, disabled, style: secondaryBtn(disabled), children: cancelLabel })
    ] })
  ] });
}

// src/evermind/EvermindAnalyzer.tsx
var import_react12 = require("react");
var import_jsx_runtime15 = require("react/jsx-runtime");
var TONE = {
  ok: "ok",
  incoherent: "bad",
  incorrect: "bad",
  outdated: "warn",
  unusable: "bad",
  redundant: "warn"
};
function EvermindAnalyzer({ t, disabled, onAnalyze, onApply, onRepaired, analysis, onAnalysis }) {
  const [selected, setSelected] = (0, import_react12.useState)(/* @__PURE__ */ new Set());
  const [running, setRunning] = (0, import_react12.useState)(false);
  const [applying, setApplying] = (0, import_react12.useState)(false);
  const [repair, setRepair] = (0, import_react12.useState)(null);
  const [error, setError] = (0, import_react12.useState)(null);
  (0, import_react12.useEffect)(() => {
    setSelected(new Set(analysis?.findings.map((f) => f.id) ?? []));
  }, [analysis]);
  const run = (0, import_react12.useCallback)(async () => {
    setRunning(true);
    setError(null);
    setRepair(null);
    try {
      onAnalysis(await onAnalyze());
    } catch (err) {
      onAnalysis(null);
      setError(err instanceof Error ? err.message : t.errorGeneric);
    } finally {
      setRunning(false);
    }
  }, [onAnalyze, onAnalysis, t.errorGeneric]);
  const apply = (0, import_react12.useCallback)(async () => {
    if (!onApply || !analysis) return;
    const picked = analysis.findings.filter((f) => selected.has(f.id));
    if (picked.length === 0) return;
    setApplying(true);
    setError(null);
    try {
      setRepair(await onApply(picked));
      onAnalysis(null);
      onRepaired?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errorGeneric);
    } finally {
      setApplying(false);
    }
  }, [analysis, onAnalysis, onApply, onRepaired, selected, t.errorGeneric]);
  const toggle = (0, import_react12.useCallback)((id) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const findings = analysis?.findings ?? [];
  const allSelected = (0, import_react12.useMemo)(() => findings.length > 0 && findings.every((f) => selected.has(f.id)), [findings, selected]);
  const busy = disabled || running || applying;
  return /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { style: sectionBlock, children: [
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { style: fieldTitle, children: t.analyzeTitle }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { style: fieldHint, children: t.analyzeHint }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("button", { type: "button", onClick: () => void run(), disabled: busy, style: secondaryBtn(busy), children: running ? t.analyzing : t.analyzeCta }),
      findings.length > 0 && onApply && /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(import_jsx_runtime15.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("button", { type: "button", onClick: () => void apply(), disabled: busy || selected.size === 0, style: primaryBtn(busy || selected.size === 0), children: applying ? t.analyzeApplying : t.analyzeApplyCta(selected.size) }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
          "button",
          {
            type: "button",
            onClick: () => setSelected(allSelected ? /* @__PURE__ */ new Set() : new Set(findings.map((f) => f.id))),
            disabled: busy,
            style: linkBtn,
            children: allSelected ? t.analyzeSelectNone : t.analyzeSelectAll
          }
        )
      ] })
    ] }),
    error && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { style: { margin: 0, fontSize: "0.76rem", color: C.danger }, role: "alert", children: error }),
    repair && /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("p", { style: { margin: 0, fontSize: "0.76rem", color: C.accent }, role: "status", children: [
      t.analyzeApplied(repair.corrected, repair.forgotten, repair.version),
      repair.skipped.length > 0 ? ` ${t.analyzeSkipped(repair.skipped.length)}` : ""
    ] }),
    analysis?.warning && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { style: warnBox, role: "note", children: analysis.warning }),
    analysis && findings.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { style: italic, children: t.analyzeClean(analysis.analyzed) }),
    analysis?.truncated && typeof analysis.total === "number" && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { style: italic, children: t.analyzeCoverage(analysis.analyzed, analysis.total) }),
    analysis && findings.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(import_jsx_runtime15.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { style: { margin: 0, fontSize: "0.74rem", color: C.text2 }, children: analysis.model ? t.analyzeSummary(findings.length, analysis.analyzed, analysis.model) : t.analyzeSummaryLocal(findings.length, analysis.analyzed) }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("ul", { style: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }, children: findings.map((f) => /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
        FindingRow,
        {
          t,
          finding: f,
          selectable: !!onApply,
          selected: selected.has(f.id),
          disabled: busy,
          onToggle: () => toggle(f.id)
        },
        f.id
      )) })
    ] })
  ] });
}
function FindingRow({
  t,
  finding,
  selected,
  selectable,
  disabled,
  onToggle
}) {
  const tone = TONE[finding.verdict] ?? "warn";
  return /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("li", { style: {
    background: C.surface2,
    border: `1px solid ${selected ? C.accent : C.border}`,
    borderRadius: 8,
    padding: "8px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 5
  }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }, children: [
      selectable && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
        "input",
        {
          type: "checkbox",
          checked: selected,
          onChange: onToggle,
          disabled,
          "aria-label": finding.issue,
          style: { margin: 0, cursor: disabled ? "not-allowed" : "pointer" }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { style: verdictTag(tone), children: t.analyzeVerdict(finding.verdict) }),
      finding.prompt && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { style: { fontSize: "0.74rem", fontWeight: 600, color: C.text, wordBreak: "break-word", minWidth: 0 }, children: finding.prompt })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { style: { fontSize: "0.74rem", lineHeight: 1.45, color: C.text }, children: finding.issue }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { style: { ...outputBox, maxHeight: 96, fontSize: "0.7rem", color: C.text2 }, children: finding.excerpt }),
    finding.correction && /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 3 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { style: { fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.04em", color: C.text2 }, children: t.analyzeCorrectionLabel }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { style: { ...outputBox, maxHeight: 140, fontSize: "0.7rem" }, children: finding.correction })
    ] })
  ] });
}

// src/evermind/EvermindDiagnostics.tsx
var import_react13 = require("react");
var import_jsx_runtime16 = require("react/jsx-runtime");
function useDiagnosticsCopy({ buildReport, onCopy, onManualFallback }) {
  const [report, setReport] = (0, import_react13.useState)(null);
  const [copied, setCopied] = (0, import_react13.useState)(false);
  const [revealed, setRevealed] = (0, import_react13.useState)(false);
  const copy = (0, import_react13.useCallback)(async () => {
    const text = buildReport();
    setReport(text);
    try {
      if (onCopy) await onCopy(text);
      else if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else throw new Error("no clipboard");
      setCopied(true);
      setRevealed(false);
    } catch {
      setCopied(false);
      setRevealed(true);
      onManualFallback?.();
    }
  }, [buildReport, onCopy, onManualFallback]);
  const toggleReveal = (0, import_react13.useCallback)(() => setRevealed((v) => !v), []);
  return { report, copied, revealed, copy, toggleReveal };
}
function EvermindDiagnostics({ t, disabled, copy }) {
  const { report, copied, revealed } = copy;
  const areaRef = (0, import_react13.useRef)(null);
  (0, import_react13.useEffect)(() => {
    if (!revealed) return;
    areaRef.current?.focus();
    areaRef.current?.select();
  }, [revealed]);
  return /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { style: sectionBlock, children: [
    /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("div", { style: fieldTitle, children: t.diagnosticsTitle }),
    /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("div", { style: fieldHint, children: t.diagnosticsHint }),
    /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { type: "button", onClick: () => void copy.copy(), disabled, style: secondaryBtn(disabled), children: t.diagnosticsCta }),
      report !== null && /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { type: "button", onClick: copy.toggleReveal, style: linkBtn, children: revealed ? t.diagnosticsHide : t.diagnosticsShow })
    ] }),
    revealed && report !== null && /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(import_jsx_runtime16.Fragment, { children: [
      !copied && /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { style: { margin: 0, fontSize: "0.72rem", color: C.text2, lineHeight: 1.4 }, children: t.diagnosticsManualHint }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
        "textarea",
        {
          ref: areaRef,
          readOnly: true,
          value: report,
          rows: 12,
          "aria-label": t.diagnosticsTitle,
          onFocus: (e) => e.currentTarget.select(),
          style: { ...outputBox, width: "100%", maxHeight: 320, resize: "vertical", boxSizing: "border-box" }
        }
      )
    ] })
  ] });
}

// src/evermind/ConsoleTabs.tsx
var import_react14 = require("react");
var import_jsx_runtime17 = require("react/jsx-runtime");
function ConsoleTabs({ tabs, activeId, onSelect, label, idPrefix }) {
  const stripRef = (0, import_react14.useRef)(null);
  const onKeyDown = (0, import_react14.useCallback)((e) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.id === activeId);
    const last = tabs.length - 1;
    const next = e.key === "Home" ? 0 : e.key === "End" ? last : e.key === "ArrowLeft" ? i <= 0 ? last : i - 1 : i >= last ? 0 : i + 1;
    const target = tabs[next];
    if (!target) return;
    onSelect(target.id);
    stripRef.current?.querySelector(`[id="${idPrefix}-tab-${target.id}"]`)?.focus();
  }, [activeId, idPrefix, onSelect, tabs]);
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  return /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 10 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
      "div",
      {
        ref: stripRef,
        role: "tablist",
        "aria-label": label,
        onKeyDown,
        style: {
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          borderBottom: `1px solid ${C.border}`,
          paddingBottom: 0,
          marginTop: 2
        },
        children: tabs.map((tab) => {
          const selected = tab.id === active?.id;
          return /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)(
            "button",
            {
              id: `${idPrefix}-tab-${tab.id}`,
              type: "button",
              role: "tab",
              "aria-selected": selected,
              "aria-controls": `${idPrefix}-panel-${tab.id}`,
              tabIndex: selected ? 0 : -1,
              onClick: () => onSelect(tab.id),
              style: {
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 12px",
                fontSize: "0.79rem",
                fontWeight: selected ? 700 : 600,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: selected ? C.accent : C.text2,
                // The active marker is a bottom rule flush with the strip's own border,
                // so the selected tab reads as attached to its panel in both themes
                // without depending on a filled background colour.
                boxShadow: selected ? `inset 0 -2px 0 0 ${C.accent}` : "none",
                whiteSpace: "nowrap"
              },
              children: [
                tab.label,
                tab.badge && /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
                  "span",
                  {
                    "aria-hidden": true,
                    style: {
                      fontSize: "0.62rem",
                      fontWeight: 700,
                      lineHeight: 1.6,
                      minWidth: 16,
                      textAlign: "center",
                      padding: "0 5px",
                      borderRadius: 999,
                      color: tab.badgeTone === "bad" ? C.danger : C.text2,
                      border: `1px solid ${tab.badgeTone === "bad" ? C.danger : C.border}`
                    },
                    children: tab.badge
                  }
                )
              ]
            },
            tab.id
          );
        })
      }
    ),
    active && /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
      "div",
      {
        id: `${idPrefix}-panel-${active.id}`,
        role: "tabpanel",
        "aria-labelledby": `${idPrefix}-tab-${active.id}`,
        tabIndex: 0,
        style: { display: "flex", flexDirection: "column", gap: 10, outline: "none" },
        children: active.content
      }
    )
  ] });
}

// src/evermind/diagnosticsReport.ts
var MAX_OUTPUT_CHARS = 1200;
var MAX_EXCERPT_CHARS = 400;
var MAX_RECENT = 10;
var MAX_FINDINGS = 20;
function clamp(text, max) {
  const s = text.trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max)}
\u2026[truncated ${s.length - max} more characters]`;
}
function fence(text) {
  return `~~~
${text || "(empty)"}
~~~`;
}
function yesNo(v) {
  return v ? "yes" : "no";
}
function isoOrNever(value) {
  return value ? new Date(value).toISOString() : "never";
}
function headSection(d) {
  const lines = [
    "## Model state",
    "",
    `- Version: v${d.version}`,
    `- Seeded: ${yesNo(d.seeded)}`,
    `- Learning: ${d.mode === "connected" ? "connected" : "frozen"}`,
    `- Serving replies (inference): ${d.inferenceEnabled ? "ON" : "off"}`,
    `- Teacher model: ${d.teacherModel || "none (learns from raw runs)"}`,
    `- Learned contributions: ${d.contributions}`,
    `- Queued (unmerged): ${d.pending}`,
    `- Last learned: ${isoOrNever(d.lastLearnedAt)}`
  ];
  if (d.inherited) {
    lines.push(`- INHERITED from project #${d.inheritedFromProjectId ?? "?"} (this build has no Evermind of its own; the console is read-only)`);
  }
  if (d.quarantinedAt) {
    lines.push(`- QUARANTINED at ${isoOrNever(d.quarantinedAt)} \u2014 ${d.quarantineReason?.trim() || "no reason recorded"}`);
  }
  const e = d.eval;
  if (e) {
    const dir = e.delta > 0 ? "improved" : e.delta < 0 ? "REGRESSED" : "flat";
    lines.push(`- Regression check on v${e.version}: held-out loss ${e.baseLoss.toFixed(4)} \u2192 ${e.newLoss.toFixed(4)} over ${e.evalSize} prior task(s) (${dir})`);
  }
  return lines;
}
function probeSection(p) {
  const passed = p.samples.filter((s) => s.coherent).length;
  const lines = [
    "## Test bench",
    "",
    `- Run: ${p.mode === "readiness" ? "readiness suite (the gate for switching replies on)" : "operator prompt"}`,
    `- Model version: v${p.version}`,
    `- Verdict: ${p.ready ? "WOULD SERVE" : "REFUSED"}`,
    `- Usable answers: ${passed} of ${p.samples.length} (pass rate ${Math.round(p.passRate * 100)}%)`,
    ""
  ];
  p.samples.forEach((s, i) => {
    lines.push(`### Sample ${i + 1} \u2014 ${s.coherent ? "USABLE" : "REFUSED"}`);
    lines.push("");
    lines.push(`Prompt: ${s.prompt}`);
    if (!s.coherent) lines.push(`Rejected by: \`${s.failure ?? "unknown"}\` \u2014 ${s.detail || "no detail"}`);
    lines.push("");
    lines.push("Raw output (verbatim):");
    lines.push(fence(clamp(s.text, MAX_OUTPUT_CHARS)));
    lines.push("");
  });
  return lines;
}
function analysisSection(a) {
  const lines = [
    "## Knowledge audit",
    "",
    `- Memories reviewed: ${a.analyzed}`,
    `- Graded by: ${a.model ?? "local coherence screen only (no frontier reviewer)"}`,
    `- Findings: ${a.findings.length}`
  ];
  if (a.warning) lines.push(`- Partial audit: ${a.warning}`);
  lines.push("");
  if (a.findings.length === 0) {
    lines.push("Nothing flagged.");
    lines.push("");
    return lines;
  }
  for (const f of a.findings.slice(0, MAX_FINDINGS)) {
    lines.push(`### Memory #${f.id} \u2014 ${f.verdict} (${f.source})`);
    lines.push("");
    if (f.prompt) lines.push(`Task: ${f.prompt}`);
    lines.push(`Issue: ${f.issue}`);
    lines.push("");
    lines.push("As learned:");
    lines.push(fence(clamp(f.excerpt, MAX_EXCERPT_CHARS)));
    if (f.correction) {
      lines.push("");
      lines.push("Proposed correction:");
      lines.push(fence(clamp(f.correction, MAX_EXCERPT_CHARS)));
    }
    lines.push("");
  }
  if (a.findings.length > MAX_FINDINGS) {
    lines.push(`_\u2026and ${a.findings.length - MAX_FINDINGS} more finding(s) not included._`);
    lines.push("");
  }
  return lines;
}
function targetsSection(targets) {
  const lines = ["## Everminds under this project", ""];
  targets.forEach((tg, i) => {
    const state = [
      tg.seeded ? `v${tg.version}` : "not seeded",
      tg.mode === "connected" ? "connected" : "frozen",
      tg.inferenceEnabled ? "serving replies" : "not serving"
    ].join(", ");
    lines.push(`- ${i === 0 ? "[this project]" : "[IDE build]"} ${tg.name} (project #${tg.projectId}) \u2014 ${state}`);
  });
  lines.push("");
  return lines;
}
function recentSection(d) {
  const entries = d.recent.slice(0, MAX_RECENT);
  const lines = [`## Recently learned (${entries.length} of ${d.recent.length} shown)`, ""];
  if (entries.length === 0) {
    lines.push("Nothing learned yet.");
    lines.push("");
    return lines;
  }
  for (const e of entries) {
    const when = new Date(e.at).toISOString();
    const status = evermindLearnedStatus(e);
    const provenance = status.state === "distilled" ? `distilled by ${status.teacherModel ?? "a teacher"}` : status.state === "fault" ? `NOT distilled (${status.reason}${status.detail ? `: ${status.detail}` : ""})` : status.state === "self" ? "self-learned from run output" : "weight delta";
    lines.push(`- v${e.version} \xD7${e.weight} ${when} [${e.kind}] ${provenance}`);
    if (e.prompt) lines.push(`  - task: ${clamp(e.prompt, 200)}`);
    if (e.text) lines.push(`  - learned: ${clamp(e.text, 300).replace(/\n/g, " ")}`);
  }
  lines.push("");
  return lines;
}
function buildEvermindDiagnostics(input) {
  const { data, projectName, host, targets, probe, analysis, error, now } = input;
  const lines = [
    `# Evermind diagnostics${projectName ? ` \u2014 ${projectName}` : ""}`,
    "",
    `- Generated: ${new Date(now).toISOString()}`,
    `- Surface: ${host === "vscode" ? "VS Code sidebar" : "web console"}`,
    ""
  ];
  if (error) {
    lines.push("## Last error", "", error, "");
  }
  if (!data) {
    lines.push("## Model state", "", "The console could not load this project\u2019s Evermind \u2014 no head state is available.", "");
    return lines.join("\n");
  }
  lines.push(...headSection(data), "");
  const next = evermindNextAction({
    seeded: data.seeded,
    inferenceEnabled: data.inferenceEnabled,
    mode: data.mode,
    pending: data.pending,
    teacherModel: data.teacherModel,
    quarantinedAt: data.quarantinedAt,
    recent: data.recent,
    eval: data.eval,
    probe
  });
  lines.push("## Recommended next action", "", `- ${next.title}`, `- Why: ${next.detail}`, `- Go to: ${next.destination}`, "");
  if (targets && targets.length > 0) lines.push(...targetsSection(targets));
  if (probe) lines.push(...probeSection(probe));
  else lines.push("## Test bench", "", "_Not run in this session \u2014 run one before exporting to include what the model actually produces._", "");
  if (analysis) lines.push(...analysisSection(analysis));
  lines.push(...recentSection(data));
  return lines.join("\n");
}

// src/evermind/EvermindConsole.tsx
var import_jsx_runtime18 = require("react/jsx-runtime");
var TEACH_POLL_INTERVAL_MS = 3e3;
var TEACH_POLL_TIMEOUT_MS = 12e4;
function EvermindConsole({ adapter, canManage, labels, refreshMs = 2e4, projectName, showRecent = true, showHeaderRefresh = true, refreshSignal, onValidate, host = "web" }) {
  const t = (0, import_react15.useMemo)(() => ({ ...DEFAULT_EVERMIND_LABELS, ...labels ?? {} }), [labels]);
  const [data, setData] = (0, import_react15.useState)(null);
  const [targets, setTargets] = (0, import_react15.useState)(null);
  const [seedModels, setSeedModels] = (0, import_react15.useState)([]);
  const [teacherOpts, setTeacherOpts] = (0, import_react15.useState)(null);
  const [selectedSlug, setSelectedSlug] = (0, import_react15.useState)("");
  const [teachPrompt, setTeachPrompt] = (0, import_react15.useState)("");
  const [teachText, setTeachText] = (0, import_react15.useState)("");
  const [busy, setBusy] = (0, import_react15.useState)(false);
  const [validating, setValidating] = (0, import_react15.useState)(false);
  const [validateResult, setValidateResult] = (0, import_react15.useState)(null);
  const [notice, setNotice] = (0, import_react15.useState)(null);
  const [noticeTone, setNoticeTone] = (0, import_react15.useState)("good");
  const [error, setError] = (0, import_react15.useState)(null);
  const [loaded, setLoaded] = (0, import_react15.useState)(false);
  const [tab, setTab] = (0, import_react15.useState)("teach");
  const [probeResult, setProbeResult] = (0, import_react15.useState)(null);
  const [analysis, setAnalysis] = (0, import_react15.useState)(null);
  const [loadFailed, setLoadFailed] = (0, import_react15.useState)(false);
  const reload = (0, import_react15.useCallback)(async () => {
    const targetsP = adapter.loadTargets?.().catch(() => null);
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
    if (targetsP) {
      const tg = await targetsP;
      if (tg) setTargets(tg);
    }
  }, [adapter]);
  (0, import_react15.useEffect)(() => {
    setLoaded(false);
    void reload();
  }, [reload]);
  (0, import_react15.useEffect)(() => {
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
  (0, import_react15.useEffect)(() => {
    if (!refreshMs) return;
    const id = setInterval(() => {
      if (!busy) void reload();
    }, refreshMs);
    return () => clearInterval(id);
  }, [refreshMs, busy, reload]);
  const lastRefreshSignal = (0, import_react15.useRef)(refreshSignal);
  (0, import_react15.useEffect)(() => {
    if (refreshSignal == null || refreshSignal === lastRefreshSignal.current) return;
    lastRefreshSignal.current = refreshSignal;
    void reload();
  }, [refreshSignal, reload]);
  const runValidate = (0, import_react15.useCallback)(async (prompt) => {
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
  const clearValidate = (0, import_react15.useCallback)(() => {
    setValidateResult(null);
    onValidate?.(null);
  }, [onValidate]);
  const pollTimer = (0, import_react15.useRef)(null);
  const mounted = (0, import_react15.useRef)(true);
  (0, import_react15.useEffect)(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);
  const describeTeachOutcome = (0, import_react15.useCallback)((status) => {
    if (status.state === "dropped") return { text: t.taughtDropped, tone: "warn" };
    if (status.state !== "merged") return { text: t.taughtStillPending, tone: "warn" };
    const verdict = evermindLearnedStatus({
      kind: status.kind ?? "text",
      ...status.distilled !== void 0 ? { distilled: status.distilled } : {},
      ...status.teacherModel ? { teacherModel: status.teacherModel } : {},
      ...status.skipReason ? { skipReason: status.skipReason } : {},
      ...status.skipDetail ? { skipDetail: status.skipDetail } : {},
      ...status.attemptedTeacherModel ? { attemptedTeacherModel: status.attemptedTeacherModel } : {}
    });
    const version = status.version ?? 0;
    if (verdict.state === "distilled") return { text: t.taughtDistilled(verdict.teacherModel ?? "", version), tone: "good" };
    if (verdict.state === "fault") return { text: t.taughtTeacherFault(verdict.teacherModel ?? "", verdict.reason), tone: "warn" };
    return { text: t.taughtSelf(version), tone: "good" };
  }, [t]);
  const trackTeach = (0, import_react15.useCallback)((contributionId) => {
    const readStatus = adapter.teachStatus;
    if (!readStatus || !Number.isInteger(contributionId) || contributionId <= 0) return;
    if (pollTimer.current) clearTimeout(pollTimer.current);
    const deadline = Date.now() + TEACH_POLL_TIMEOUT_MS;
    const tick = async () => {
      let status = null;
      try {
        status = await readStatus(contributionId);
      } catch {
        status = null;
      }
      if (!mounted.current) return;
      if (!status || status.state === "unknown") return;
      if (status.state === "merged" || status.state === "dropped") {
        const outcome = describeTeachOutcome(status);
        setNotice(outcome.text);
        setNoticeTone(outcome.tone);
        if (status.state === "merged") void reload();
        return;
      }
      if (Date.now() >= deadline) {
        setNotice(t.taughtStillPending);
        setNoticeTone("warn");
        return;
      }
      pollTimer.current = setTimeout(() => {
        void tick();
      }, TEACH_POLL_INTERVAL_MS);
    };
    pollTimer.current = setTimeout(() => {
      void tick();
    }, TEACH_POLL_INTERVAL_MS);
  }, [adapter, describeTeachOutcome, reload, t.taughtStillPending]);
  const run = (0, import_react15.useCallback)(async (op, successNotice) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setNoticeTone("good");
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
  const panelId = (0, import_react15.useId)();
  const buildReport = (0, import_react15.useCallback)(() => buildEvermindDiagnostics({
    data,
    projectName,
    host,
    targets,
    probe: probeResult,
    analysis,
    error,
    now: Date.now()
  }), [data, projectName, host, targets, probeResult, analysis, error]);
  const diagnostics = useDiagnosticsCopy({
    buildReport,
    onCopy: adapter.copyText,
    onManualFallback: () => setTab("maintain")
  });
  if (!loaded) return /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(Section, { "aria-busy": true, children: /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { style: { margin: 0, color: C.text2, fontSize: "0.82rem" }, children: t.loading }) });
  const seeded = !!data?.seeded;
  const frozen = data?.mode === "offline-frozen";
  const inherited = !!data?.inherited;
  const quarantined = !!data?.quarantinedAt;
  const quarantineReason = data?.quarantineReason?.trim() || "";
  const nextAction = data ? evermindNextAction({
    seeded: data.seeded,
    inferenceEnabled: data.inferenceEnabled,
    mode: data.mode,
    pending: data.pending,
    teacherModel: data.teacherModel,
    quarantinedAt: data.quarantinedAt,
    recent: data.recent,
    eval: data.eval,
    probe: probeResult
  }) : null;
  const scopeName = projectName?.trim();
  const Header = /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("header", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { "aria-hidden": true, style: { fontSize: "1.05rem" }, children: "\u{1F9E0}" }),
    /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("h3", { style: { margin: 0, fontSize: "0.95rem", fontWeight: 700, color: C.text }, children: t.title }),
    scopeName && /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("span", { style: { fontSize: "0.8rem", color: C.text2 }, title: scopeName, children: [
      "\xB7 ",
      scopeName
    ] }),
    !loadFailed && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: pill(seeded), children: seeded ? t.statusSeeded(data?.version ?? 0) : t.statusUnseeded }),
    !loadFailed && seeded && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(RegressionChip, { t, evalPoint: data?.eval ?? null }),
    !loadFailed && quarantined && /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("span", { style: quarantinePill, title: t.quarantinedHint(quarantineReason), children: [
      "\u26A0 ",
      t.quarantinedBadge
    ] }),
    diagnostics.copied && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { role: "status", style: { fontSize: "0.72rem", color: C.accent }, children: t.diagnosticsCopied }),
    /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("span", { style: { marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(
        "button",
        {
          type: "button",
          onClick: () => void diagnostics.copy(),
          style: { ...ghostBtn, marginLeft: 0, fontSize: "0.72rem", display: "inline-flex", alignItems: "center", gap: 4 },
          title: t.diagnosticsCta,
          "aria-label": t.diagnosticsCta,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { "aria-hidden": true, children: diagnostics.copied ? "\u2713" : "\u29C9" }),
            t.diagnosticsTitle
          ]
        }
      ),
      showHeaderRefresh && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", onClick: () => void reload(), disabled: busy, style: { ...ghostBtn, marginLeft: 0 }, title: t.refresh, "aria-label": t.refresh, children: "\u21BB" })
    ] })
  ] });
  if (loadFailed) {
    return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(Section, { "aria-label": t.title, children: [
      Header,
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { style: { margin: 0, fontSize: "0.8rem", lineHeight: 1.5, color: C.danger }, role: "alert", children: t.errorGeneric }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", onClick: () => void reload(), disabled: busy, style: primaryBtn(busy), children: t.refresh })
    ] });
  }
  const tabs = [];
  if (data && seeded && !inherited) {
    const head = data;
    tabs.push({
      id: "teach",
      label: t.tabTeach,
      // The queue depth belongs here: "3 waiting" is a prompt to press Learn now, and
      // it is the one number that changes while you are on another tab.
      ...head.pending > 0 ? { badge: String(head.pending), badgeTone: "info" } : {},
      content: /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(import_jsx_runtime18.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
          TeacherPicker,
          {
            t,
            canManage,
            busy,
            opts: teacherOpts,
            value: head.teacherModel ?? "",
            onChange: (m) => run(() => adapter.setTeacher(m || null))
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
          TeachBox,
          {
            t,
            busy,
            validating,
            teacherModel: head.teacherModel ?? "",
            prompt: teachPrompt,
            text: teachText,
            onPrompt: setTeachPrompt,
            onText: setTeachText,
            onTeach: () => run(
              async () => {
                const task = teachPrompt.trim();
                const body = teachText.trim();
                const result = head.teacherModel && body.length < 20 && task.length >= 20 ? await adapter.teach(task, task) : await adapter.teach(body, task || void 0);
                setTeachText("");
                setTeachPrompt("");
                if (result?.contributionId) trackTeach(result.contributionId);
              },
              t.taught
            ),
            onValidate: () => runValidate(head.teacherModel ? teachPrompt : teachPrompt.trim() || teachText)
          }
        ),
        validateResult && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(ValidateResults, { t, result: validateResult, onClear: clearValidate }),
        canManage && /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
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
          head.pending > 0 && /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("span", { style: { fontSize: "0.74rem", color: C.text2 }, children: [
            t.pendingLabel,
            ": ",
            head.pending
          ] })
        ] }),
        canManage && adapter.importMemory && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
          ImportBox,
          {
            t,
            busy,
            frozen,
            onImport: () => run(async () => {
              const report = await adapter.importMemory();
              if (!report) return;
              setNotice(
                report.absorbed > 0 ? t.importDone(report.absorbed, report.version, report.compacted, (report.bytesSaved / 1024).toFixed(1)) : t.importNothing
              );
            })
          }
        )
      ] })
    });
    if (adapter.probe) {
      const refused = probeResult ? !probeResult.ready : false;
      tabs.push({
        id: "test",
        label: t.tabTest,
        // A failed readiness check follows you to the other tabs. A refusal you can only
        // see while standing on the tab that found it is a refusal you forget.
        ...refused ? { badge: "!", badgeTone: "bad" } : {},
        content: /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
          EvermindTestBench,
          {
            t,
            disabled: !canManage || busy,
            onProbe: (p) => adapter.probe(p),
            result: probeResult,
            onResult: setProbeResult
          }
        )
      });
    }
    if (canManage && adapter.analyze) {
      const issues = analysis?.findings.length ?? 0;
      tabs.push({
        id: "check",
        label: t.tabCheck,
        ...issues > 0 ? { badge: String(issues), badgeTone: "bad" } : {},
        content: /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
          EvermindAnalyzer,
          {
            t,
            disabled: busy,
            onAnalyze: () => adapter.analyze(),
            ...adapter.applyFindings ? { onApply: (f) => adapter.applyFindings(f) } : {},
            onRepaired: () => void reload(),
            analysis,
            onAnalysis: setAnalysis
          }
        )
      });
    }
    tabs.push({
      id: "maintain",
      label: t.tabMaintain,
      content: /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(import_jsx_runtime18.Fragment, { children: [
        canManage && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
          EvermindMaintenance,
          {
            t,
            disabled: busy,
            seedModels,
            ...adapter.reseed ? {
              onReseed: (slug) => run(async () => {
                const r = await adapter.reseed(slug);
                setNotice(t.reseedDone(r.version));
              })
            } : {},
            ...adapter.reindex ? {
              onReindex: () => run(async () => {
                const r = await adapter.reindex();
                setNotice(t.reindexDone(r.reindexed));
              })
            } : {},
            ...adapter.cleanup ? {
              onCleanup: () => run(async () => {
                const r = await adapter.cleanup();
                setNotice(t.cleanupDone(r.discarded, r.cachedAnswers));
              })
            } : {}
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(EvermindDiagnostics, { t, disabled: busy, copy: diagnostics })
      ] })
    });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(Section, { "aria-label": t.title, children: [
    Header,
    /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { style: { margin: 0, fontSize: "0.8rem", lineHeight: 1.5, color: C.text2 }, children: t.description }),
    !canManage && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { style: { margin: 0, fontSize: "0.72rem", color: C.text2, fontStyle: "italic" }, children: t.managerOnlyHint }),
    inherited && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
      "p",
      {
        style: { margin: 0, fontSize: "0.72rem", lineHeight: 1.5, color: C.text2, fontStyle: "italic" },
        role: "note",
        children: t.inheritedHint
      }
    ),
    quarantined && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { style: warnBox, role: "alert", children: t.quarantinedHint(quarantineReason) }),
    nextAction && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(NextActionCard, { action: nextAction, canAct: canManage && !busy && !inherited, onAction: () => {
      if (nextAction.id === "test") setTab("test");
      else if (nextAction.id === "teacher" || nextAction.id === "merge" || nextAction.id === "learn") setTab("teach");
      else if (nextAction.id === "check") setTab("check");
      else if (nextAction.id === "enable") void run(() => adapter.setInference(true));
    } }),
    targets && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(TargetsList, { t, targets }),
    inherited ? (
      // INHERITED — read-only. This build has no `project_evermind` row of its own;
      // it is displaying its container project's. Every write endpoint keeps exact-id
      // semantics, so a seed/toggle/teach issued here would post to a row that does
      // not exist: zero rows updated, HTTP OK, nothing changes, and the panel keeps
      // rendering the container's unchanged stats. Rendering the stats WITHOUT the
      // controls is the honest surface — the model is genuinely shared and genuinely
      // shown; it is just not managed from here.
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(StatRow, { t, data })
    ) : !seeded ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
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
    ) : /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(import_jsx_runtime18.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(StatRow, { t, data }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
        ConsoleTabs,
        {
          tabs,
          activeId: tabs.some((x) => x.id === tab) ? tab : tabs[0]?.id ?? "teach",
          onSelect: setTab,
          label: t.tabsLabel,
          idPrefix: `ev${panelId}`
        }
      ),
      showRecent && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(RecentList, { t, entries: data?.recent ?? [] })
    ] }),
    notice && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { style: { margin: 0, fontSize: "0.74rem", lineHeight: 1.5, color: noticeTone === "warn" ? C.warnText : C.accent }, role: "status", children: notice }),
    error && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { style: { margin: 0, fontSize: "0.76rem", color: C.danger }, role: "alert", children: error })
  ] });
}
function NextActionCard({ action, canAct, onAction }) {
  const color = action.tone === "danger" ? C.danger : action.tone === "attention" ? C.warnText : action.tone === "good" ? C.accent : C.text2;
  const actionable = !["seed", "none"].includes(action.id);
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("section", { "aria-label": "Recommended next action", style: { display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: "6px 12px", alignItems: "center", padding: "11px 12px", border: `1px solid ${color}`, borderRadius: 10, background: C.surface2 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: { gridColumn: "1 / -1", color, fontSize: "0.62rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }, children: "Recommended next action" }),
    /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { minWidth: 0 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("strong", { style: { display: "block", color: C.text, fontSize: "0.82rem" }, children: action.title }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { style: { margin: "3px 0 0", color: C.text2, fontSize: "0.72rem", lineHeight: 1.45 }, children: action.detail }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("small", { style: { display: "block", marginTop: 5, color, fontSize: "0.66rem", fontWeight: 700 }, children: [
        "Go to: ",
        action.destination
      ] })
    ] }),
    actionable && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", disabled: !canAct, onClick: onAction, style: { border: `1px solid ${color}`, borderRadius: 8, padding: "7px 10px", background: "transparent", color, fontSize: "0.7rem", fontWeight: 800, cursor: canAct ? "pointer" : "not-allowed", opacity: canAct ? 1 : 0.55 }, children: action.cta })
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
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(
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
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { "aria-hidden": true, children: arrow }),
        label
      ]
    }
  );
}
function Section({ children, ...rest }) {
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
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
  if (!canManage) return /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { style: italic, children: t.notSetUp });
  if (models.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { style: italic, children: t.noModels });
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("label", { style: fieldLabel, children: t.pickModelLabel }),
    /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("select", { value: selectedSlug, onChange: (e) => onSelect(e.target.value), disabled: busy, style: { ...select, flex: "1 1 200px" }, children: models.map((m) => /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("option", { value: m.slug, style: optionStyle, children: m.name }, m.slug)) }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", onClick: onSeed, disabled: busy || !selectedSlug, style: primaryBtn(busy || !selectedSlug), children: busy ? t.working : t.enableCta })
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
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(88px, 1fr))", gap: 8 }, children: stats.map((s) => /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: { fontSize: "0.66rem", textTransform: "uppercase", letterSpacing: "0.04em", color: C.text2 }, children: s.label }),
    /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: { fontSize: "0.9rem", fontWeight: 700, color: C.text, marginTop: 2, wordBreak: "break-word" }, children: s.value })
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
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { display: "flex", gap: 10, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { flex: "1 1 200px", minWidth: 0 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: fieldTitle, children: label }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: fieldHint, children: hint })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
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
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: fieldTitle, children: t.teacherLabel }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: fieldHint, children: t.teacherHint })
    ] }),
    !canManage ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: { ...select, color: C.text2 }, children: value || t.teacherNone }) : opts && !opts.isPaid ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { style: italic, children: t.teacherPaidOnly }) : /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("select", { value, onChange: (e) => onChange(e.target.value), disabled: busy, "aria-label": t.teacherLabel, style: { ...select, maxWidth: 340 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("option", { value: "", style: optionStyle, children: t.teacherNone }),
      options.map((m) => /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("option", { value: m, style: optionStyle, children: m }, m))
    ] }),
    value && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: { fontSize: "0.72rem", lineHeight: 1.4, color: C.accent, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px" }, children: t.teacherActiveHint(value) })
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
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: sectionBlock, children: [
    /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: fieldTitle, children: teaching ? t.teachTeacherTitle : t.teachTitle }),
    /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: fieldHint, children: teaching ? t.teachTeacherHint(teacherModel) : t.teachHint }),
    teaching ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("textarea", { value: prompt, onChange: (e) => onPrompt(e.target.value), disabled: busy, placeholder: t.teachTaskPlaceholder, rows: 3, style: { ...select, width: "100%", resize: "vertical", fontFamily: "inherit" } }) : /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(import_jsx_runtime18.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("input", { value: prompt, onChange: (e) => onPrompt(e.target.value), disabled: busy, placeholder: t.teachPromptPlaceholder, style: { ...select, width: "100%" } }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("textarea", { value: text, onChange: (e) => onText(e.target.value), disabled: busy, placeholder: t.teachTextPlaceholder, rows: 3, style: { ...select, width: "100%", resize: "vertical", fontFamily: "inherit" } })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", onClick: onTeach, disabled: busy || !canTeach, style: primaryBtn(busy || !canTeach), children: busy ? t.teaching : teaching ? t.teachTeacherCta : t.teachCta }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", onClick: onValidate, disabled: busy || validating || !canValidate, style: secondaryBtn(busy || validating || !canValidate), title: t.validateHint, children: validating ? t.validating : t.validateCta })
    ] })
  ] });
}
function ImportBox({ t, busy, frozen, onImport }) {
  const disabled = busy || frozen;
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: sectionBlock, children: [
    /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: fieldTitle, children: t.importTitle }),
    /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: fieldHint, children: t.importHint }),
    /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", onClick: onImport, disabled, style: { ...secondaryBtn(disabled), alignSelf: "flex-start" }, children: busy ? t.importing : t.importCta })
  ] });
}
function ValidateResults({ t, result, onClear }) {
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 6, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: { ...fieldTitle, flex: 1, minWidth: 0 }, children: t.validateResultTitle(result.prompt) }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: { fontSize: "0.64rem", fontWeight: 600, color: C.text2, border: `1px solid ${C.border}`, borderRadius: 999, padding: "1px 8px" }, children: t.validateMethod(result.method) }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", onClick: onClear, style: { ...ghostBtn, marginLeft: 0 }, children: t.validateClear })
    ] }),
    result.matches.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { style: italic, children: t.validateEmpty }) : /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("ul", { style: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }, children: result.matches.map((m) => {
      const primary = m.id === result.primaryId;
      const pct = Math.round(m.score * 100);
      return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("li", { style: { display: "flex", flexDirection: "column", gap: 4, border: `1px solid ${primary ? C.accent : C.border}`, borderRadius: 6, padding: "6px 8px", background: C.surface }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }, children: [
          primary && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: tag(false), children: t.validatePrimaryBadge }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: { fontSize: "0.68rem", color: C.text2 }, children: t.versionTag(m.version) }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: { marginLeft: "auto", fontSize: "0.68rem", fontWeight: 700, color: C.accent }, children: t.validateScore(pct) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: { height: 4, borderRadius: 999, background: C.border, overflow: "hidden" }, children: /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: { width: `${pct}%`, height: "100%", background: C.accent } }) }),
        m.prompt && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: { fontSize: "0.74rem", fontWeight: 600, color: C.text, wordBreak: "break-word" }, children: m.prompt }),
        m.text && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: { fontSize: "0.72rem", color: C.text2, lineHeight: 1.4, wordBreak: "break-word", whiteSpace: "pre-wrap", maxHeight: 54, overflow: "hidden" }, children: m.text })
      ] }, m.id);
    }) })
  ] });
}
function TargetsList({ t, targets }) {
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: sectionBlock, children: [
    /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: fieldTitle, children: t.targetsTitle }),
    /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: fieldHint, children: t.targetsHint }),
    targets.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { style: italic, children: t.targetsEmpty }) : /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("ul", { style: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }, children: targets.map((tg, i) => /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(
      "li",
      {
        style: { background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: tag(false), children: i === 0 ? t.targetSelfBadge : t.targetBuildBadge }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: { fontSize: "0.78rem", fontWeight: 600, color: C.text, wordBreak: "break-word", minWidth: 0 }, children: tg.name }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: { fontSize: "0.68rem", color: C.text2 }, children: t.targetProjectId(tg.projectId) }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("span", { style: { marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: targetChip, children: tg.seeded ? t.targetSeeded(tg.version) : t.targetUnseeded }),
            /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: targetChip, children: tg.mode === "connected" ? t.targetConnected : t.targetFrozen }),
            tg.inferenceEnabled && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: { ...targetChip, color: C.accent, borderColor: C.accent }, children: t.targetInferenceOn })
          ] })
        ]
      },
      tg.projectId
    )) })
  ] });
}
function RecentList({ t, entries }) {
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: sectionBlock, children: [
    /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: fieldTitle, children: t.inspectTitle }),
    entries.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { style: italic, children: t.inspectEmpty }) : /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("ul", { style: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }, children: entries.map((e) => /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(RecentRow, { t, entry: e }, e.id)) })
  ] });
}
function RecentRow({ t, entry }) {
  const [open, setOpen] = (0, import_react15.useState)(false);
  const status = evermindLearnedStatus(entry);
  const faulted = status.state === "fault";
  const body = entry.kind === "delta" ? t.deltaEntry : faulted ? "" : entry.text ?? "";
  const hasDetail = entry.kind !== "delta" && (!!entry.prompt || !!entry.text || faulted);
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("li", { style: { background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 3 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: tag(entry.kind === "delta"), children: entry.kind === "delta" ? t.kindDelta : t.kindText }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: { fontSize: "0.68rem", color: C.text2 }, children: t.versionTag(entry.version) }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: { fontSize: "0.68rem", color: C.text2 }, children: t.weightTag(entry.weight) }),
      faulted && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: faultTag, children: t.notDistilled }),
      status.state === "distilled" && status.teacherModel && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: { fontSize: "0.68rem", color: C.text2 }, children: t.distilledBy(status.teacherModel) }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: { marginLeft: "auto", fontSize: "0.68rem", color: C.text2 }, children: t.formatWhen(entry.at) })
    ] }),
    entry.prompt && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: { fontSize: "0.76rem", fontWeight: 600, color: C.text, wordBreak: "break-word" }, children: entry.prompt }),
    open ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: { display: "flex", flexDirection: "column", gap: 6, marginTop: 2 }, children: faulted ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: { fontSize: "0.74rem", color: C.text2, lineHeight: 1.5 }, children: t.teacherFault(status.teacherModel ?? "", status.reason) }) : entry.text && /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: { fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.04em", color: C.text2 }, children: t.detailTextLabel }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: { fontSize: "0.74rem", color: C.text, lineHeight: 1.5, wordBreak: "break-word", whiteSpace: "pre-wrap" }, children: entry.text })
    ] }) }) : body && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { style: { fontSize: "0.74rem", color: C.text2, lineHeight: 1.45, wordBreak: "break-word", whiteSpace: "pre-wrap", maxHeight: 72, overflow: "hidden" }, children: body }),
    hasDetail && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("button", { type: "button", onClick: () => setOpen((v) => !v), style: { ...linkBtn, alignSelf: "flex-start" }, children: open ? t.hideDetail : t.viewDetail })
  ] });
}
var faultTag = {
  fontSize: "0.6rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  padding: "1px 6px",
  borderRadius: 5,
  color: C.warnText,
  background: C.warnBg,
  border: `1px solid ${C.warnBorder}`
};
var quarantinePill = {
  fontSize: 11,
  fontWeight: 700,
  padding: "2px 8px",
  borderRadius: 999,
  color: C.warnText,
  background: C.warnBg,
  border: `1px solid ${C.warnBorder}`,
  whiteSpace: "nowrap"
};
var targetChip = {
  fontSize: "0.64rem",
  fontWeight: 600,
  padding: "1px 7px",
  borderRadius: 999,
  border: `1px solid ${C.border}`,
  background: C.surface,
  color: C.text2,
  whiteSpace: "nowrap"
};

// src/project360/Project360View.tsx
var import_react16 = require("react");

// src/project360/sunburstGeometry.ts
var VIEWBOX = 320;
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
function slice(startDeg, spanDeg, index, count) {
  const each = spanDeg / (count || 1);
  const from = startDeg + index * each;
  return [from, from + each];
}
function padSlice(startDeg, endDeg, padDeg) {
  if (endDeg - startDeg <= padDeg * 2) {
    const mid = (startDeg + endDeg) / 2;
    return [mid, mid];
  }
  return [startDeg + padDeg, endDeg - padDeg];
}
var ARC_PAD_DEG = 0.6;

// src/project360/Sunburst.tsx
var import_jsx_runtime19 = require("react/jsx-runtime");
function Sunburst({ pillars, dimensions, overall, selected, onSelect, ariaLabel }) {
  const nPillars = pillars.length || 1;
  const pillarSpan = 360 / nPillars;
  const dimsByPillar = pillars.map((p) => dimensions.filter((d) => d.pillar === p.key));
  return /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)(
    "svg",
    {
      className: "bf-360-wheel",
      viewBox: `0 0 ${VIEWBOX} ${VIEWBOX}`,
      role: "img",
      "aria-label": ariaLabel ?? "Project 360 health wheel",
      children: [
        pillars.map((pillar, pi) => {
          const [pStart, pEnd] = slice(0, 360, pi, nPillars);
          const pMid = (pStart + pEnd) / 2;
          const dims = dimsByPillar[pi];
          const pLabel = labelAt((R_INNER_0 + R_INNER_1) / 2, pMid);
          return /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("g", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
              "path",
              {
                d: sector(R_INNER_0, R_INNER_1, ...padSlice(pStart, pEnd, ARC_PAD_DEG)),
                fill: pillar.color,
                fillOpacity: 0.9,
                className: "bf-360-arc bf-360-arc--pillar"
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
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
              const [dStart, dEnd] = slice(pStart, pillarSpan, di, dims.length);
              const dMid = (dStart + dEnd) / 2;
              const isSel = selected === dim.key;
              const lab = labelAt((R_OUTER_0 + R_OUTER_1) / 2, dMid);
              const lines = twoLines(dim.label);
              return /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)(
                "g",
                {
                  className: "bf-360-arc-group",
                  onClick: () => onSelect?.(isSel ? null : dim.key),
                  role: "button",
                  "aria-pressed": isSel,
                  "aria-label": `${dim.label}: ${dim.score} of 100`,
                  children: [
                    /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
                      "path",
                      {
                        d: sector(R_OUTER_0, R_OUTER_1, ...padSlice(dStart, dEnd, ARC_PAD_DEG)),
                        fill: dim.color,
                        fillOpacity: isSel ? 1 : 0.82,
                        className: `bf-360-arc bf-360-arc--dim${isSel ? " is-selected" : ""}`
                      }
                    ),
                    /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
                      "text",
                      {
                        x: lab.x,
                        y: lab.y,
                        className: "bf-360-arc-label",
                        textAnchor: "middle",
                        dominantBaseline: "central",
                        children: lines.map((ln, li) => /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("tspan", { x: lab.x, dy: li === 0 ? lines.length > 1 ? "-0.5em" : "0" : "1em", children: ln }, li))
                      }
                    )
                  ]
                },
                dim.key
              );
            })
          ] }, pillar.key);
        }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("circle", { cx: CX, cy: CY, r: R_CENTER, className: "bf-360-center", onClick: () => onSelect?.(null), role: "button", "aria-label": "Clear selection" }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("circle", { cx: CX, cy: CY, r: R_CENTER, fill: "none", stroke: overall.color, strokeWidth: 3, className: "bf-360-center-ring" }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("text", { x: CX, y: CY - 8, className: "bf-360-center-score", textAnchor: "middle", dominantBaseline: "central", fill: overall.color, children: overall.score }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("text", { x: CX, y: CY + 14, className: "bf-360-center-label", textAnchor: "middle", dominantBaseline: "central", children: "HEALTH" })
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
var import_jsx_runtime20 = require("react/jsx-runtime");
var STATUS_ORDER = ["working", "awaiting", "blocked", "idle", "available"];
function Project360View({ data, loading, error, labels, onAction, onRefresh }) {
  const L = (0, import_react16.useMemo)(() => ({ ...DEFAULT_PROJECT360_LABELS, ...labels ?? {} }), [labels]);
  const [selected, setSelected] = (0, import_react16.useState)(null);
  const sortedWorkforce = (0, import_react16.useMemo)(
    () => [...data?.workforce ?? []].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)),
    [data?.workforce]
  );
  if (error) {
    return /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "bf-360-state", children: [
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("div", { className: "bf-360-state__title", children: L.loadError }),
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("div", { className: "bf-360-state__hint", children: error }),
      onRefresh && /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("button", { className: "bf-btn", onClick: onRefresh, children: L.refresh })
    ] });
  }
  if (!data || loading) {
    return /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "bf-360-state", children: [
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("div", { className: "bf-360-spinner" }),
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
  return /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "bf-360", children: [
    /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("header", { className: "bf-360-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "bf-360-head__id", children: [
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { className: "bf-360-head__title", children: project.name }),
        project.key && /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { className: "bf-360-head__key", children: project.key })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("div", { className: "bf-360-head__spacer" }),
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("button", { className: "bf-btn", onClick: () => onAction?.({ kind: "board", label: L.openBoard }), children: L.openBoard }),
      gaps.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("button", { className: "bf-btn bf-btn--primary", onClick: improveAll, children: L.improveAll }),
      onRefresh && /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("button", { className: "bf-btn bf-btn--icon", title: L.refresh, "aria-label": L.refresh, onClick: onRefresh, children: "\u27F3" })
    ] }),
    !hasData ? /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "bf-360-state", children: [
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("div", { className: "bf-360-state__title", children: L.noData }),
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("div", { className: "bf-360-state__hint", children: L.noDataHint }),
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("button", { className: "bf-btn", onClick: () => onAction?.({ kind: "board", label: L.openBoard }), children: L.openBoard })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "bf-360-grid", children: [
      /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("section", { className: "bf-360-col bf-360-col--wheel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(
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
        /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "bf-360-overall", children: [
          /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("div", { className: "bf-360-progress", "aria-label": `${L.progress} ${overall.progressPct}%`, children: /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("div", { className: "bf-360-progress__fill", style: { width: `${overall.progressPct}%`, background: overall.color } }) }),
          /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "bf-360-progress__label", children: [
            L.progress,
            ": ",
            overall.progressPct,
            "%"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "bf-360-counts", children: [
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(Count, { n: counts.open, label: L.counts_open }),
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(Count, { n: counts.blocked, label: L.counts_blocked, tone: counts.blocked ? "warn" : void 0 }),
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(Count, { n: counts.overdue, label: L.counts_overdue, tone: counts.overdue ? "bad" : void 0 }),
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(Count, { n: counts.activeRuns, label: L.counts_running, tone: counts.activeRuns ? "good" : void 0 })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("section", { className: "bf-360-col bf-360-col--detail", children: [
        /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "bf-360-legend-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { children: selectedDim ? selectedDim.label : L.allDimensions }),
          selectedDim && /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("button", { className: "bf-360-clear", onClick: () => setSelected(null), children: [
            L.allDimensions,
            " \u2715"
          ] })
        ] }),
        selectedDim ? /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "bf-360-dim-detail", children: [
          /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(ScoreDot, { score: selectedDim.score, color: selectedDim.color }),
          /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("div", { className: "bf-360-dim-detail__summary", children: selectedDim.summary })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("ul", { className: "bf-360-dim-list", children: dimensions.map((d) => /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)(
          "button",
          {
            className: "bf-360-dim-row",
            onClick: () => setSelected(d.key),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(ScoreDot, { score: d.score, color: d.color }),
              /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { className: "bf-360-dim-row__label", children: d.label }),
              /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { className: "bf-360-dim-row__summary", children: d.summary })
            ]
          }
        ) }, d.key)) })
      ] })
    ] }),
    hasData && /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)(import_jsx_runtime20.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("section", { className: "bf-360-section", children: [
        /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("h3", { className: "bf-360-section__title", children: [
          L.missingItems,
          shownGaps.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { className: "bf-360-section__count", children: shownGaps.length })
        ] }),
        shownGaps.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("p", { className: "bf-360-empty", children: L.noGaps }) : /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("ul", { className: "bf-360-gaps", children: shownGaps.map((g) => /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(GapRow, { gap: g, onAction }, g.id)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("section", { className: "bf-360-section", children: [
        /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("h3", { className: "bf-360-section__title", children: [
          L.workforce,
          workforce.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { className: "bf-360-section__count", children: workforce.length })
        ] }),
        workforce.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("p", { className: "bf-360-empty", children: L.noWorkforce }) : /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("ul", { className: "bf-360-people", children: sortedWorkforce.map((m) => /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(MemberRow, { member: m, labels: L, onAction }, m.ref)) })
      ] })
    ] })
  ] });
}
function Count({ n, label, tone }) {
  return /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("span", { className: `bf-360-count${tone ? ` bf-360-count--${tone}` : ""}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("b", { children: n }),
    " ",
    label
  ] });
}
function ScoreDot({ score, color }) {
  return /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { className: "bf-360-scoredot", style: { borderColor: color, color }, children: score });
}
function GapRow({ gap, onAction }) {
  return /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("li", { className: `bf-360-gap bf-360-gap--${gap.severity}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { className: `bf-360-sev bf-360-sev--${gap.severity}`, "aria-hidden": true }),
    /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "bf-360-gap__body", children: [
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("div", { className: "bf-360-gap__title", children: gap.title }),
      gap.detail && /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("div", { className: "bf-360-gap__detail", children: gap.detail })
    ] }),
    gap.action && /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("button", { className: "bf-btn bf-360-gap__cta", onClick: () => onAction?.(gap.action), children: gap.action.label })
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
  return /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("li", { className: "bf-360-person", children: [
    /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { className: `bf-360-dot bf-360-dot--${member.status}`, title: statusLabel, "aria-label": statusLabel }),
    /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "bf-360-person__body", children: [
      /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "bf-360-person__top", children: [
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { className: "bf-360-person__name", children: member.name }),
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { className: `bf-360-kind bf-360-kind--${member.kind}`, children: member.kind }),
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { className: "bf-360-person__status", children: statusLabel })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("div", { className: "bf-360-person__reason", children: member.reason })
    ] }),
    task && /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "bf-360-person__actions", children: [
      (member.status === "idle" || member.status === "available") && member.kind !== "human" && /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("button", { className: "bf-btn bf-360-person__btn", onClick: () => onAction?.({ kind: "run-task", label: labels.member_run, task }), children: labels.member_run }),
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("button", { className: "bf-btn bf-360-person__btn", onClick: () => onAction?.({ kind: "open-task", label: labels.member_open, task }), children: labels.member_open })
    ] })
  ] });
}

// src/projectList/ProjectListView.tsx
var import_react17 = require("react");

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
var import_jsx_runtime21 = require("react/jsx-runtime");
function ProjectListView({ title, subtitle, data, loading, error, labels, onAction, onRefresh }) {
  const L = (0, import_react17.useMemo)(() => ({ ...DEFAULT_PROJECT_LIST_LABELS, ...labels ?? {} }), [labels]);
  const header = /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("header", { className: "bf-list-head", children: [
    /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: "bf-list-head__id", children: [
      /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("span", { className: "bf-list-head__title", children: title }),
      data && /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("span", { className: "bf-list-head__count", children: [
        data.total,
        " ",
        L.items
      ] })
    ] }),
    subtitle && /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("div", { className: "bf-list-head__sub", children: subtitle }),
    /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("div", { className: "bf-list-head__spacer" }),
    onRefresh && /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("button", { className: "bf-btn bf-btn--icon", title: L.refresh, "aria-label": L.refresh, onClick: onRefresh, children: "\u27F3" })
  ] });
  if (error) {
    return /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: "bf-list", children: [
      header,
      /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: "bf-360-state", children: [
        /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("div", { className: "bf-360-state__title", children: L.loadError }),
        /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("div", { className: "bf-360-state__hint", children: error }),
        onRefresh && /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("button", { className: "bf-btn", onClick: onRefresh, children: L.refresh })
      ] })
    ] });
  }
  if (!data || loading) {
    return /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: "bf-list", children: [
      header,
      /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: "bf-360-state", children: [
        /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("div", { className: "bf-360-spinner" }),
        L.connecting
      ] })
    ] });
  }
  if (data.total === 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: "bf-list", children: [
      header,
      /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: "bf-360-state", children: [
        /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("div", { className: "bf-360-state__title", children: L.empty }),
        L.emptyHint && /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("div", { className: "bf-360-state__hint", children: L.emptyHint })
      ] })
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: "bf-list", children: [
    header,
    data.groups.filter((g) => g.items.length > 0).map((g) => /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("section", { className: "bf-list-group", children: [
      /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("h3", { className: "bf-list-group__title", children: [
        /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("span", { className: `bf-list-group__dot bf-list-tone--${g.tone ?? "default"}`, "aria-hidden": true }),
        g.label,
        /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("span", { className: "bf-360-section__count", children: g.items.length })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("ul", { className: "bf-list-rows", children: g.items.map((it) => /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(Row2, { item: it, onAction }, it.id)) })
    ] }, g.key))
  ] });
}
function Row2({ item, onAction }) {
  const act = item.action;
  const clickable = !!act && !!onAction;
  return /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("li", { className: "bf-list-row", children: /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)(
    "button",
    {
      className: "bf-list-row__main",
      disabled: !clickable,
      onClick: clickable ? () => onAction(act) : void 0,
      title: clickable ? act.label : void 0,
      children: [
        item.key && /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("span", { className: "bf-list-row__key", children: item.key }),
        /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("span", { className: "bf-list-row__body", children: [
          /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("span", { className: "bf-list-row__title", children: item.title }),
          item.subtitle && /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("span", { className: "bf-list-row__sub", children: item.subtitle })
        ] }),
        item.badges && item.badges.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("span", { className: "bf-list-row__badges", children: item.badges.map((b, i) => /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("span", { className: `bf-list-badge bf-list-tone--${b.tone ?? "default"}`, children: b.label }, i)) })
      ]
    }
  ) });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Avatar,
  BUILDERFORCE_PRODUCT_NAME,
  BrainTimeline,
  ChatErrorBanner,
  ChatTicketsPanel,
  DEFAULT_ASK_USER_LABELS,
  DEFAULT_CHAT_ERROR_LABELS,
  DEFAULT_CHAT_TICKETS_LABELS,
  DEFAULT_EVERMIND_LABELS,
  DEFAULT_LIVE_ACTIVITY_LABELS,
  DEFAULT_MODEL_IDENTITY,
  DEFAULT_PENDING_CHANGES_LABELS,
  DEFAULT_PROJECT360_LABELS,
  DEFAULT_PROJECT_LIST_LABELS,
  DEFAULT_PROMPT_OPTIONS_LABELS,
  DEFAULT_TIMELINE_LABELS,
  EvermindConsole,
  HealthRing,
  LiveActivity,
  MODEL_CATEGORIES,
  Markdown,
  PROJECT_EVERMIND_MODEL_PREFIX,
  ParticipantBadge,
  PendingChangesBar,
  PendingQuestionBanner,
  Project360View,
  ProjectListView,
  PromptOptionsMenu,
  PromptPanel,
  QuestionCard,
  RUNNABLE_KINDS,
  SLOW_AFTER_MS,
  Sunburst,
  TICKET_KINDS,
  activeModelKey,
  askUserAnchorId,
  attachmentsOf,
  avatarColor,
  buildModelItems,
  buildSettledTimeline,
  buildTimeline,
  byoVendorLabel,
  displayModelName,
  evermindLearnedStatus,
  evermindNextAction,
  filterModelItems,
  formatDuration,
  formatElapsed,
  formatPayload,
  healthRingColor,
  initialsOf,
  modelCategoryLabel,
  modelInUse,
  parseAskUser,
  perMillionUsd,
  premiumCostLabel,
  productForPlan,
  productModelName,
  promptOptionsLabels,
  revealsModelId,
  selectPendingAskUser,
  serializeAskUser,
  splitThinkSegments,
  streamingNode,
  stripAskUser,
  useChatParticipants,
  useMentionAutocomplete
});
//# sourceMappingURL=index.cjs.map