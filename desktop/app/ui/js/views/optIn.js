// The opt-in, rendered wherever Self-Directed Agents would otherwise appear. It decides
// its own visibility: nothing on an enabled, supported machine; an explanation and the
// switch when off; a plain "not on this OS yet" when unsupported.
import { h, invoke, showError } from "../bridge.js";
import { t } from "../i18n.js";
import { refreshAgents } from "../agentStore.js";

export function optInCard(state) {
  if (state.supported && state.enabled) return null;
  if (!state.supported) {
    return h("div", { class: "card empty-state" }, h("h2", { text: t("optin.unsupportedTitle") }), h("p", { class: "muted", text: t("optin.unsupportedBody") }));
  }
  const turnOn = async () => {
    try {
      await invoke("agents_set_enabled", { on: true });
      await refreshAgents();
    } catch (e) {
      showError(e);
    }
  };
  return h(
    "div",
    { class: "card optin" },
    h("h2", { text: t("optin.title") }),
    h("p", { class: "muted", text: t("optin.body") }),
    h(
      "ul",
      { class: "optin-points" },
      ["optin.point1", "optin.point2", "optin.point3", "optin.point4"].map((k) => h("li", { text: t(k) })),
    ),
    h("div", { class: "row wrap" }, h("button", { class: "primary", text: t("optin.turnOn"), on: { click: turnOn } }), h("span", { class: "muted small", text: t("optin.later") })),
  );
}
