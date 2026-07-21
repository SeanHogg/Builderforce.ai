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
var index_exports = {};
__export(index_exports, {
  ALL_KINDS: () => ALL_KINDS,
  DEFAULT_ENDPOINT: () => DEFAULT_ENDPOINT,
  DEFAULT_LABELS: () => DEFAULT_LABELS,
  FeedbackWidget: () => FeedbackWidget,
  buildPayload: () => buildPayload,
  close: () => close,
  destroy: () => destroy,
  init: () => init,
  kindLabel: () => kindLabel,
  normalizeEndpoint: () => normalizeEndpoint,
  open: () => open,
  postFeedback: () => postFeedback,
  resolveKinds: () => resolveKinds,
  resolveLabels: () => resolveLabels
});
module.exports = __toCommonJS(index_exports);

// src/core.ts
var DEFAULT_ENDPOINT = "https://api.builderforce.ai/api/feedback-ingest";
var ALL_KINDS = ["feature", "bug", "idea", "other"];
var DEFAULT_LABELS = {
  tab: "Feedback",
  title: "Send us feedback",
  intro: "Tell us what would make this better. Feature requests, bugs, half-formed ideas \u2014 all welcome.",
  kindFeature: "Feature request",
  kindBug: "Bug report",
  kindIdea: "Idea",
  kindOther: "Something else",
  titleField: "Summary",
  titlePlaceholder: "One line \u2014 what do you want?",
  bodyField: "Details",
  bodyPlaceholder: "What are you trying to do, and what is getting in the way?",
  emailField: "Your email (optional)",
  emailPlaceholder: "you@company.com",
  submit: "Send feedback",
  submitting: "Sending\u2026",
  close: "Close",
  successTitle: "Thank you",
  successBody: "Your request has been filed for the team to review.",
  another: "Send another",
  errorRequired: "Please describe your feedback before sending.",
  errorGeneric: "Something went wrong sending your feedback. Please try again.",
  errorRateLimited: "We have received a lot of feedback today. Please try again tomorrow."
};
function normalizeEndpoint(endpoint) {
  const base = (endpoint ?? DEFAULT_ENDPOINT).trim().replace(/\/+$/, "");
  return base.replace(/\/submit$/, "") || DEFAULT_ENDPOINT;
}
function resolveKinds(kinds) {
  const valid = (kinds ?? []).filter((k) => ALL_KINDS.includes(k));
  return valid.length ? valid : ALL_KINDS;
}
function buildPayload(draft, opts, page = {}) {
  const body = draft.body.trim();
  if (!body) return { error: "empty" };
  const title = draft.title.trim();
  const email = draft.email.trim();
  return {
    kind: draft.kind,
    body,
    ...title ? { title } : {},
    ...email ? { email } : {},
    ...page.url ? { url: page.url } : {},
    ...opts.appVersion ? { appVersion: opts.appVersion } : {},
    ...opts.context ? { context: opts.context } : {}
  };
}
async function postFeedback(endpoint, key, payload, fetchFn = fetch) {
  try {
    const res = await fetchFn(`${normalizeEndpoint(endpoint)}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload)
    });
    if (res.status === 429) return { ok: false, rateLimited: true };
    if (!res.ok) return { ok: false };
    const json = await res.json().catch(() => null);
    return { ok: true, submissionId: json?.submissionId, deduped: !!json?.deduped };
  } catch {
    return { ok: false };
  }
}
function resolveLabels(overrides) {
  return { ...DEFAULT_LABELS, ...overrides ?? {} };
}
function kindLabel(kind, labels) {
  switch (kind) {
    case "feature":
      return labels.kindFeature;
    case "bug":
      return labels.kindBug;
    case "idea":
      return labels.kindIdea;
    default:
      return labels.kindOther;
  }
}

// src/index.ts
var HOST_ID = "builderforce-feedback-root";
function styles(accent, side) {
  const edge = side === "right" ? "right" : "left";
  const opposite = side === "right" ? "left" : "right";
  return `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; }
  .tab {
    position: fixed; ${edge}: 0; top: 50%; transform: translateY(-50%);
    z-index: 2147483000;
    writing-mode: vertical-rl; ${side === "right" ? "" : "rotate: 180deg;"}
    padding: 16px 8px; border: none; cursor: pointer;
    background: ${accent}; color: #fff;
    font: 600 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
    letter-spacing: .04em;
    border-radius: ${side === "right" ? "8px 0 0 8px" : "0 8px 8px 0"};
    box-shadow: 0 2px 12px rgba(0,0,0,.24);
  }
  .tab:hover { filter: brightness(1.08); }
  .tab:focus-visible { outline: 3px solid ${accent}; outline-offset: 3px; }
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 2147483001; }
  .panel {
    position: fixed; top: 0; bottom: 0; ${edge}: 0; width: min(420px, 100vw);
    z-index: 2147483002; display: flex; flex-direction: column;
    background: var(--bff-bg); color: var(--bff-fg);
    border-${opposite}: 1px solid var(--bff-border);
    box-shadow: 0 0 32px rgba(0,0,0,.28);
    font: 400 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .head { display: flex; align-items: center; gap: 12px; padding: 16px 18px; border-bottom: 1px solid var(--bff-border); }
  .head h2 { margin: 0; font-size: 16px; font-weight: 700; flex: 1; }
  .x { border: 1px solid var(--bff-border); background: var(--bff-subtle); color: inherit;
       width: 32px; height: 32px; border-radius: 8px; cursor: pointer; font-size: 16px; line-height: 1; }
  .body { flex: 1; overflow-y: auto; padding: 18px; display: flex; flex-direction: column; gap: 14px; }
  .intro { margin: 0; font-size: 13px; color: var(--bff-muted); }
  label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; font-weight: 600; color: var(--bff-muted); }
  input, textarea, select {
    font: inherit; width: 100%; padding: 9px 11px; border-radius: 8px;
    border: 1px solid var(--bff-border); background: var(--bff-subtle); color: var(--bff-fg);
  }
  input:focus, textarea:focus, select:focus { outline: 2px solid ${accent}; outline-offset: 1px; }
  textarea { min-height: 128px; resize: vertical; }
  .kinds { display: flex; flex-wrap: wrap; gap: 8px; }
  .kind {
    flex: 1 1 auto; padding: 8px 10px; border-radius: 8px; cursor: pointer;
    border: 1px solid var(--bff-border); background: var(--bff-subtle); color: var(--bff-fg);
    font: 600 12px/1.2 inherit; white-space: nowrap;
  }
  .kind[aria-pressed="true"] { border-color: ${accent}; background: ${accent}; color: #fff; }
  .send {
    padding: 11px 16px; border: none; border-radius: 8px; cursor: pointer;
    background: ${accent}; color: #fff; font: 600 14px/1 inherit;
  }
  .send[disabled] { opacity: .6; cursor: default; }
  .err { margin: 0; font-size: 13px; color: var(--bff-danger); }
  .done { text-align: center; padding: 32px 8px; display: flex; flex-direction: column; gap: 10px; align-items: center; }
  .done h3 { margin: 0; font-size: 17px; }
  .done p { margin: 0; font-size: 13px; color: var(--bff-muted); }
  .link { background: none; border: none; color: ${accent}; cursor: pointer; font: 600 13px/1 inherit; text-decoration: underline; }
  @media (max-width: 480px) { .panel { width: 100vw; } .tab { padding: 12px 7px; font-size: 12px; } }
  @media (prefers-reduced-motion: no-preference) { .panel { animation: bff-in .18s ease-out; } }
  @keyframes bff-in { from { transform: translateX(${side === "right" ? "100%" : "-100%"}); } to { transform: none; } }
  `;
}
function palette(theme) {
  const light = `--bff-bg:#ffffff;--bff-fg:#14161a;--bff-muted:#5b6472;--bff-border:#dde1e7;--bff-subtle:#f5f7fa;--bff-danger:#c02626;`;
  const dark = `--bff-bg:#15181d;--bff-fg:#eef1f5;--bff-muted:#98a2b3;--bff-border:#2c313a;--bff-subtle:#1d222a;--bff-danger:#ff6b6b;`;
  if (theme === "light") return `:host{${light}}`;
  if (theme === "dark") return `:host{${dark}}`;
  return `:host{${light}} @media (prefers-color-scheme: dark){:host{${dark}}}`;
}
function esc(s) {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
}
var FeedbackWidget = class {
  opts;
  labels;
  kinds;
  endpoint;
  root = null;
  host = null;
  open = false;
  sending = false;
  done = false;
  error = null;
  draft = { kind: "feature", title: "", body: "", email: "" };
  constructor(opts) {
    this.opts = opts;
    this.labels = resolveLabels(opts.labels);
    this.kinds = resolveKinds(opts.kinds);
    this.endpoint = normalizeEndpoint(opts.endpoint);
    this.draft.kind = this.kinds[0];
  }
  /** Create the shadow host and paint the launcher tab. Idempotent. */
  mount() {
    if (this.root || typeof document === "undefined") return;
    const existing = document.getElementById(HOST_ID);
    if (existing) existing.remove();
    const host = document.createElement("div");
    host.id = HOST_ID;
    document.body.appendChild(host);
    this.host = host;
    this.root = host.attachShadow({ mode: "open" });
    document.addEventListener("keydown", this.onKeydown);
    this.render();
  }
  /** Remove the widget entirely and release its listeners. */
  destroy() {
    document.removeEventListener("keydown", this.onKeydown);
    this.host?.remove();
    this.host = null;
    this.root = null;
  }
  openPanel() {
    this.open = true;
    this.render();
    this.focusFirstField();
  }
  closePanel() {
    this.open = false;
    this.error = null;
    this.render();
  }
  onKeydown = (e) => {
    if (e.key === "Escape" && this.open) this.closePanel();
  };
  focusFirstField() {
    const el = this.root?.querySelector("#bff-body");
    if (el) setTimeout(() => el.focus(), 0);
  }
  async submit() {
    if (this.sending) return;
    const payload = buildPayload(this.draft, this.opts, {
      url: typeof location !== "undefined" ? location.href : void 0
    });
    if ("error" in payload) {
      this.error = this.labels.errorRequired;
      this.render();
      return;
    }
    this.sending = true;
    this.error = null;
    this.render();
    const outcome = await postFeedback(this.endpoint, this.opts.key, payload);
    this.sending = false;
    if (outcome.ok) {
      this.done = true;
      this.draft = { kind: this.kinds[0], title: "", body: "", email: "" };
      this.opts.onSubmit?.({ submissionId: outcome.submissionId ?? "", deduped: !!outcome.deduped });
    } else {
      this.error = outcome.rateLimited ? this.labels.errorRateLimited : this.labels.errorGeneric;
    }
    this.render();
  }
  render() {
    if (!this.root) return;
    const l = this.labels;
    const accent = this.opts.accent ?? "#f4726e";
    const side = this.opts.side ?? "right";
    const showTab = this.opts.showTab !== false;
    this.root.innerHTML = `
      <style>${palette(this.opts.theme ?? "auto")}${styles(accent, side)}</style>
      ${showTab ? `<button class="tab" part="tab" aria-haspopup="dialog" aria-expanded="${this.open}">${esc(l.tab)}</button>` : ""}
      ${this.open ? `
        <div class="overlay" part="overlay"></div>
        <section class="panel" role="dialog" aria-modal="true" aria-label="${esc(l.title)}">
          <div class="head">
            <h2>${esc(l.title)}</h2>
            <button class="x" aria-label="${esc(l.close)}">&times;</button>
          </div>
          <div class="body">${this.done ? this.doneMarkup() : this.formMarkup()}</div>
        </section>` : ""}
    `;
    this.bind();
  }
  formMarkup() {
    const l = this.labels;
    const d = this.draft;
    return `
      <p class="intro">${esc(l.intro)}</p>
      <div class="kinds" role="group" aria-label="${esc(l.titleField)}">
        ${this.kinds.map((k) => `
          <button class="kind" type="button" data-kind="${k}" aria-pressed="${d.kind === k}">${esc(kindLabel(k, l))}</button>
        `).join("")}
      </div>
      <label>${esc(l.titleField)}
        <input id="bff-title" type="text" maxlength="300" placeholder="${esc(l.titlePlaceholder)}" value="${esc(d.title)}">
      </label>
      <label>${esc(l.bodyField)}
        <textarea id="bff-body" maxlength="10000" placeholder="${esc(l.bodyPlaceholder)}">${esc(d.body)}</textarea>
      </label>
      ${this.opts.collectEmail === false ? "" : `
        <label>${esc(l.emailField)}
          <input id="bff-email" type="email" maxlength="255" placeholder="${esc(l.emailPlaceholder)}" value="${esc(d.email)}">
        </label>`}
      ${this.error ? `<p class="err" role="alert">${esc(this.error)}</p>` : ""}
      <button class="send" type="button" ${this.sending ? "disabled" : ""}>
        ${esc(this.sending ? l.submitting : l.submit)}
      </button>
    `;
  }
  doneMarkup() {
    const l = this.labels;
    return `
      <div class="done">
        <h3>${esc(l.successTitle)}</h3>
        <p>${esc(l.successBody)}</p>
        <button class="link" type="button" data-again>${esc(l.another)}</button>
      </div>
    `;
  }
  bind() {
    const r = this.root;
    if (!r) return;
    r.querySelector(".tab")?.addEventListener("click", () => this.open ? this.closePanel() : this.openPanel());
    r.querySelector(".overlay")?.addEventListener("click", () => this.closePanel());
    r.querySelector(".x")?.addEventListener("click", () => this.closePanel());
    r.querySelector(".send")?.addEventListener("click", () => void this.submit());
    r.querySelector("[data-again]")?.addEventListener("click", () => {
      this.done = false;
      this.render();
      this.focusFirstField();
    });
    r.querySelectorAll(".kind").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.draft.kind = btn.dataset.kind ?? this.draft.kind;
        this.render();
      });
    });
    const bindField = (id, field) => {
      r.querySelector(`#${id}`)?.addEventListener("input", (e) => {
        this.draft[field] = e.target.value;
      });
    };
    bindField("bff-title", "title");
    bindField("bff-body", "body");
    bindField("bff-email", "email");
  }
};
var instance = null;
function init(opts) {
  if (!opts?.key) throw new Error("BuilderforceFeedback.init: `key` is required");
  instance?.destroy();
  instance = new FeedbackWidget(opts);
  instance.mount();
  return instance;
}
function open() {
  instance?.openPanel();
}
function close() {
  instance?.closePanel();
}
function destroy() {
  instance?.destroy();
  instance = null;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ALL_KINDS,
  DEFAULT_ENDPOINT,
  DEFAULT_LABELS,
  FeedbackWidget,
  buildPayload,
  close,
  destroy,
  init,
  kindLabel,
  normalizeEndpoint,
  open,
  postFeedback,
  resolveKinds,
  resolveLabels
});
//# sourceMappingURL=index.cjs.map