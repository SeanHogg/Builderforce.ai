// A chat's messages: who said each one (you, the Brain, or the agent that replied), who a
// message was addressed to, and when. Plain text with line breaks kept — never HTML from
// the transcript, so nothing in a message can script the window.
import { h } from "../bridge.js";
import { relTime, t } from "../i18n.js";

function meta(m) {
  if (!m.metadata) return {};
  try {
    return typeof m.metadata === "string" ? JSON.parse(m.metadata) : m.metadata;
  } catch {
    return {};
  }
}

/** Recipients of a user turn: one participant, or a group's members. */
function recipients(md) {
  const a = md.addressedTo;
  if (!a) return [];
  if (a.kind === "group") return (a.members ?? []).map((x) => x.name).filter(Boolean);
  return a.name ? [a.name] : [];
}

function author(m, md) {
  if (m.role === "user") return t("chat.you");
  return md.authoredBy?.name || t("chat.brain");
}

const at = (m) => (m.createdAt ? Date.parse(m.createdAt) : null);

/** `live`: the Brain's reply being written (its element from `liveReply`), or null. */
export function renderTranscript(list, messages, { live, replyError }) {
  const shown = messages.filter((m) => (m.role === "user" || m.role === "assistant") && String(m.content ?? "").trim());
  const rows = shown.map((m) => {
    const md = meta(m);
    const to = recipients(md);
    const when = at(m);
    return h(
      "li",
      { class: `msg msg-${m.role}${md.authoredBy ? " msg-agent" : ""}` },
      h(
        "div",
        { class: "msg-head" },
        h("strong", { text: author(m, md) }),
        to.length > 0 && h("span", { class: "chip", text: t("chat.to", { names: to.join(", ") }) }),
        when && h("span", { class: "muted small", text: relTime(when) }),
      ),
      h("div", { class: "msg-body", text: String(m.content) }),
    );
  });
  if (live) rows.push(live);
  if (replyError) rows.push(h("li", { class: "msg msg-error", attrs: { role: "status" } }, h("div", { class: "msg-body", text: t("chat.replyFailed", { reason: replyError }) })));
  if (rows.length === 0) rows.push(h("li", { class: "chat-empty muted", text: t("chat.emptyConversation") }));
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  list.replaceChildren(...rows);
  if (nearBottom) list.scrollTop = list.scrollHeight;
}

/** Whether an agent was addressed recently and has not answered yet — worth polling fast. */
export function awaitingAgent(messages) {
  const last = [...messages].reverse().find((m) => m.role === "user" || m.role === "assistant");
  if (!last || last.role !== "user") return false;
  const md = meta(last);
  const when = at(last);
  return recipients(md).length > 0 && (!when || Date.now() - when < 3 * 60_000);
}
