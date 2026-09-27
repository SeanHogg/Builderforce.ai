// Point every AI tool on this machine at the index — and see which ones actually use it.
import { copyText, h, invoke, showError } from "../bridge.js";
import { lastSeen } from "../clients.js";
import { relTime, t } from "../i18n.js";
import { subscribe } from "../store.js";

// Loaded once per window: the executable path does not change while the app runs.
let infoPromise = null;
const connectInfo = () => (infoPromise ??= invoke("connect_info"));

function codeBlock(textPromise) {
  const pre = h("pre", { class: "code" });
  textPromise.then((txt) => (pre.textContent = txt)).catch(showError);
  return h(
    "div",
    { class: "code-wrap" },
    pre,
    h("button", { class: "ghost small copy", text: t("common.copy"), on: { click: (e) => copyText(e.currentTarget, pre.textContent) } }),
  );
}

function tool({ name, body, client, extra }) {
  const status = h("span");
  const el = h(
    "section",
    { class: "card tool" },
    h("div", { class: "row between wrap" }, h("h2", { text: name }), status),
    h("p", { class: "muted", text: body }),
    extra,
  );
  return {
    el,
    update(entries) {
      const at = lastSeen(entries, client);
      status.replaceChildren(
        h("span", { class: `pill ${at ? "ok" : "idle"}`, text: at ? t("connect.lastRequest", { when: relTime(at) }) : t("connect.noRequests") }),
      );
    },
  };
}

export function render(host) {
  const info = connectInfo();
  const tools = [
    tool({ name: t("connect.vscode"), body: t("connect.vscodeBody"), client: "vscode" }),
    tool({ name: t("connect.claude"), body: t("connect.claudeBody"), client: "mcp", extra: codeBlock(info.then((i) => i.claudeCode)) }),
    tool({ name: t("connect.cursor"), body: t("connect.cursorBody"), client: "mcp", extra: codeBlock(info.then((i) => i.mcpJson)) }),
  ];
  host.append(
    h("header", { class: "page-head" }, h("div", {}, h("h1", { text: t("connect.title") }), h("p", { class: "muted", text: t("connect.intro") }))),
    h("div", { class: "stack" }, tools.map((x) => x.el)),
    h("p", { class: "muted small privacy", text: t("connect.privacy") }),
  );
  return subscribe((s) => tools.forEach((x) => x.update(s.activity)));
}
