// ONE list of the signed-in workspace's chats — the same conversations the web app and the
// VS Code extension list — shared by the sidebar (where you pick one) and the Chat view
// (where you talk in it). Re-read on sign-in and workspace switch, after a new chat or a
// sent message, and every half minute for chats started elsewhere.
import { invoke, showError } from "../bridge.js";
import { subscribeAccount } from "../cloud/accountStore.js";

const POLL_MS = 30_000;

const state = { signedIn: false, loaded: false, chats: [] };
const subscribers = new Set();
let workspace;
let timer = null;

const notify = () => {
  for (const fn of subscribers) fn(state);
};

export function subscribeChats(fn) {
  subscribers.add(fn);
  fn(state);
  return () => subscribers.delete(fn);
}

export const chatState = () => state;

export async function refreshChats() {
  clearTimeout(timer);
  if (!state.signedIn) return [];
  try {
    const r = await invoke("chat_list");
    state.chats = r.chats ?? [];
    state.loaded = true;
    notify();
  } catch (e) {
    showError(e);
  }
  timer = setTimeout(refreshChats, POLL_MS);
  return state.chats;
}

/** Start a chat; resolves to it once the list shows it. */
export async function createChat() {
  const chat = await invoke("chat_create", { title: null });
  await refreshChats();
  return chat;
}

subscribeAccount((s) => {
  state.signedIn = s.signedIn;
  if (!s.signedIn) {
    clearTimeout(timer);
    workspace = undefined;
    Object.assign(state, { loaded: false, chats: [] });
    notify();
    return;
  }
  // Signed in, or switched workspace: its chats are different ones.
  if (workspace !== s.workspaceId) {
    workspace = s.workspaceId;
    Object.assign(state, { loaded: false, chats: [] });
    notify();
    refreshChats();
  }
});
