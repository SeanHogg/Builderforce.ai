// Ask the index what an agent would ask, and see exactly what it gets back.
import { basename, call, copyText, h, route, showError } from "../bridge.js";
import { num, t } from "../i18n.js";
import { subscribe } from "../store.js";

const LIMIT = 12;
const SNIPPET_LINES = 14;
// Kept across view switches, so going to a workspace and back keeps the question.
const last = { root: "", query: "", results: null, ms: 0 };

function hit(r) {
  const ref = `${r.path}:${r.startLine}`;
  const snippet = r.snippet.split("\n").slice(0, SNIPPET_LINES).join("\n");
  return h(
    "li",
    { class: "card hit" },
    h(
      "div",
      { class: "row between wrap" },
      h(
        "div",
        { class: "hit-title min0" },
        h("span", { class: "mono path-strong", text: r.path }),
        h("span", { class: "muted small", text: t("search.lines", { start: r.startLine, end: r.endLine }) }),
      ),
      h(
        "div",
        { class: "row" },
        h("span", { class: `pill src-${r.source}`, text: t(`search.source.${r.source}`) }),
        h("button", { class: "ghost small", text: t("search.copyRef"), title: ref, on: { click: (e) => copyText(e.currentTarget, ref) } }),
      ),
    ),
    r.symbol && h("div", { class: "row" }, h("span", { class: "mono symbol", text: r.symbol }), h("span", { class: "chip", text: r.kind })),
    h("pre", { class: "code", text: snippet }),
  );
}

export function render(host, params) {
  if (params.get("root")) last.root = params.get("root");

  const select = h("select", { attrs: { "aria-label": t("search.workspace") }, on: { change: (e) => (last.root = e.target.value) } });
  const input = h("input", { type: "search", value: last.query, placeholder: t("search.placeholder"), attrs: { "aria-label": t("search.title") } });
  const summary = h("p", { class: "muted small" });
  const list = h("ul", { class: "hits" });
  const noWs = h("div", { class: "card empty-state", hidden: true }, h("p", { class: "muted", text: t("search.noWorkspaces") }), h("a", { class: "button primary", href: route("workspaces"), text: t("nav.workspaces") }));
  const form = h(
    "form",
    { class: "card search-form", on: { submit: (e) => { e.preventDefault(); run(); } } },
    select,
    input,
    h("button", { class: "primary", type: "submit", text: t("search.submit") }),
  );

  function show() {
    if (!last.results) {
      summary.textContent = "";
      list.replaceChildren();
      return;
    }
    summary.textContent = last.results.length ? t("search.summary", { n: num(last.results.length), ms: num(last.ms) }) : t("search.none");
    list.replaceChildren(...last.results.map(hit));
  }

  async function run() {
    last.query = input.value.trim();
    if (!last.query || !last.root) return;
    const started = performance.now();
    try {
      const r = await call("search", { root: last.root, query: last.query, limit: LIMIT });
      last.results = r.results;
      last.ms = Math.round(performance.now() - started);
      show();
    } catch (e) {
      showError(e);
    }
  }

  host.append(
    h("header", { class: "page-head" }, h("div", {}, h("h1", { text: t("search.title") }), h("p", { class: "muted", text: t("search.intro") }))),
    noWs,
    form,
    summary,
    list,
  );
  show();
  input.focus();

  return subscribe((s) => {
    const roots = s.workspaces.map((w) => w.root);
    noWs.hidden = roots.length > 0;
    form.hidden = roots.length === 0;
    if (!roots.includes(last.root)) last.root = roots[0] || "";
    const current = [...select.options].map((o) => o.value).join("\n");
    if (current !== roots.join("\n")) {
      select.replaceChildren(...roots.map((r) => h("option", { value: r, text: basename(r), title: r })));
    }
    select.value = last.root;
  });
}
