// What the tools on this machine asked the index, newest first.
import { basename, h } from "../bridge.js";
import { clientLabel } from "../clients.js";
import { num, relTime, t } from "../i18n.js";
import { subscribe } from "../store.js";

function outcome(e) {
  if (!e.ok) return h("span", { class: "pill bad", text: t("activity.failed") });
  if (e.count == null) return null;
  const key = e.op === "check-references" ? "activity.stale" : "activity.results";
  return h("span", { class: `pill ${e.op === "check-references" && e.count ? "busy" : "ok"}`, text: t(key, { n: num(e.count) }) });
}

function detail(e) {
  if (!e.detail) return null;
  // A memory check's detail is how many memories were checked; the rest is the query/focus.
  return e.op === "check-references" ? t("activity.memories", { n: e.detail }) : `“${e.detail}”`;
}

function row(e) {
  return h(
    "li",
    { class: "act" },
    h("span", { class: `dot ${e.ok ? "ok" : "bad"}` }),
    h(
      "div",
      { class: "act-main min0" },
      h(
        "div",
        { class: "row wrap" },
        h("span", { class: "chip", text: clientLabel(e.client) }),
        h("strong", { text: t(`activity.op.${e.op}`) }),
        e.root && h("span", { class: "muted", text: basename(e.root), title: e.root }),
        outcome(e),
      ),
      detail(e) && h("div", { class: "act-detail", text: detail(e) }),
    ),
    h("div", { class: "act-meta muted small" }, h("span", { text: relTime(e.at) }), h("span", { text: t("activity.ms", { n: num(e.ms) }) })),
  );
}

export function render(host) {
  const list = h("ul", { class: "card acts" });
  const empty = h("div", { class: "card empty-state", hidden: true }, h("p", { class: "muted", text: t("activity.empty") }));
  host.append(
    h("header", { class: "page-head" }, h("div", {}, h("h1", { text: t("activity.title") }), h("p", { class: "muted", text: t("activity.intro") }))),
    empty,
    list,
  );
  return subscribe((s) => {
    empty.hidden = s.activity.length > 0;
    list.hidden = s.activity.length === 0;
    list.replaceChildren(...s.activity.map(row));
  });
}
