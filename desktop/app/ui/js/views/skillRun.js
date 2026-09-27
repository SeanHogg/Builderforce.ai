// Run a skill now: one input per parameter (defaults from the demonstration), secrets as
// password fields that may come from the OS vault instead, and the choice to save them.
import { h, invoke, showError } from "../bridge.js";
import { t } from "../i18n.js";
import { refreshAgents } from "../agentStore.js";

export function runForm(skill, onStarted) {
  const values = {};
  const saved = new Set(skill.savedSecrets || []);
  const remember = h("input", { type: "checkbox" });
  const inputs = skill.params.map((p) => {
    const input = h("input", {
      type: p.secret ? "password" : "text",
      value: p.secret ? "" : (p.default ?? ""),
      placeholder: p.secret && saved.has(p.name) ? t("skills.secretSaved") : "",
      attrs: { "aria-label": p.label || p.name, autocomplete: "off" },
      on: { input: (e) => (values[p.name] = e.target.value) },
    });
    if (!p.secret && p.default != null) values[p.name] = p.default;
    return h("label", { class: "field" }, h("span", { text: p.label || p.name }), input);
  });
  const run = async (ev) => {
    ev.preventDefault();
    const missing = skill.params.find((p) => p.secret && !values[p.name] && !saved.has(p.name));
    if (missing) return showError(t("skills.secretMissing", { name: missing.label || missing.name }));
    try {
      await invoke("skill_run", { id: skill.id, values, rememberSecrets: remember.checked });
      await refreshAgents();
      onStarted?.();
    } catch (e) {
      showError(e);
    }
  };
  const hasSecrets = skill.params.some((p) => p.secret);
  return h(
    "form",
    { class: "stack", on: { submit: run } },
    inputs.length ? h("div", { class: "grid-2" }, inputs) : h("p", { class: "muted small", text: t("skills.noParams") }),
    hasSecrets && h("label", { class: "check" }, remember, t("skills.rememberSecrets")),
    h("p", { class: "muted small", text: t("skills.takeover") }),
    h("div", { class: "row" }, h("button", { class: "primary", type: "submit", text: t("skills.runNow") })),
  );
}
