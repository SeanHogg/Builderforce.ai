// Writing to a chat: to the Brain, or to one assigned agent — picked in the "To" list or
// by starting the message with @Name. Enter sends; Shift+Enter starts a new line.
import { h, showError } from "../bridge.js";
import { t } from "../i18n.js";

/** The agent a message opens with `@Name` for, if any (longest name wins: "@Ann Lee" over "@Ann"). */
function mentioned(text, agents) {
  const lower = text.trimStart().toLowerCase();
  if (!lower.startsWith("@")) return null;
  return [...agents].sort((a, b) => b.name.length - a.name.length).find((a) => {
    const name = `@${a.name.toLowerCase()}`;
    return lower.startsWith(name) && !/[\p{L}\p{N}]/u.test(lower.charAt(name.length));
  }) ?? null;
}

export function composer(onSend) {
  const to = h("select", { attrs: { "aria-label": t("chat.toLabel") } });
  const input = h("textarea", { rows: 2, placeholder: t("chat.placeholder"), attrs: { "aria-label": t("chat.placeholder") } });
  const send = h("button", { class: "primary", type: "submit", text: t("chat.send") });
  const form = h("form", { class: "composer" }, h("div", { class: "row composer-to" }, h("span", { class: "muted small", text: t("chat.toLabel") }), to), h("div", { class: "row composer-main" }, input, send));
  let agents = [];

  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      form.requestSubmit();
    }
  });
  input.addEventListener("input", () => {
    const m = mentioned(input.value, agents);
    if (m) to.value = m.ref;
  });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const content = input.value.trim();
    if (!content) return;
    const agent = agents.find((a) => a.ref === to.value) ?? null;
    send.disabled = true;
    try {
      await onSend(content, agent ? { ref: agent.ref, name: agent.name } : null);
      input.value = "";
      to.value = "";
    } catch (e) {
      showError(e);
    } finally {
      send.disabled = false;
      input.focus();
    }
  });

  /** The agents that can be addressed (the chat's assigned ones). */
  function setAgents(list) {
    const keep = to.value;
    agents = list;
    to.replaceChildren(h("option", { value: "", text: t("chat.brain") }), ...list.map((a) => h("option", { value: a.ref, text: a.name })));
    to.value = list.some((a) => a.ref === keep) ? keep : "";
  }

  function setEnabled(on) {
    input.disabled = !on;
    send.disabled = !on;
    to.disabled = !on;
  }

  return { el: form, setAgents, setEnabled, focus: () => input.focus() };
}
