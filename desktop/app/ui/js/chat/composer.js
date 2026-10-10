// Writing to a chat: to the Brain, or to one assigned agent — picked in the "To" list or
// by starting the message with @Name. Enter sends; Shift+Enter starts a new line.
//
// The same box every Builderforce prompt draws (web, editor, Spawn): one filled box with
// the text on top and one row under it — "To" only when the chat has agents to address,
// and ONE round trailing button that is the mic on an empty box (where this window can
// listen) and Send once there is text. The box is never greyed out while a message goes.
import { h, showError } from "../bridge.js";
import { t } from "../i18n.js";
import { dictation } from "./dictation.js";

/** The agent a message opens with `@Name` for, if any (longest name wins: "@Ann Lee" over "@Ann"). */
function mentioned(text, agents) {
  const lower = text.trimStart().toLowerCase();
  if (!lower.startsWith("@")) return null;
  return [...agents].sort((a, b) => b.name.length - a.name.length).find((a) => {
    const name = `@${a.name.toLowerCase()}`;
    return lower.startsWith(name) && !/[\p{L}\p{N}]/u.test(lower.charAt(name.length));
  }) ?? null;
}

const ICON_SEND = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
const ICON_MIC = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';

export function composer(onSend) {
  const to = h("select", { attrs: { "aria-label": t("chat.toLabel") } });
  const toRow = h("label", { class: "composer-to", hidden: true }, h("span", { text: t("chat.toLabel") }), to);
  const input = h("textarea", { rows: 2, placeholder: t("chat.placeholder"), attrs: { "aria-label": t("chat.placeholder") } });
  const action = h("button", { class: "composer-action", type: "button" });
  const box = h("div", { class: "composer-box" }, input, h("div", { class: "composer-tools" }, toRow, h("span", { class: "composer-spacer" }), action));
  const form = h("form", { class: "composer" }, box);
  const voice = dictation(() => input.value, (text) => { input.value = text; paint(); });
  let agents = [];
  let enabled = true;
  let sending = false;

  /** Mic on an empty box where this window can listen (and while it listens); Send otherwise. */
  function paint() {
    const hasText = input.value.trim().length > 0;
    const mic = voice.recording || (!hasText && voice.supported);
    const label = mic ? (voice.recording ? t("chat.stopDictation") : t("chat.dictate")) : t("chat.send");
    action.innerHTML = mic ? ICON_MIC : ICON_SEND;
    action.className = `composer-action ${mic ? "is-voice" : "is-send"}${voice.recording ? " is-listening" : ""}`;
    action.title = label;
    action.setAttribute("aria-label", label);
    action.setAttribute("aria-pressed", mic ? String(voice.recording) : "false");
    action.disabled = !enabled || (!mic && (!hasText || sending));
    box.classList.toggle("is-active", hasText || document.activeElement === input);
  }
  voice.onChange(paint);

  action.addEventListener("click", () => {
    if (action.classList.contains("is-voice")) voice.toggle();
    else form.requestSubmit();
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      form.requestSubmit();
    }
  });
  input.addEventListener("input", () => {
    const m = mentioned(input.value, agents);
    if (m) to.value = m.ref;
    paint();
  });
  input.addEventListener("focus", paint);
  input.addEventListener("blur", paint);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const content = input.value.trim();
    if (!content || sending) return;
    voice.stop();
    const agent = agents.find((a) => a.ref === to.value) ?? null;
    sending = true;
    // Cleared on send, so the box never shows what already went; restored if it fails.
    input.value = "";
    paint();
    try {
      await onSend(content, agent ? { ref: agent.ref, name: agent.name } : null);
      to.value = "";
    } catch (e) {
      if (!input.value) input.value = content;
      showError(e);
    } finally {
      sending = false;
      paint();
      input.focus();
    }
  });

  /** The agents that can be addressed (the chat's assigned ones). No agents: no "To". */
  function setAgents(list) {
    const keep = to.value;
    agents = list;
    to.replaceChildren(h("option", { value: "", text: t("chat.brain") }), ...list.map((a) => h("option", { value: a.ref, text: a.name })));
    to.value = list.some((a) => a.ref === keep) ? keep : "";
    toRow.hidden = list.length === 0;
  }

  function setEnabled(on) {
    enabled = on;
    input.disabled = !on;
    to.disabled = !on;
    if (!on) voice.stop();
    paint();
  }

  paint();
  return { el: form, setAgents, setEnabled, focus: () => input.focus() };
}
