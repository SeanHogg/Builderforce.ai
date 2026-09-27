// All workspaces: one card each, live while indexing. A card opens the workspace.
import { basename, call, dialog, h, route, showError } from "../bridge.js";
import { num, t } from "../i18n.js";
import { refresh, subscribe } from "../store.js";
import { lastIndexed, meter, phasePill } from "../workspaceParts.js";

export async function addWorkspace() {
  const picked = await dialog.open({ directory: true, multiple: false });
  if (typeof picked !== "string" || !picked) return;
  try {
    // Navigate by the root the service answers with: it is the canonical form the list uses.
    const status = await call("ensure", { root: picked });
    await refresh();
    location.hash = route("workspace", { root: status.root });
  } catch (e) {
    showError(e);
  }
}

function card(ws) {
  return h(
    "a",
    { class: "card ws-card", href: route("workspace", { root: ws.root }) },
    h("div", { class: "ws-card-head" }, h("strong", { class: "ws-name", text: basename(ws.root) }), phasePill(ws)),
    h("span", { class: "path", text: ws.root, title: ws.root }),
    meter(ws),
    h(
      "div",
      { class: "ws-card-foot" },
      h("span", { text: t("workspaces.cardStats", { files: num(ws.files), symbols: num(ws.symbols) }) }),
      h("span", { class: "muted", text: lastIndexed(ws) }),
    ),
  );
}

function emptyState() {
  return h(
    "div",
    { class: "card empty-state" },
    h("img", { src: "logo.png", alt: "", width: 56, height: 56 }),
    h("h2", { text: t("workspaces.emptyTitle") }),
    h("p", { class: "muted", text: t("workspaces.emptyBody") }),
    h(
      "div",
      { class: "row center wrap" },
      h("button", { class: "primary", text: t("workspaces.add"), on: { click: addWorkspace } }),
      h("a", { class: "button ghost", href: route("connect"), text: t("workspaces.emptyConnect") }),
    ),
  );
}

export function render(host) {
  const grid = h("div", { class: "grid" });
  host.append(
    h(
      "header",
      { class: "page-head" },
      h("div", {}, h("h1", { text: t("workspaces.title") }), h("p", { class: "muted", text: t("workspaces.intro") })),
      h("button", { class: "primary", text: t("workspaces.add"), on: { click: addWorkspace } }),
    ),
    grid,
  );
  return subscribe((s) => {
    grid.replaceChildren(...(s.workspaces.length ? s.workspaces.map(card) : [emptyState()]));
    grid.classList.toggle("single", !s.workspaces.length);
  });
}
