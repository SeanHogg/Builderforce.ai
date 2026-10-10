// Connectors: MCP servers Synapse runs so the Brain can use their tools — installed in one
// click from the catalog, or added by hand — each with its tools, an on/off switch, and a
// way to remove it. A tool that changes something always asks in the chat before it runs.
import { dialog, h, invoke, opener, showError } from "../bridge.js";
import { num, t } from "../i18n.js";

function toolList(c) {
  if (c.error) return h("p", { class: "error-inline", text: c.error });
  if (!c.tools) return h("p", { class: "muted small", text: t("connectors.toolsUnread") });
  if (!c.tools.length) return h("p", { class: "muted small", text: t("connectors.noTools") });
  return h(
    "ul",
    { class: "chips" },
    c.tools.map((tool) => h("li", { class: "chip", title: tool.description || tool.name, text: tool.readOnly ? `${tool.name} · ${t("connectors.readOnly")}` : tool.name })),
  );
}

function connectorCard(c, reload) {
  const act = (fn) => async (ev) => {
    ev.currentTarget.disabled = true;
    try {
      await fn();
    } catch (e) {
      showError(e);
    }
    reload();
  };
  const remove = async () => {
    const ok = await dialog.ask(t("connectors.removeConfirm", { name: c.name }), { title: t("connectors.remove"), kind: "warning" });
    if (ok) await invoke("connector_remove", { id: c.id });
  };
  const status = !c.enabled
    ? h("span", { class: "pill idle", text: t("connectors.off") })
    : c.error
      ? h("span", { class: "pill bad", text: t("connectors.failed") })
      : h("span", { class: "pill ok", text: c.tools ? t("connectors.toolCount", { n: num(c.tools.length) }) : t("connectors.on") });
  return h(
    "section",
    { class: "card stack" },
    h("div", { class: "row between wrap" }, h("h2", { text: c.name }), status),
    h("div", { class: "mono small break muted", text: [c.command, ...c.args].join(" ") }),
    c.enabled && toolList(c),
    h(
      "div",
      { class: "row wrap" },
      h("button", { class: "ghost", text: c.enabled ? t("connectors.turnOff") : t("connectors.turnOn"), on: { click: act(() => invoke("connector_set_enabled", { id: c.id, on: !c.enabled })) } }),
      c.enabled && h("button", { class: "ghost", text: t("connectors.check"), on: { click: act(() => invoke("connector_refresh", { id: c.id })) } }),
      h("button", { class: "ghost danger", text: t("connectors.remove"), on: { click: act(remove) } }),
    ),
  );
}

/** One catalog entry: what it does, the inputs it needs, and Install. */
function catalogCard(entry, reload) {
  const values = {};
  const fields = entry.inputs.map((input) => {
    if (input.kind === "folder") {
      const shown = h("span", { class: "mono small break muted", text: t("connectors.noFolder") });
      const pick = async () => {
        const dir = await dialog.open({ directory: true, multiple: false });
        if (typeof dir !== "string" || !dir) return;
        values.folder = dir;
        shown.textContent = dir;
      };
      return h("div", { class: "field" }, h("span", { class: "muted small", text: t("connectors.folder") }), h("div", { class: "row wrap" }, h("button", { class: "ghost small", text: t("connectors.chooseFolder"), on: { click: pick } }), shown));
    }
    const field = h("input", { type: input.kind === "secret" ? "password" : "text", autocomplete: "off", attrs: { "aria-label": input.key } });
    field.addEventListener("input", () => (values[input.key] = field.value));
    return h("label", { class: "field" }, h("span", { class: "muted small mono", text: input.key }), field);
  });
  const install = async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    btn.textContent = t("connectors.installing");
    try {
      await invoke("connector_install", { catalogId: entry.id, values });
      reload();
    } catch (e) {
      showError(e);
      btn.disabled = false;
      btn.textContent = t("connectors.install");
    }
  };
  return h(
    "section",
    { class: "card stack" },
    h("h2", { text: entry.name }),
    h("p", { class: "muted", text: t(`connectors.catalog.${entry.id}`) }),
    ...fields,
    h(
      "div",
      { class: "row wrap between" },
      h("button", { class: "primary", text: t("connectors.install"), on: { click: install } }),
      h("a", { href: "#", class: "small", text: t("connectors.docs"), on: { click: (ev) => (ev.preventDefault(), opener.openUrl(entry.docs)) } }),
    ),
  );
}

function customCard(reload) {
  const name = h("input", { type: "text", autocomplete: "off" });
  const command = h("input", { type: "text", autocomplete: "off", placeholder: "npx -y @scope/server --flag" });
  const env = h("textarea", { rows: 3, placeholder: "API_KEY=…", attrs: { "aria-label": t("connectors.customEnv") } });
  const add = async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    const vars = {};
    for (const line of env.value.split(/\r?\n/)) {
      const at = line.indexOf("=");
      if (at > 0) vars[line.slice(0, at).trim()] = line.slice(at + 1);
    }
    try {
      await invoke("connector_add", { name: name.value, commandLine: command.value, env: vars });
      reload();
    } catch (e) {
      showError(e);
      btn.disabled = false;
    }
  };
  return h(
    "section",
    { class: "card stack" },
    h("h2", { text: t("connectors.customTitle") }),
    h("p", { class: "muted", text: t("connectors.customBody") }),
    h("label", { class: "field" }, h("span", { class: "muted small", text: t("connectors.customName") }), name),
    h("label", { class: "field" }, h("span", { class: "muted small", text: t("connectors.customCommand") }), command),
    h("label", { class: "field" }, h("span", { class: "muted small", text: t("connectors.customEnv") }), env),
    h("div", { class: "row" }, h("button", { class: "primary", text: t("connectors.add"), on: { click: add } })),
  );
}

export function render(host) {
  const mine = h("div", { class: "stack" });
  const catalog = h("div", { class: "grid" });
  let alive = true;
  const reload = () =>
    invoke("connectors_state")
      .then(({ catalog: entries, connectors }) => {
        if (!alive) return;
        mine.replaceChildren(
          ...(connectors.length ? connectors.map((c) => connectorCard(c, reload)) : [h("div", { class: "card empty-state" }, h("p", { class: "muted", text: t("connectors.empty") }))]),
        );
        catalog.replaceChildren(...entries.map((e) => catalogCard(e, reload)));
      })
      .catch(showError);
  host.append(
    h("header", { class: "page-head" }, h("div", {}, h("h1", { text: t("connectors.title") }), h("p", { class: "muted", text: t("connectors.intro") }))),
    mine,
    h("h2", { class: "section-title", text: t("connectors.catalogTitle") }),
    catalog,
    customCard(reload),
    h("p", { class: "muted small privacy", text: t("connectors.privacy") }),
  );
  reload();
  return () => (alive = false);
}
