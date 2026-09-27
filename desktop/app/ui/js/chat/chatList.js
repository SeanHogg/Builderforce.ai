// The workspace's chats, newest activity first — the same conversations the web app and
// the VS Code extension list — and starting a new one.
import { h, invoke, route, showError } from "../bridge.js";
import { relTime, t } from "../i18n.js";

export function chatList(onCreated) {
  const list = h("ul", { class: "chat-list" });
  const create = h("button", { class: "primary small", type: "button", text: t("chat.new") });
  const el = h("aside", { class: "chat-side card" }, h("div", { class: "row between" }, h("h2", { text: t("chat.chats") }), create), list);
  let selected = null;
  let chats = [];

  create.addEventListener("click", async () => {
    create.disabled = true;
    try {
      const chat = await invoke("chat_create", { title: null });
      await refresh();
      onCreated(chat.id);
    } catch (e) {
      showError(e);
    } finally {
      create.disabled = false;
    }
  });

  function paint() {
    list.replaceChildren(
      ...(chats.length
        ? chats.map((c) =>
            h(
              "li",
              {},
              h(
                "a",
                { class: `chat-item${c.id === selected ? " on" : ""}`, href: route("chat", { id: c.id }), attrs: c.id === selected ? { "aria-current": "page" } : {} },
                h("span", { class: "chat-item-title", text: c.title || t("chat.untitled") }),
                h("span", { class: "muted small", text: relTime(Date.parse(c.updatedAt || c.createdAt)) }),
              ),
            ),
          )
        : [h("li", { class: "muted small chat-empty", text: t("chat.noChats") })]),
    );
  }

  async function refresh() {
    try {
      const r = await invoke("chat_list");
      chats = r.chats ?? [];
      paint();
    } catch (e) {
      showError(e);
    }
    return chats;
  }

  function select(id) {
    selected = id;
    paint();
  }

  return { el, refresh, select, chats: () => chats };
}
