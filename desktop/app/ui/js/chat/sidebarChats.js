// The sidebar's heart: your chats, newest activity first, and a new one at the top — the
// window is where you talk to the Brain and your agents, so the conversations are what the
// sidebar lists. Signed out, it says how to start.
import { h, route, showError } from "../bridge.js";
import { relTime, t } from "../i18n.js";
import { createChat, subscribeChats } from "./chatStore.js";

/** The chat the window has open, from the route. */
function openChatId() {
  const [path, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  return path === "chat" || path === "" ? Number(new URLSearchParams(query).get("id")) || null : null;
}

/** Start a chat and open it (signed out: go and sign in). */
export async function startChat(signedIn) {
  if (!signedIn) {
    location.hash = route("account");
    return;
  }
  try {
    const chat = await createChat();
    location.hash = route("chat", { id: chat.id });
  } catch (e) {
    showError(e);
  }
}

export function mountSidebarChats(host) {
  const list = h("ul", { class: "side-chats-list", attrs: { "aria-label": t("chat.chats") } });
  const empty = h("div", { class: "side-chats-empty muted small" });
  host.append(h("div", { class: "side-section", text: t("chat.chats") }), list, empty);
  let last = null;

  function paint(s = last) {
    if (!s) return;
    last = s;
    const open = openChatId();
    // No chat named in the route: the Chat view opens the newest, so mark that one.
    const current = open ?? (location.hash.replace(/^#\/?/, "").split("?")[0] === "chat" ? s.chats[0]?.id : null);
    list.replaceChildren(
      ...s.chats.map((c) =>
        h(
          "li",
          {},
          h(
            "a",
            { class: `side-chat${c.id === current ? " on" : ""}`, href: route("chat", { id: c.id }), attrs: c.id === current ? { "aria-current": "page" } : {} },
            h("span", { class: "side-chat-title", text: c.title || t("chat.untitled") }),
            h("span", { class: "side-chat-when muted", text: relTime(Date.parse(c.updatedAt || c.createdAt)) }),
          ),
        ),
      ),
    );
    const why = !s.signedIn ? t("chat.signInToChat") : !s.loaded ? t("chat.loading") : s.chats.length ? "" : t("chat.noChats");
    empty.replaceChildren(why, !s.signedIn ? h("a", { href: route("account"), text: ` ${t("account.signInShort")}` }) : "");
    empty.hidden = !why;
  }

  subscribeChats(paint);
  window.addEventListener("hashchange", () => paint());
}
