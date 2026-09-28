// Chat: one of the workspace's Brain chats (picked in the sidebar), the agents assigned to
// it, and the composer. Signed out, it is the sign-in. A message to the Brain is answered
// here with the private Evermind's recall; a message to an agent is answered by that agent,
// with its own tools, as you.
import { h, invoke, route, showError } from "../bridge.js";
import { t } from "../i18n.js";
import { openWeb, subscribeAccount } from "../cloud/accountStore.js";
import { signInCard } from "../cloud/accountPanel.js";
import { agentPool, agentsBar, assignedName, resetAgentPool } from "../chat/agentsBar.js";
import { refreshChats, subscribeChats } from "../chat/chatStore.js";
import { startChat } from "../chat/sidebarChats.js";
import { composer } from "../chat/composer.js";
import { awaitingAgent, renderTranscript } from "../chat/transcript.js";

const FAST_MS = 2000;
const SLOW_MS = 6000;

export function render(host, params) {
  const signIn = signInCard();
  const title = h("h1", { class: "min0 break chat-title" });
  const openBtn = h("button", { class: "ghost small", type: "button", text: t("chat.openWeb") });
  const agents = agentsBar(() => loadAgents());
  const transcript = h("ul", { class: "transcript", attrs: { "aria-live": "polite" } });
  const write = composer(send);
  const conversation = h("section", { class: "chat-main", hidden: true }, h("div", { class: "row between wrap chat-head" }, title, openBtn), agents.el, transcript, write.el);
  const empty = h(
    "section",
    { class: "card stack chat-start", hidden: true },
    h("h2", { text: t("chat.startTitle") }),
    h("p", { class: "muted", text: t("chat.intro") }),
    h("div", { class: "row" }, h("button", { class: "primary", text: t("chat.new"), on: { click: () => startChat(true) } })),
  );
  host.append(signIn.el, conversation, empty);

  let chatId = null;
  let timer = null;
  let workspace;
  let alive = true;
  const wanted = Number(params.get("id")) || null;

  openBtn.addEventListener("click", () => chatId != null && openWeb(`/brainstorm?chat=${chatId}`).catch(showError));

  async function loadAgents() {
    if (chatId == null) return;
    try {
      const [r, pool] = await Promise.all([invoke("chat_agents", { chatId }), agentPool()]);
      const assigned = r.agents ?? [];
      await agents.update(chatId, assigned);
      write.setAgents(assigned.map((a) => ({ ref: String(a.agentRef), name: assignedName(a, pool) })));
    } catch (e) {
      showError(e);
    }
  }

  async function loadMessages() {
    clearTimeout(timer);
    if (!alive || chatId == null) return;
    let fast = false;
    try {
      const r = await invoke("chat_messages", { chatId });
      renderTranscript(transcript, r.messages ?? [], r);
      fast = r.replying || awaitingAgent(r.messages ?? []);
    } catch (e) {
      showError(e);
    }
    if (alive) timer = setTimeout(loadMessages, fast ? FAST_MS : SLOW_MS);
  }

  async function send(content, to) {
    await invoke("chat_send", { chatId, content, to });
    await loadMessages();
    // A first message names the chat; the sidebar shows it.
    refreshChats();
  }

  async function open(id) {
    chatId = id;
    transcript.replaceChildren();
    write.setEnabled(id != null);
    if (id == null) return;
    await Promise.all([loadAgents(), loadMessages()]);
    write.focus();
  }

  // The open chat: the one the route names, else the newest. Its title follows the list.
  const stopChats = subscribeChats((s) => {
    if (!s.signedIn || !s.loaded) {
      conversation.hidden = true;
      empty.hidden = true;
      return;
    }
    const id = s.chats.some((c) => c.id === wanted) ? wanted : (s.chats[0]?.id ?? null);
    conversation.hidden = id == null;
    empty.hidden = id != null;
    const chat = s.chats.find((c) => c.id === id);
    title.textContent = chat?.title || t("chat.untitled");
    if (id !== chatId) open(id);
  });

  const stopAccount = subscribeAccount((s) => {
    signIn.el.hidden = s.signedIn;
    if (!s.signedIn) {
      workspace = undefined;
      chatId = null;
      clearTimeout(timer);
      return;
    }
    // A switched workspace has other agents; the chat list re-reads itself.
    if (workspace !== s.workspaceId) {
      if (workspace !== undefined && wanted != null) location.hash = route("chat");
      workspace = s.workspaceId;
      resetAgentPool();
    }
  });

  return () => {
    alive = false;
    clearTimeout(timer);
    stopChats();
    stopAccount();
    signIn.stop();
  };
}
