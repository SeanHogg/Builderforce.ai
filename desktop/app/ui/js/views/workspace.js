// One workspace: live stats, actions, and the repo map an agent is shown first.
import { basename, call, copyText, dialog, h, route, showError } from "../bridge.js";
import { num, t } from "../i18n.js";
import { refresh, subscribe } from "../store.js";
import { lastIndexed, meter, phasePill, statTiles } from "../workspaceParts.js";

const BUDGETS = [1000, 2000, 4000, 8000];
const DEFAULT_BUDGET = 2000;

export function render(host, params) {
  const root = params.get("root") || "";
  let budget = DEFAULT_BUDGET;
  let lastPhase = null;

  const pill = h("span");
  const tiles = h("div");
  const bar = h("div");
  const when = h("span", { class: "muted small" });
  const mapBody = h("pre", { class: "code map" });
  const mapNote = h("p", { class: "muted small", hidden: true });

  async function loadMap() {
    try {
      const r = await call("repo-map", { root, maxTokens: budget });
      mapBody.textContent = r.map || "";
      mapNote.hidden = !!r.map;
      mapNote.textContent = t("workspace.mapEmpty");
    } catch (e) {
      showError(e);
    }
  }

  async function remove() {
    const ok = await dialog.ask(t("workspace.removeConfirm", { name: basename(root) }), { title: t("workspace.remove"), kind: "warning" });
    if (!ok) return;
    try {
      await call("remove", { root });
      await refresh();
      location.hash = route("workspaces");
    } catch (e) {
      showError(e);
    }
  }

  async function rescan() {
    try {
      await call("rescan", { root });
      await refresh();
    } catch (e) {
      showError(e);
    }
  }

  const budgetSelect = h(
    "select",
    { attrs: { "aria-label": t("workspace.mapBudget") }, on: { change: (e) => { budget = Number(e.target.value); loadMap(); } } },
    BUDGETS.map((b) => h("option", { value: String(b), text: t("workspace.mapTokens", { n: num(b) }), selected: b === budget })),
  );

  host.append(
    h("a", { class: "back", href: route("workspaces"), text: `← ${t("workspace.back")}` }),
    h(
      "header",
      { class: "page-head" },
      h("div", { class: "min0" }, h("div", { class: "row wrap" }, h("h1", { text: basename(root) }), pill), h("p", { class: "path", text: root, title: root }), when),
      h(
        "div",
        { class: "row wrap" },
        h("a", { class: "button primary", href: route("search", { root }), text: t("workspace.searchHere") }),
        h("button", { class: "ghost", text: t("workspace.rescan"), on: { click: rescan } }),
        h("button", { class: "ghost danger", text: t("workspace.remove"), on: { click: remove } }),
      ),
    ),
    bar,
    tiles,
    h(
      "section",
      { class: "card" },
      h(
        "div",
        { class: "row between wrap" },
        h("div", {}, h("h2", { text: t("workspace.mapTitle") }), h("p", { class: "muted", text: t("workspace.mapIntro") })),
        h("div", { class: "row" }, budgetSelect, h("button", { class: "ghost", text: t("common.copy"), on: { click: (e) => copyText(e.currentTarget, mapBody.textContent) } })),
      ),
      mapNote,
      mapBody,
    ),
  );

  loadMap();
  return subscribe((s) => {
    const ws = s.workspaces.find((w) => w.root === root);
    if (!ws) {
      location.hash = route("workspaces");
      return;
    }
    pill.replaceChildren(phasePill(ws));
    bar.replaceChildren(meter(ws));
    tiles.replaceChildren(statTiles(ws));
    when.textContent = lastIndexed(ws);
    // The map is worth re-reading once, when indexing settles — not on every poll.
    if (lastPhase && lastPhase !== "ready" && ws.phase.state === "ready") loadMap();
    lastPhase = ws.phase.state;
  });
}
