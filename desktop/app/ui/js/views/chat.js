// Chat: the workspace's Brain chats, from Synapse. Signed out, it is the sign-in. Signed
// in: the chats, one conversation with the agents assigned to it, and the composer. A
// message to the Brain is answered here with the private Evermind's recall; a message to
// an agent is answered by that agent, with its own tools, as you.
import { h, invoke, route, showError } from "../bridge.js";
import { t } from "../i18n.js";
import { openWeb, subscribeAccount } from "../cloud/accountStore.js";
import { signInCard, workspacePicker } from "../cloud/accountPanel.js";
import { agentPool, agentsBar, assignedName, resetAgentPool } from "../chat/agentsBar.js";
import { chatList } from "../chat/chatList.js";
import { composer } from "../chat/composer.js";
import { awaitingAgent, renderTranscript } from "../chat/transcript.js";

const FAST_MS = 2000;
const SLOW_MS = 6000;

export function render(host, params) {
  const signIn = signInCard();
  const picker = workspacePicker();
  const list = chatList((id) => (location.hash = route("chat", { id })));
  const title = h("h2", { class: "min0 break" });
  const openBtn = h("button", { class: "ghost small", type: "button", text: t("chat.openWeb") });
  const agents = agentsBar(() => loadAgents());
  const transcript = h("ul", { class: "transcript", attrs: { "aria-live": "polite" } });
  const write = composer(send);
  const conversation = h(
    "section",
    { class: "chat-main card" },
    h("div", { class: "row between wrap chat-head" }, title, openBtn),
    agents.el,
    transcript,
    write.el,
  );
  const layout = h("div", { class: "chat-layout" }, list.el, conversation);
  host.append(
    h("header", { class: "page-head" }, h("div", {}, h("h1", { text: t("chat.title") }), h("p", { class: "muted", text: t("chat.intro") })), picker.el),
    signIn.el,
    layout,
  );

  let chatId = null;
  let timer = null;
  let workspace;
  let alive = true;

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
  }

  async function open(id) {
    chatId = id;
    list.select(id);
    conversation.hidden = id == null;
    write.setEnabled(id != null);
    if (id == null) return;
    const chat = list.chats().find((c) => c.id === id);
    title.textContent = chat?.title || t("chat.untitled");
    transcript.replaceChildren();
    await Promise.all([loadAgents(), loadMessages()]);
    write.focus();
  }

  async function start() {
    const chats = await list.refresh();
    const wanted = Number(params.get("id"));
    const id = chats.some((c) => c.id === wanted) ? wanted : (chats[0]?.id ?? null);
    await open(id);
  }

  const stopAccount = subscribeAccount((s) => {
    layout.hidden = !s.signedIn;
    signIn.el.hidden = s.signedIn;
    if (!s.signedIn) {
      workspace = undefined;
      clearTimeout(timer);
      return;
    }
    // Signed in, or switched workspace: its chats and agents are different ones.
    if (workspace !== s.workspaceId) {
      workspace = s.workspaceId;
      resetAgentPool();
      start();
    }
  });

  return () => {
    alive = false;
    clearTimeout(timer);
    stopAccount();
    signIn.stop();
    picker.stop();
  };
}
