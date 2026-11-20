import {
  CONTINUATION_TIMED_OUT
} from "./chunk-SFVLTQ7J.mjs";
import {
  errorMessage
} from "./chunk-SLI7C3HD.mjs";
import {
  MID_TURN_META_KEY
} from "./chunk-4M73IFQC.mjs";

// src/runStore/deadline.ts
var continuationLimits = { prepareMs: 15e3, settleMs: 3e4 };
function budget(ms) {
  const end = Date.now() + ms;
  return () => Math.max(1, end - Date.now());
}
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
async function settledWithin(ms, promise) {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve("pending"), ms);
  });
  try {
    return await Promise.race([promise.then(() => "ok", () => "failed"), late]);
  } finally {
    clearTimeout(timer);
  }
}
async function within(ms, work, onLate, onError = () => void 0) {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve("late"), ms);
  });
  const settled = (async () => {
    try {
      await work();
    } catch (e) {
      onError(e);
    }
    return "done";
  })();
  try {
    if (await Promise.race([settled, late]) === "late") onLate();
  } finally {
    clearTimeout(timer);
  }
}

// src/pendingWordsFailure.ts
function reportPendingWordsFailure(stage, error) {
  console.warn(`BuilderForce pending words: ${stage} failed (${errorMessage(error)})`);
}

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

export {
  continuationLimits,
  budget,
  bounded,
  settledWithin,
  within,
  steerMetadata,
  setPendingWordsOwner,
  registerPendingWordsReplay,
  rememberPendingWords,
  forgetPendingWords,
  markPendingWordsRead,
  clearPendingWords,
  replayPendingWords,
  replayAllPendingWords
};
//# sourceMappingURL=chunk-MNSRAAVJ.mjs.map