"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/pendingWords.ts
var pendingWords_exports = {};
__export(pendingWords_exports, {
  clearPendingWords: () => clearPendingWords,
  forgetPendingWords: () => forgetPendingWords,
  markPendingWordsRead: () => markPendingWordsRead,
  registerPendingWordsReplay: () => registerPendingWordsReplay,
  rememberPendingWords: () => rememberPendingWords,
  replayAllPendingWords: () => replayAllPendingWords,
  replayPendingWords: () => replayPendingWords,
  setPendingWordsOwner: () => setPendingWordsOwner
});
module.exports = __toCommonJS(pendingWords_exports);

// src/chatError.ts
var CONTINUATION_TIMED_OUT = "continuation_timed_out";
var LOCAL_ENGINE_FAILURE_CODES = ["bfi_engine_crashed", "page_engine_detached", "model_keeps_crashing"];
var LOCAL_ENGINE_CODE_RE = new RegExp(`\\b(${LOCAL_ENGINE_FAILURE_CODES.join("|")})\\b`);

// src/runStore/deadline.ts
async function bounded(ms, promise) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(CONTINUATION_TIMED_OUT)), ms);
  });
  try {
    return await Promise.race([Promise.resolve(promise), late]);
  } finally {
    clearTimeout(timer);
  }
}

// src/pageEngines/types.ts
var errorMessage = (e) => e instanceof Error ? e.message : String(e);

// src/pendingWordsFailure.ts
function reportPendingWordsFailure(stage, error) {
  console.warn(`BuilderForce pending words: ${stage} failed (${errorMessage(error)})`);
}

// ../packages/agent-loop/src/runNarration.ts
var NARRATION_OPENER = new RegExp(
  "^(?:(?:now|next|first|then|so|okay|ok|alright|actually|great|good|perfect|but|and|also|finally)[,!.]?\\s+)*(?:let me|let's|i(?:'ll| will| need to| should| want to| am going to|'m going to| think| see| can see| notice| ran)\\b|looking (?:at|back|for)\\b|checking\\b|now the\\b|that was expected\\b)",
  "i"
);

// ../packages/agent-loop/src/turnPhase.ts
var MID_TURN_META_KEY = "midTurn";

// ../packages/agent-loop/src/taskClosedState.ts
var TASK_CLOSED_STATUSES = ["done", "cancelled", "canceled", "completed", "archived"];
var CLOSED = new Set(TASK_CLOSED_STATUSES);

// ../packages/agent-loop/src/reasoning.ts
var REASONING_TAG = "think(?:ing)?|thought|antthinking|scratchpad|reasoning";
var QUICK_TAG_RE = new RegExp(`<\\s*/?\\s*(?:${REASONING_TAG}|final)\\b`, "i");
var REASONING_TAG_RE = new RegExp(`<\\s*(/?)\\s*(?:${REASONING_TAG})\\b[^<>]*>`, "gi");

// src/steerMetadata.ts
function steerMetadata(steer) {
  const attachments = steer.attachments ?? [];
  return JSON.stringify({ [MID_TURN_META_KEY]: true, ...attachments.length > 0 ? { attachments } : {} });
}

// src/pendingWords.ts
var TTL_MS = 7 * 24 * 60 * 60 * 1e3;
var PER_CHAT_CAP = 50;
var START_GRACE_MS = 5e3;
var BEAT_MS = 4e3;
var BEAT_DEAD_MS = 15e3;
var REPLAY_BUDGET_MS = 2e4;
var SAVE_MS = 8e3;
var SESSION = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random());
var PREFIX = "bf:pendingWords:";
var BEAT_PREFIX = "bf:pendingBeat:";
var lockName = (session) => `${PREFIX}session:${session}`;
var owner = null;
var startupPersistence = null;
function setPendingWordsOwner(who) {
  const next = who ? `${who.tenant}:${who.user}` : null;
  const changed = next !== owner;
  owner = next;
  if (!owner) stopBeating();
  if (changed && owner && startupPersistence) void replayAllPendingWords(startupPersistence);
}
function registerPendingWordsReplay(persistence) {
  startupPersistence = persistence;
  if (persistence && owner) void replayAllPendingWords(persistence);
}
var keyOf = (chatId) => owner ? `${PREFIX}${owner}:${chatId}` : null;
function onStorage(use, fallback) {
  try {
    return typeof localStorage === "undefined" ? fallback : use(localStorage);
  } catch {
    return fallback;
  }
}
var keysStarting = (prefix) => onStorage((store) => {
  const found = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key?.startsWith(prefix)) found.push(key);
  }
  return found;
}, []);
function parse(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((p) => typeof p?.eventKey === "string" && typeof p?.text === "string");
  } catch {
    return null;
  }
}
function read(key) {
  const got = onStorage((store) => ({ raw: store.getItem(key) }), null);
  if (!got) return null;
  const raw = got.raw;
  if (!raw) return [];
  const list = parse(raw);
  if (!list) {
    onStorage((store) => store.removeItem(key), void 0);
    return [];
  }
  const now = Date.now();
  const live = list.filter((p) => typeof p.at !== "number" || now - p.at < TTL_MS);
  if (live.length !== list.length) write(key, live);
  return live;
}
function write(key, list) {
  return onStorage((store) => {
    if (list.length === 0) store.removeItem(key);
    else store.setItem(key, JSON.stringify(list));
    return true;
  }, false);
}
var holding = false;
var beatTimer = null;
function holdSession() {
  if (holding) return;
  holding = true;
  const locks = typeof navigator !== "undefined" ? navigator.locks : void 0;
  if (locks?.request) {
    void locks.request(lockName(SESSION), () => new Promise(() => void 0)).catch((e) => {
      reportPendingWordsFailure("hold_session", e);
      if (owner) beatWhileAlive();
      else holding = false;
    });
    return;
  }
  beatWhileAlive();
}
function beatWhileAlive() {
  const beat = () => onStorage((store) => store.setItem(`${BEAT_PREFIX}${SESSION}`, String(Date.now())), void 0);
  beat();
  beatTimer = setInterval(beat, BEAT_MS);
  beatTimer.unref?.();
}
function stopBeating() {
  if (beatTimer === null) return;
  clearInterval(beatTimer);
  beatTimer = null;
  holding = false;
}
async function sessionAlive(session) {
  if (session === SESSION) return true;
  const locks = typeof navigator !== "undefined" ? navigator.locks : void 0;
  if (locks?.query) {
    const held = await locks.query().then((state) => state.held ?? [], () => null);
    if (held) return held.some((lock) => lock.name === lockName(session));
  }
  const beat = Number(onStorage((store) => store.getItem(`${BEAT_PREFIX}${session}`), null));
  return Number.isFinite(beat) && beat > 0 && Date.now() - beat < BEAT_DEAD_MS;
}
function rememberPendingWords(chatId, eventKey, text, savedTo = chatId) {
  const key = keyOf(chatId);
  const body = text.trim();
  if (!key || !body) return false;
  holdSession();
  const list = read(key);
  if (!list) return false;
  if (list.some((p) => p.eventKey === eventKey)) return true;
  return write(key, [...list, { eventKey, text: body, session: SESSION, at: Date.now(), chatId: savedTo }].slice(-PER_CHAT_CAP));
}
function forgetPendingWords(chatId, eventKeys) {
  const key = keyOf(chatId);
  const gone = new Set(eventKeys.filter((k) => !!k));
  if (!key || gone.size === 0) return;
  const list = read(key);
  if (!list) return;
  const rest = list.filter((p) => !gone.has(p.eventKey));
  if (rest.length !== list.length) write(key, rest);
}
function markPendingWordsRead(chatId, eventKeys) {
  const key = keyOf(chatId);
  const drained = new Set(eventKeys.filter((k) => !!k));
  if (!key || drained.size === 0) return;
  const list = read(key);
  if (!list || !list.some((p) => drained.has(p.eventKey) && !p.read)) return;
  write(key, list.map((p) => drained.has(p.eventKey) ? { ...p, read: true } : p));
}
function clearPendingWords() {
  stopBeating();
  onStorage((store) => {
    for (const key of [...keysStarting(PREFIX), ...keysStarting(BEAT_PREFIX)]) store.removeItem(key);
  }, void 0);
  owner = null;
}
function permanentRefusal(e) {
  const status = e?.status;
  return typeof status === "number" && status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429;
}
async function replayOne(chatId, key, persistence) {
  const end = Date.now() + REPLAY_BUDGET_MS;
  let saved = 0;
  const dead = [];
  for (const word of read(key) ?? []) {
    if (word.session === SESSION || Date.now() - word.at < START_GRACE_MS) continue;
    if (await sessionAlive(word.session)) continue;
    dead.push(word);
  }
  for (const word of dead) {
    const left = end - Date.now();
    if (left <= 0) break;
    try {
      const row = { role: "user", content: word.text, ...word.read ? { metadata: steerMetadata({}) } : {}, eventKey: word.eventKey };
      await bounded(Math.min(SAVE_MS, left), persistence.sendMessages(word.chatId ?? chatId, [row]));
      forgetPendingWords(chatId, [word.eventKey]);
      saved += 1;
    } catch (e) {
      if (permanentRefusal(e)) forgetPendingWords(chatId, [word.eventKey]);
    }
  }
  return saved;
}
var replaying = /* @__PURE__ */ new Map();
function replayPendingWords(chatId, persistence) {
  const key = keyOf(chatId);
  if (!key) return Promise.resolve(0);
  const running = replaying.get(key);
  if (running) return running;
  const replay = replayOne(chatId, key, persistence).catch((e) => {
    reportPendingWordsFailure("replay", e);
    return 0;
  }).finally(() => replaying.delete(key));
  replaying.set(key, replay);
  return replay;
}
async function replayAllPendingWords(persistence) {
  if (!owner) return 0;
  const prefix = `${PREFIX}${owner}:`;
  let saved = 0;
  for (const key of keysStarting(prefix)) {
    const chatId = Number(key.slice(prefix.length));
    if (Number.isInteger(chatId)) saved += await replayPendingWords(chatId, persistence);
  }
  return saved;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  clearPendingWords,
  forgetPendingWords,
  markPendingWordsRead,
  registerPendingWordsReplay,
  rememberPendingWords,
  replayAllPendingWords,
  replayPendingWords,
  setPendingWordsOwner
});
//# sourceMappingURL=pendingWords.cjs.map