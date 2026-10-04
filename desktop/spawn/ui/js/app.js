// Spawn's window: sign in → (finish setting up on the website) → build.
//
// Three screens, chosen from two facts the Rust side owns: the browser sign-in
// (`account_state`) and the Spawn account (`spawn_account`: age, membership, tokens).
// Studio's connection is polled on its own and shown in the bar; a build needs it.
import { applyI18n, has, num, t } from "./i18n.js";

const { invoke } = window.__TAURI__.core;
const $ = (id) => document.getElementById(id);
const screen = $("screen");

const LOG_KEY = "spawn.log";
const MAX_LOG = 60;
const HISTORY_TURNS = 8;
const STARTERS = ["obby", "tycoon", "simulator", "racing", "towerDefense", "hideSeek"];

let current = "";
let signInTimer = null;
let building = false;
let studio = { connected: false, errors: 0, placeName: null, pluginInstalled: true };
let log = loadLog();

function loadLog() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
    return Array.isArray(saved) ? saved.slice(-MAX_LOG) : [];
  } catch {
    return [];
  }
}

function saveLog() {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-MAX_LOG)));
  } catch {
    /* storage unavailable: the conversation lives for this session only */
  }
}

/** A refusal in the player's language: its code's sentence, else the generic one. */
function errorText(err) {
  const code = err && typeof err === "object" ? err.code : null;
  return code && has(`error.${code}`) ? t(`error.${code}`) : t("error.generic");
}

function show(name) {
  if (current === name) return false;
  current = name;
  screen.replaceChildren($(`tpl-${name}`).content.cloneNode(true));
  applyI18n(screen);
  return true;
}

// ── Account ────────────────────────────────────────────────────────────────────────
async function refresh() {
  let state;
  try {
    state = await invoke("account_state");
  } catch (err) {
    return renderSignIn({ signIn: { state: "Failed", reason: errorText(err) } });
  }
  $("account-pill").hidden = !state.signedIn;
  if (!state.signedIn) {
    $("tokens-pill").hidden = true;
    return renderSignIn(state);
  }
  stopSignInPoll();
  try {
    const account = await invoke("spawn_account");
    updateTokens(account.balance);
    if (account.age !== "ok") return renderGate(account.age === "too_young" ? "tooYoung" : "age");
    if (account.membership !== "active") return renderGate("join");
    renderBuild();
  } catch (err) {
    if (err?.code === "signed_out") return refresh();
    renderGate("offline", errorText(err));
  }
}

function updateTokens(balance) {
  const pill = $("tokens-pill");
  pill.hidden = balance == null;
  if (balance != null) pill.textContent = t("tokens.pill", { count: num(balance) });
}

function renderSignIn(state) {
  show("signin");
  const box = $("signin-state");
  const btn = $("signin-btn");
  const s = state.signIn || { state: "Idle" };
  if (s.state === "Waiting") {
    box.replaceChildren(
      Object.assign(document.createElement("p"), { className: "muted", textContent: t("signin.waiting") }),
      Object.assign(document.createElement("div"), { className: "code", textContent: s.userCode }),
    );
    btn.textContent = t("signin.cancel");
    btn.onclick = async () => {
      await invoke("account_sign_in_cancel");
      stopSignInPoll();
      refresh();
    };
    startSignInPoll();
    return;
  }
  const failedKey = `signin.failed.${s.reason}`;
  const note = s.state === "Failed" ? (has(failedKey) ? t(failedKey) : s.reason) : state.expired ? t("signin.expired") : "";
  box.replaceChildren(...(note ? [Object.assign(document.createElement("p"), { className: "muted", textContent: note })] : []));
  btn.textContent = t("signin.button");
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      await invoke("account_sign_in");
    } catch (err) {
      box.replaceChildren(Object.assign(document.createElement("p"), { className: "muted", textContent: errorText(err) }));
    }
    btn.disabled = false;
    refresh();
  };
}

function startSignInPoll() {
  if (!signInTimer) signInTimer = setInterval(refresh, 2000);
}
function stopSignInPoll() {
  clearInterval(signInTimer);
  signInTimer = null;
}

function renderGate(kind, detail) {
  show("gate");
  current = `gate-${kind}`;
  $("gate-title").textContent = t(`gate.${kind}.title`);
  $("gate-body").textContent = detail || t(`gate.${kind}.body`);
  $("gate-open").hidden = kind === "tooYoung" || kind === "offline";
  $("gate-open").onclick = () => invoke("account_open_web", { path: "/spawn/account" });
  $("gate-check").onclick = refresh;
}

// ── Building ───────────────────────────────────────────────────────────────────────
function renderBuild() {
  if (!show("build")) return;
  $("composer").onsubmit = (event) => {
    event.preventDefault();
    send($("prompt").value);
  };
  $("prompt").onkeydown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send($("prompt").value);
    }
  };
  $("errors-fix").onclick = () => send(t("build.fixPrompt"));
  const starters = $("starters");
  for (const id of STARTERS) {
    const chip = Object.assign(document.createElement("button"), { type: "button", className: "chip", textContent: t(`starter.${id}.label`) });
    chip.onclick = () => send(t(`starter.${id}.prompt`));
    starters.append(chip);
  }
  paintLog();
  paintStudio();
}

function paintLog() {
  const list = $("log");
  if (!list) return;
  $("starters").hidden = log.length > 0 || building;
  list.replaceChildren(...log.map(renderMessage));
  if (building) {
    const li = Object.assign(document.createElement("li"), { className: "msg spawn thinking", textContent: t("build.thinking") });
    list.append(li);
  }
  list.scrollTop = list.scrollHeight;
}

function renderMessage(m) {
  const li = Object.assign(document.createElement("li"), { className: `msg ${m.role}` });
  li.append(document.createTextNode(m.text));
  if (m.meta) li.append(Object.assign(document.createElement("span"), { className: "meta", textContent: m.meta }));
  if (m.next?.length) {
    const row = Object.assign(document.createElement("div"), { className: "next" });
    for (const idea of m.next) {
      const chip = Object.assign(document.createElement("button"), { type: "button", className: "chip", textContent: idea });
      chip.onclick = () => send(idea);
      row.append(chip);
    }
    li.append(row);
  }
  if (m.action) {
    const btn = Object.assign(document.createElement("button"), { type: "button", className: "ghost small-btn", textContent: t(m.action.label) });
    btn.onclick = () => invoke("account_open_web", { path: m.action.path });
    li.append(document.createElement("br"), btn);
  }
  return li;
}

function metaFor(out) {
  const parts = [];
  if (out.applied) parts.push(t("build.meta.applied", { count: num(out.applied) }));
  const problems = (out.failed?.length || 0) + (out.rejected?.length || 0);
  if (problems) parts.push(t("build.meta.skipped", { count: num(problems) }));
  if (out.tokensUsed) parts.push(t("build.meta.tokens", { count: num(out.tokensUsed) }));
  if (out.applied) parts.push(t("build.meta.undo"));
  return parts.join(" · ");
}

async function send(text) {
  const prompt = (text || "").trim();
  if (!prompt || building) return;
  const history = log
    .filter((m) => m.role === "me" || m.role === "spawn")
    .slice(-HISTORY_TURNS)
    .map((m) => ({ role: m.role === "me" ? "player" : "spawn", text: m.text }));
  log.push({ role: "me", text: prompt });
  if ($("prompt")) $("prompt").value = "";
  building = true;
  $("send").disabled = true;
  paintLog();
  try {
    const out = await invoke("build", { prompt, history });
    log.push({
      role: "spawn",
      text: out.reply || (out.refused ? t("build.refused") : t("build.done")),
      meta: metaFor(out),
      next: Array.isArray(out.next) ? out.next : [],
    });
    updateTokens(out.balance);
  } catch (err) {
    const code = err?.code;
    const action = code === "insufficient_tokens"
      ? { label: "action.getTokens", path: "/spawn/account" }
      : code === "membership_required" || code === "age_required"
        ? { label: "action.openAccount", path: "/spawn/account" }
        : null;
    log.push({ role: "error", text: errorText(err), action });
    if (code === "signed_out" || code === "membership_required" || code === "age_required") refresh();
  } finally {
    building = false;
    saveLog();
    if ($("send")) $("send").disabled = false;
    paintLog();
  }
}

// ── Studio ─────────────────────────────────────────────────────────────────────────
function paintStudio() {
  const pill = $("studio-pill");
  pill.className = `pill ${studio.connected ? "ok" : "warn"}`;
  pill.textContent = studio.connected
    ? studio.placeName ? t("studio.connectedTo", { place: studio.placeName }) : t("studio.connected")
    : studio.pluginInstalled ? t("studio.open") : t("studio.noPlugin");
  const banner = $("errors-banner");
  if (banner) {
    banner.hidden = !studio.errors;
    $("errors-text").textContent = t("build.errorsWaiting", { count: num(studio.errors) });
  }
}

async function pollStudio() {
  try {
    studio = await invoke("studio_status");
  } catch {
    studio = { connected: false, errors: 0, placeName: null, pluginInstalled: true };
  }
  paintStudio();
}

// ── Account menu ───────────────────────────────────────────────────────────────────
function wireMenu() {
  const menu = $("account-menu");
  $("account-pill").onclick = () => menu.showModal();
  $("tokens-pill").onclick = () => invoke("account_open_web", { path: "/spawn/account" });
  $("menu-account").onclick = () => {
    menu.close();
    invoke("account_open_web", { path: "/spawn/account" });
  };
  $("menu-plugin").onclick = async () => {
    menu.close();
    try {
      await invoke("studio_reinstall_plugin");
      log.push({ role: "spawn", text: t("studio.reinstalled") });
    } catch (err) {
      log.push({ role: "error", text: errorText(err) });
    }
    saveLog();
    paintLog();
  };
  $("menu-signout").onclick = async () => {
    menu.close();
    await invoke("account_sign_out");
    current = "";
    refresh();
  };
}

applyI18n();
wireMenu();
pollStudio();
setInterval(pollStudio, 3000);
refresh();
// Coming back from the website (joined, bought tokens) should not need a restart.
window.addEventListener("focus", () => {
  if (!building && !signInTimer) refresh();
});
