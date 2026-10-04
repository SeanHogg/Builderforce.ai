// The Brain's reply while it is being written: the answer so far as it streams in, the tool
// it is using, and — before a tool that changes something — what it wants to do, with
// Approve / Decline. One element, updated in place, so streaming never re-renders the
// transcript. Plain text only, like every message.
import { h, invoke, showError } from "../bridge.js";
import { t } from "../i18n.js";

export function liveReply() {
  const body = h("div", { class: "msg-body" });
  const activity = h("div", { class: "muted small live-activity", hidden: true });
  const ask = h("div", { class: "approval-step stack live-ask", hidden: true, attrs: { role: "group" } });
  const el = h("li", { class: "msg msg-assistant msg-pending" }, h("div", { class: "msg-head" }, h("strong", { text: t("chat.brain") })), body, activity, ask);
  let chatId = null;
  let askedFor = null;

  async function decide(approve) {
    for (const b of ask.querySelectorAll("button")) b.disabled = true;
    try {
      await invoke("chat_tool_decide", { chatId, approve });
    } catch (e) {
      showError(e);
    }
  }

  /** Show `live` (the app's `LiveReply`) for `chat`. */
  function update(chat, live) {
    chatId = chat;
    const draft = live?.draft ?? "";
    body.textContent = draft || t("chat.thinking");
    body.classList.toggle("muted", !draft);
    activity.hidden = !live?.activity;
    activity.textContent = live?.activity ? t("chat.usingTool", { tool: live.activity }) : "";
    const pending = live?.pending ?? null;
    ask.hidden = !pending;
    if (!pending) {
      askedFor = null;
      return;
    }
    if (askedFor === pending.id) return;
    askedFor = pending.id;
    ask.replaceChildren(
      h("strong", { text: t("chat.toolAsk", { tool: pending.label }) }),
      h("div", { class: "muted small", text: t("chat.toolAskBody") }),
      pending.arguments && pending.arguments !== "{}" && h("pre", { class: "live-args small", text: pending.arguments }),
      h(
        "div",
        { class: "row wrap" },
        h("button", { class: "primary small", type: "button", text: t("chat.toolApprove"), on: { click: () => decide(true) } }),
        h("button", { class: "ghost small danger", type: "button", text: t("chat.toolDeny"), on: { click: () => decide(false) } }),
      ),
    );
    ask.querySelector("button.primary")?.focus();
  }

  return { el, update };
}
