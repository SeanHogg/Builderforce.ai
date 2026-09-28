// Settings: everything that sets Synapse up rather than being the conversation — the
// account, the code index your AI tools search, the agents you taught, and connecting
// tools — grouped in one place with its own navigation, so the sidebar can be your chats.
// The groups are data: a new settings page is a line here, not a branch in the shell.
import { h, route } from "./bridge.js";
import { t } from "./i18n.js";
import { icon } from "./icons.js";

export const SETTINGS_GROUPS = [
  { key: "account", views: ["account"] },
  { key: "index", views: ["workspaces", "search", "activity"] },
  { key: "agents", views: ["teach", "skills", "runs"] },
  { key: "tools", views: ["connect"] },
];

/** Pages that live under a settings page (a workspace under Workspaces, …). */
const PARENT = { workspace: "workspaces", review: "teach" };

const SETTINGS_VIEWS = new Set(SETTINGS_GROUPS.flatMap((g) => g.views));

/** The settings page a view belongs to, or null when it is not a settings view. */
export function settingsPageOf(view) {
  const page = PARENT[view] ?? view;
  return SETTINGS_VIEWS.has(page) ? page : null;
}

/** Frame a settings view: its navigation beside it. Returns the element the view renders into. */
export function settingsFrame(host, page) {
  const nav = h(
    "nav",
    { class: "settings-nav", attrs: { "aria-label": t("settings.title") } },
    ...SETTINGS_GROUPS.map((g) =>
      h(
        "div",
        { class: "settings-group" },
        h("div", { class: "side-section", text: t(`settings.group.${g.key}`) }),
        ...g.views.map((v) =>
          h("a", { href: route(v), attrs: v === page ? { "aria-current": "page" } : {} }, icon(v), h("span", { text: t(`nav.${v}`) })),
        ),
      ),
    ),
  );
  const body = h("div", { class: "settings-body" });
  host.append(h("div", { class: "settings" }, h("div", { class: "settings-side" }, h("h1", { class: "settings-title", text: t("settings.title") }), nav), body));
  return body;
}
