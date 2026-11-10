#!/usr/bin/env node
/**
 * PRD 45 §7 W0 — chat replay baseline for Brain chats #214 ("A2A") and #216 ("Visualizer").
 *
 * Reads the VSIX local-first journal (READ-ONLY; never writes to it, never touches the
 * production DB), replays the BFJF2 delta chain, isolates the two chats by their CONTENT
 * fingerprint (the "#NNN" display number is not stored in the journal), and prints the
 * §8 success-measure baselines:
 *
 *   - total prompt / completion tokens per chat (usage ledger rows)
 *   - number of code turns and how many had exactly one edit
 *   - median tool calls per turn (per chat, and VSIX-wide over 7 days)
 *   - prompt peak
 *   - readiness claims followed by >= 2 read-only turns
 *
 * A measure the journal cannot supply falls back to the PRD's own narrative value,
 * clearly labelled "(PRD narrative)" — a measured number is never fabricated.
 *
 * Chat identification (validated against PRD 45 §1 fingerprints):
 *   #214 — serverId 55221, 2026-11-08T21:20Z, "I see messages being sent back and forth
 *          between…": the only chat journaled with `local/kimi-code/kimi-for-coding` whose
 *          prompt total lands within 10% of the narrative 3.02M (measured 3,023,666) and
 *          whose transcript names the A2A commits (`4df6b756e` / `41b0ff264`).
 *   #216 — serverId 56654, 2026-11-08T22:47Z, "REview the Visualizer's Map, Graph, Tower,
 *          and 3D…": the only chat whose transcript mentions `Towers.tsx` and the verbatim
 *          §1 narration quote "mid-implementation across the four views".
 *
 * Turn model: one turn = one model step = the rows between two `llm.complete` bookkeeping
 * records (see runStore message metadata `label`s). Every tool call in a step belongs to
 * that step's turn, so coverage is complete and independent of `args.step` tagging.
 *
 * Session window: PRD 45 was written 2026-11-08; chat #216 kept running into 11-09. Each
 * chat's "session window" is its creation date (UTC), and measures are reported for both
 * the session window and the full journaled lifetime.
 *
 * Usage:
 *   node api/scripts/chat-replay-baseline.cjs            # full baseline report (§8 numbers)
 *   node api/scripts/chat-replay-baseline.cjs --probe    # per-chat summary of every chat
 *
 * The journal path defaults to the VSIX globalStorage location; override with
 * BUILDERFORCE_JOURNAL=/path/to/local-first-v3.journal.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const JOURNAL_PATH =
  process.env.BUILDERFORCE_JOURNAL ||
  path.join(
    process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'),
    'Code',
    'User',
    'globalStorage',
    'builderforce.builderforce-ai',
    'local-first-v3.journal',
  );

// PRD 45 §1 narrative values — used ONLY when the journal cannot supply a measured number.
const PRD_NARRATIVE = {
  214: { promptTokens: 3_020_000, completionTokens: 33_600, turns: 69 },
  216: { promptTokens: 2_080_000, completionTokens: 18_000, turns: 31, promptPeak: 93_000, codeTurnsOneEdit: 15 },
};

// ---------------------------------------------------------------------------
// Frame walking: BFJF1/BFJF2 + u32 length + u32 crc32 (big-endian) — the same
// layout as packages/local-first/src/journalCodec.ts. A frame is trusted only when
// its crc matches and its length fits; the walk stops at the first frame that fails
// (a torn tail left by a kill). Pure read: the journal file is opened read-only.
// ---------------------------------------------------------------------------

function makeCrc32() {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    table[n] = c;
  }
  return (bytes) => {
    let crc = -1;
    for (let i = 0; i < bytes.length; i += 1) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ -1) >>> 0;
  };
}
const crc32 = makeCrc32();

const HEADER = 13; // 5 magic + u32 length + u32 crc

/** Yield { kind, body(Buffer) } for every frame that validates. Stops at the first bad frame. */
function* walkFrames(buf) {
  let offset = 0;
  while (offset + HEADER <= buf.length) {
    const magic = buf.toString('latin1', offset, offset + 5);
    if (magic !== 'BFJF1' && magic !== 'BFJF2') return;
    const length = buf.readUInt32BE(offset + 5);
    const expected = buf.readUInt32BE(offset + 9);
    const start = offset + HEADER;
    const end = start + length;
    if (end > buf.length) return; // torn tail
    const body = buf.subarray(start, end);
    if (crc32(body) !== expected) return;
    yield { kind: magic === 'BFJF1' ? 'snapshot' : 'delta', body };
    offset = end;
  }
}

/**
 * Replay the journal into ` Map<`${entityType}:${id}`, record> `, keeping only the
 * entity types the caller wants. Deltas apply in order: deletions first, then upserts;
 * a `reset` frame clears the map (journalCompaction base chain). The file is opened
 * read-only and never written.
 */
function replayJournal(journalPath, want) {
  const fd = fs.openSync(journalPath, 'r');
  const bytes = fs.fstatSync(fd).size;
  const buf = Buffer.allocUnsafe(bytes);
  let read = 0;
  while (read < bytes) read += fs.readSync(fd, buf, read, bytes - read, read);
  fs.closeSync(fd);

  const records = new Map();
  let frames = 0;
  let parsed = 0;
  for (const frame of walkFrames(buf)) {
    frames += 1;
    let delta;
    try {
      delta = JSON.parse(frame.body.toString('utf8'));
    } catch {
      continue; // a crc-valid frame we cannot parse: skip, do not trust
    }
    if (delta.reset) records.clear();
    for (const rec of delta.records || []) {
      if (!rec || typeof rec.entityType !== 'string' || typeof rec.id !== 'string') continue;
      if (want && !want(rec)) continue;
      records.set(`${rec.entityType}:${rec.id}`, rec);
    }
    for (const del of delta.deletedRecords || []) {
      if (!del || typeof del.entityType !== 'string' || typeof del.id !== 'string') continue;
      records.delete(`${del.entityType}:${del.id}`);
    }
    parsed += 1;
  }
  return { records, frames, parsed, bytes: buf.length };
}

// ---------------------------------------------------------------------------
// Record helpers
// ---------------------------------------------------------------------------

function serverChatIdOf(record) {
  const p = record.payload || {};
  const candidates = [p.chatId, p.serverChatId, p.serverId, p.chat && (p.chat.id ?? p.chat.serverId ?? p.chat.chatId)];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return undefined;
}

function chatTitleOf(record) {
  const p = record.payload || {};
  return String(p.title ?? (p.chat && (p.chat.title ?? p.chat.name)) ?? '');
}

function chatCreatedOf(record) {
  const p = record.payload || {};
  return String((p.chat && p.chat.createdAt) || record.occurredAt || '');
}

/** Parse a message row's metadata JSON (best effort). */
function metaOf(rec) {
  const raw = rec.payload?.message?.metadata;
  if (raw && typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return typeof raw === 'object' && raw ? raw : undefined;
}

function median(values) {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const fmt = (n) => Number(n).toLocaleString('en-US');

/** UTC date prefix of an ISO timestamp ("2026-11-08T…" -> "2026-11-08"). */
function dayOf(iso) {
  return String(iso || '').slice(0, 10);
}

// ---------------------------------------------------------------------------
// Chat identification. The "#NNN" Brain display number is not stored in the journal,
// so the two PRD-45 chats are identified by their §1 content fingerprints.
// ---------------------------------------------------------------------------

function collectChats(store) {
  const chats = new Map(); // clientChatId -> { record, usage: [], messages: [], text }
  for (const rec of store.records.values()) {
    if (rec.entityType === 'chat') {
      chats.set(rec.id, { record: rec, usage: [], messages: [], text: '' });
    }
  }
  for (const rec of store.records.values()) {
    const p = rec.payload || {};
    if (rec.entityType === 'usage') chats.get(p.clientChatId)?.usage.push(rec);
    else if (rec.entityType === 'message') {
      const c = chats.get(p.chatClientId);
      if (c) {
        c.messages.push(rec);
        const content = p.message?.content;
        if (typeof content === 'string' && content.length < 200_000) c.text += content.slice(0, 200_000);
      }
    }
  }
  const byServer = new Map();
  for (const [clientId, c] of chats) byServer.set(serverChatIdOf(c.record), { clientId, ...c });
  return byServer;
}

function identifyChats(byServer) {
  // #216: the Visualizer chat — Towers.tsx rewrite + the verbatim §1 narration quote.
  let chat216;
  for (const [serverId, c] of byServer) {
    if (c.text.includes('Towers.tsx') && c.text.includes('mid-implementation across the four views')) {
      chat216 = { serverId, ...c };
      break;
    }
  }
  // #214: the A2A chat — kimi-for-coding only, prompt total within 10% of 3.02M,
  // transcript names the pushed commits.
  let chat214;
  for (const [serverId, c] of byServer) {
    const prompt = c.usage.reduce((s, r) => s + (r.payload?.promptTokens || 0), 0);
    const kimiOnly = c.usage.every((r) => String(r.payload?.model || '').includes('kimi'));
    const namesCommits = c.text.includes('4df6b756e') || c.text.includes('41b0ff264');
    if (kimiOnly && Math.abs(prompt - PRD_NARRATIVE[214].promptTokens) / PRD_NARRATIVE[214].promptTokens < 0.1 && namesCommits) {
      chat214 = { serverId, ...c };
      break;
    }
  }
  return { chat214, chat216 };
}

// ---------------------------------------------------------------------------
// §8 measures
// ---------------------------------------------------------------------------

/**
 * A persisted step is a TOOL CALL only when its step metadata says `category: 'tool'`
 * (`persistStep` stores every trace event as a `role:'tool'` row, so the role says nothing).
 * Classifying by label counted bookkeeping — `agent.message`, `steer.applied`, `run.budget_*`,
 * `llm.role_handoff`, `model.preflight`, `loop.*` — as tool calls (PRD 46 F9).
 */
function isToolCallStep(meta) {
  return meta.category === 'tool';
}

/** The model's own visible text for a turn: an assistant row, or the `agent.message` step. */
function isTurnText(role, meta, label) {
  if (role === 'assistant') return label === 'agent.message' || !label;
  return meta.category === 'message' && label === 'agent.message';
}

const WRITE_TOOLS = /^(edit_file|write_file|delete_file|apply_patch|apply_diff)$/;

/**
 * Split a chat's message rows into turns at `llm.complete` markers (one model call per
 * turn) and classify each turn. Returns per-turn tool-call counts and edit stats.
 */
function turnStats(messages) {
  const sorted = [...messages].sort((a, b) => (a.payload?.message?.seq ?? 0) - (b.payload?.message?.seq ?? 0));
  const turns = [];
  let current = { texts: [], toolCalls: [] };
  let sawRow = false;
  const flush = () => {
    if (sawRow) turns.push(current);
    current = { texts: [], toolCalls: [] };
    sawRow = false;
  };
  for (const rec of sorted) {
    const m = rec.payload?.message || {};
    const meta = metaOf(rec) || {};
    const label = String(meta.label ?? '');
    sawRow = true;
    if (m.role === 'tool' && label === 'llm.complete') {
      flush(); // end of one model step; the next rows belong to the next turn
      continue;
    }
    if (isTurnText(m.role, meta, label)) {
      // A step row's content is empty; its text rides the step metadata's `result`.
      current.texts.push(String(m.content || (typeof meta.result === 'string' ? meta.result : '')));
    } else if (m.role === 'tool' && label && isToolCallStep(meta)) {
      current.toolCalls.push(label);
    }
    // user rows and bookkeeping rows attach to the current turn but carry no signal here
  }
  flush();

  const activeTurns = turns.filter((t) => t.toolCalls.length > 0);
  const editTurns = activeTurns.filter((t) => t.toolCalls.some((c) => WRITE_TOOLS.test(c)));
  const singleEditTurns = editTurns.filter(
    (t) => t.toolCalls.length === 1 && WRITE_TOOLS.test(t.toolCalls[0]),
  );
  const readOnlyTurns = activeTurns.filter(
    (t) => !t.toolCalls.some((c) => WRITE_TOOLS.test(c)),
  );
  return {
    turns: turns.length,
    activeTurns: activeTurns.length,
    editTurns: editTurns.length,
    singleEditTurns: singleEditTurns.length,
    readOnlyTurns: readOnlyTurns.length,
    medianToolCalls: median(activeTurns.map((t) => t.toolCalls.length)),
    turnList: turns,
  };
}

// ---------------------------------------------------------------------------
// Readiness claims — a COPY of `claimsReady` from packages/run-guards/src/readinessClaim.ts
// (READY_PATTERNS, NEGATION, ownWords, sentenceClaims), because this CommonJS script runs
// with plain `node` and run-guards ships TypeScript source only (no built dist to require,
// and neither tsx nor jiti is an api devDependency). The copy is PINNED by
// api/src/scripts/chatReplayBaseline.parity.test.ts: every pattern must equal the guard's
// source pattern and the two `claimsReady` must agree on a fixture set, so the baseline
// counts exactly what the guard counts.
// ---------------------------------------------------------------------------

const READY_PATTERNS = [
  // "Now I have everything I need", "I've got all the context", "we now have enough"
  /\b(?:i|we)(?:'ve| have)?\s+(?:now\s+)?(?:have|got)\s+(?:got\s+)?(?:everything|all\s+(?:the\s+)?(?:context|information|info|details|i\s+need|we\s+need)|enough)\b/,
  // "I've got all the component contracts", "we have all of the pieces" (run #70776)
  /\b(?:i|we)(?:'ve| have)?\s+(?:now\s+)?(?:have|got)\s+all\s+(?:of\s+)?(?:the\s+)?(?:[\w/-]+\s+){0,3}(?:contracts|pieces|interfaces|signatures)\b/,
  // "Now I have the full picture", "I have a complete understanding", "I have a thorough map" (run #70776)
  /\b(?:now\s+)?(?:i|we)(?:'ve|\s+have)?\s+(?:now\s+)?(?:have\s+|got\s+)?(?:a|the)\s+(?:clear|complete|full|good|solid|whole|thorough)\s+(?:picture|understanding|view|overview|grasp|map)\b/,
  // "Analysis is over; time to build." (run #70776)
  /\b(?:analysis|investigation|exploration|research)\s+(?:is|'s)\s+(?:over|done|complete|finished)\b/,
  // "Now I understand the camera registry pattern" (run #70776) — never "I don't understand"
  /\b(?:now\s+(?:i|we)|(?:i|we)\s+now)\s+(?:fully\s+|clearly\s+)?understand\b/,
  // "Implementing now", "now implementing" (run #70776)
  /^\s*(?:(?:implementing|building|coding)(?:\s+(?:it|this|that))?\s+now|now\s+(?:implementing|building|coding))\b/,
  // "one final check, then I write", "one more file before I implement"
  /\bone\s+(?:last|final|more)\s+(?:check|look|read|thing|file)\b[^.!?\n]*\b(?:then|before)\b[^.!?\n]*\b(?:write|implement|edit|make|apply|update|change|fix|code)\b/,
  // "now I'll write", "let me now implement", "time to make the change" — never "make sure"
  /\b(?:now\s+(?:i'll|i\s+will|let\s+me|let's)|(?:i'll|i\s+will|let\s+me|let's)\s+now|time\s+to)\s+(?:write|implement|build|code|make(?!\s+(?:sure|certain))|apply|edit|update(?!\s+(?:my|our)\s+(?:understanding|notes|picture))|create|fix|start\s+(?:writing|implementing|coding|the\s+(?:edit|change|implementation)))\b/,
  /\blet\s+me\s+(?:write|make|apply)\s+the\s+(?:update|change|changes|edit|edits|fix|implementation)\s+now\b/,
];

/** Words before a claim that deny it or make it conditional ("I don't have…", "once I have…",
 *  "once the analysis is done…", "it's not time to build"). */
const NEGATION = /\b(?:don't|do\s+not|doesn't|haven't|have\s+not|isn't|is\s+not|not\s+yet|not\s+(?:time|ready)|still\s+need|need\s+(?:more|to\s+(?:read|check|look|see|find|understand))|before\s+(?:i|we)\s+have|until\s+(?:i|we)\s+have|once|unless|when\s+(?:i|we)\s+have|if\s+(?:i|we)\s+(?:have|had)|(?:if|when|after|until|before)\s+(?:the|my|our)\s+(?:\w+\s+){1,2}(?:is|are|'s))\b/;

/** Code fences, inline code, block quotes and quoted strings are someone else's words. */
function ownWords(text) {
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/^\s*>.*$/gm, " ")
    .replace(/"[^"\n]*"|“[^”\n]*”/g, " ")
    .replace(/[’‘]/g, "'");
}

/** One sentence's claim: a match whose own lead-in denies nothing. A question claims nothing. */
function sentenceClaims(sentence) {
  if (sentence.trimEnd().endsWith("?")) return false;
  return READY_PATTERNS.some((p) => {
    const m = p.exec(sentence);
    // Only the words up to the claim can deny it: "…everything I need — the parser
    // doesn't handle X" still claims.
    return !!m && !NEGATION.test(sentence.slice(0, m.index + m[0].length));
  });
}

/** Does `text` — the model's own turn — claim the run is ready to act? */
function claimsReady(text) {
  if (!text) return false;
  return ownWords(text).toLowerCase().split(/(?<=[.!?])\s+|\n+/).some(sentenceClaims);
}

/**
 * Readiness episodes: an assistant text claiming enough context, followed — across
 * subsequent turns and before the next turn containing a write tool — by >= 2 turns
 * whose tool calls are all read-only.
 */
function readinessEpisodes(turnList) {
  let claims = 0;
  let episodes = 0;
  let claimed = false;
  let pendingReadOnlyTurns = 0;
  const finishClaim = () => {
    if (claimed && pendingReadOnlyTurns >= 2) episodes += 1;
    claimed = false;
    pendingReadOnlyTurns = 0;
  };
  for (const turn of turnList) {
    const text = turn.texts.join('\n');
    const isClaim = turn.texts.length > 0 && claimsReady(text);
    if (isClaim) {
      finishClaim(); // a new claim supersedes an unanswered one
      claims += 1;
      claimed = true;
      pendingReadOnlyTurns = 0;
      continue;
    }
    if (!claimed) continue;
    if (turn.toolCalls.length === 0) continue; // narration-only turn: neither read nor write
    if (turn.toolCalls.some((c) => WRITE_TOOLS.test(c))) {
      finishClaim(); // a write ends the episode (unsatisfied if < 2 read-only turns)
    } else {
      pendingReadOnlyTurns += 1;
    }
  }
  finishClaim();
  return { claims, episodes };
}

function usageStats(usage, cutIso) {
  const rows = cutIso ? usage.filter((r) => String(r.payload?.at || '') < cutIso) : usage;
  const promptTokens = rows.reduce((s, r) => s + (r.payload?.promptTokens || 0), 0);
  const completionTokens = rows.reduce((s, r) => s + (r.payload?.completionTokens || 0), 0);
  const peak = rows.reduce((m, r) => Math.max(m, r.payload?.promptTokens || 0), 0);
  const byRole = {};
  for (const r of rows) {
    const role = String(r.payload?.role ?? '(none)');
    byRole[role] = byRole[role] || { calls: 0, prompt: 0, completion: 0 };
    byRole[role].calls += 1;
    byRole[role].prompt += r.payload?.promptTokens || 0;
    byRole[role].completion += r.payload?.completionTokens || 0;
  }
  return { rows: rows.length, promptTokens, completionTokens, peak, byRole };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function labeled(value, narrative, unit) {
  if (value > 0) return `${fmt(value)}${unit} (measured)`;
  return `${fmt(narrative)}${unit} (PRD narrative — journal has no data for this)`;
}

function report() {
  console.log(`# PRD 45 §8 W0 baseline — replayed from the local-first journal`);
  console.log(`# journal: ${JOURNAL_PATH}`);
  console.log(`# measured: ${new Date().toISOString()}\n`);

  const store = replayJournal(
    JOURNAL_PATH,
    (rec) => rec.entityType === 'chat' || rec.entityType === 'usage' || rec.entityType === 'message',
  );
  console.log(`# journal frames: ${store.frames} (parsed ${store.parsed}), ${fmt(store.bytes)} bytes, records kept: ${store.records.size}\n`);

  const byServer = collectChats(store);
  const { chat214, chat216 } = identifyChats(byServer);
  if (!chat214 || !chat216) {
    console.log(`ERROR: could not identify both chats — #214: ${chat214 ? 'found (serverId ' + chat214.serverId + ')' : 'NOT FOUND'}, #216: ${chat216 ? 'found (serverId ' + chat216.serverId + ')' : 'NOT FOUND'}`);
    console.log('Run with --probe to list every chat in the journal and adjust the fingerprints.');
    process.exitCode = 1;
    return;
  }

  const out = [];
  for (const [num, chat] of [[214, chat214], [216, chat216]]) {
    const n = PRD_NARRATIVE[num];
    const created = chatCreatedOf(chat.record);
    const day = dayOf(created);
    // Session window: the chat's creation date (UTC). PRD 45 was written 2026-11-08;
    // chats #214/#216 both ran that evening. The next midnight ends the session window.
    const nextDay = new Date(`${day}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const cut = nextDay.toISOString();

    const usageAll = usageStats(chat.usage);
    const usageSession = usageStats(chat.usage, cut);
    const stats = turnStats(chat.messages);
    const { claims, episodes } = readinessEpisodes(stats.turnList);

    console.log(`## Chat #${num} — ${chatTitleOf(chat.record)}`);
    console.log(`   serverId: ${chat.serverId} · clientId: ${chat.record.id} · created: ${created}`);
    console.log(`   session window: ${day} (cut ${cut}) · usage rows: ${usageAll.rows} journaled (${usageSession.rows} in window)`);
    for (const [role, s] of Object.entries(usageSession.byRole)) {
      console.log(`     window ${role}: ${s.calls} calls · prompt ${fmt(s.prompt)} · completion ${fmt(s.completion)}`);
    }
    console.log(`   prompt tokens — session:  ${labeled(usageSession.promptTokens, n.promptTokens, '')}`);
    console.log(`   prompt tokens — lifetime: ${labeled(usageAll.promptTokens, n.promptTokens, '')}`);
    console.log(`   completion tokens — session:  ${labeled(usageSession.completionTokens, n.completionTokens, '')}`);
    console.log(`   completion tokens — lifetime: ${labeled(usageAll.completionTokens, n.completionTokens, '')}`);
    console.log(`   prompt peak — session:  ${usageSession.peak > 0 ? fmt(usageSession.peak) + ' (max single-call prompt, measured)' : `${fmt(n.promptPeak ?? 0)} (PRD narrative)`}`);
    console.log(`   prompt peak — lifetime: ${usageAll.peak > 0 ? fmt(usageAll.peak) + ' (measured)' : `${fmt(n.promptPeak ?? 0)} (PRD narrative)`}`);
    console.log(`   turns (model steps): ${stats.turns}; with tool calls: ${stats.activeTurns}`);
    console.log(`   code turns (turns with >= 1 edit/write): ${stats.editTurns}; with exactly one edit and nothing else: ${stats.singleEditTurns}`);
    console.log(`   read-only turns (tool calls, no writes): ${stats.readOnlyTurns}`);
    console.log(`   median tool calls per turn: ${stats.medianToolCalls !== undefined ? stats.medianToolCalls + ` (over ${stats.activeTurns} active turns)` : 'n/a'}`);
    console.log(`   readiness claims: ${claims}; followed by >= 2 read-only turns before a write: ${episodes}`);
    console.log('');
    out.push({ num, chat, usageSession, usageAll, stats, claims, episodes, day });
  }

  // VSIX-wide median tool calls per turn over the 7 days before the journal's newest row.
  let newest = '';
  for (const rec of store.records.values()) {
    if (rec.entityType === 'message') {
      const at = rec.payload?.message?.createdAt || rec.occurredAt;
      if (String(at) > newest) newest = String(at);
    }
  }
  const newestDay = new Date(`${dayOf(newest)}T00:00:00Z`);
  newestDay.setUTCDate(newestDay.getUTCDate() - 6); // 7-day window inclusive of newest day
  const windowCut = newestDay.toISOString().slice(0, 10);
  const allToolCounts = [];
  for (const [, chat] of byServer) {
    const inWindow = chat.messages.filter((r) => String(r.payload?.message?.createdAt || r.occurredAt || '').slice(0, 10) >= windowCut);
    const stats = turnStats(inWindow);
    for (const t of stats.turnList) if (t.toolCalls.length > 0) allToolCounts.push(t.toolCalls.length);
  }
  const vsixMedian = median(allToolCounts);
  console.log(`## VSIX-wide median tool calls per turn, 7-day window (${windowCut} .. ${dayOf(newest)}):`);
  console.log(`   ${vsixMedian !== undefined ? vsixMedian + ` (over ${allToolCounts.length} active turns across ${byServer.size} chats)` : 'n/a'}`);
  console.log('');

  console.log('## §8 baseline values (for the PRD table)');
  for (const r of out) {
    const n = PRD_NARRATIVE[r.num];
    const m = (v, narr) => (v > 0 ? `${fmt(v)} (measured)` : `${fmt(narr)} (PRD narrative)`);
    console.log(`#${r.num}: prompt-session=${m(r.usageSession.promptTokens, n.promptTokens)}; prompt-lifetime=${m(r.usageAll.promptTokens, n.promptTokens)}; completion-session=${m(r.usageSession.completionTokens, n.completionTokens)}; completion-lifetime=${m(r.usageAll.completionTokens, n.completionTokens)}; prompt-peak-session=${m(r.usageSession.peak, n.promptPeak ?? 0)}; prompt-peak-lifetime=${m(r.usageAll.peak, n.promptPeak ?? 0)}; model-turns=${r.stats.turns}; edit-turns=${r.stats.editTurns}; single-edit-turns=${r.stats.singleEditTurns}; median-tool-calls=${r.stats.medianToolCalls ?? 'n/a'}; readiness-claims=${r.claims}; readiness->2-readonly=${r.episodes}`);
  }
  console.log(`median-tool-calls-7d=${vsixMedian !== undefined ? vsixMedian + ` (over ${allToolCounts.length} turns)` : 'n/a'}`);
  console.log('\n# harness: api/scripts/chat-replay-baseline.cjs — replayed read-only against the local-first journal (no production DB).');
}

// ---------------------------------------------------------------------------
// Probe mode: per-chat summary so a human can check the fingerprints.
// ---------------------------------------------------------------------------

function probe() {
  console.log(`journal: ${JOURNAL_PATH}`);
  const scan = replayJournal(
    JOURNAL_PATH,
    (rec) => rec.entityType === 'chat' || rec.entityType === 'usage' || rec.entityType === 'message',
  );
  console.log(`frames: ${scan.frames} parsed: ${scan.parsed} bytes: ${scan.bytes} records kept: ${scan.records.size}`);
  const chats = new Map();
  for (const rec of scan.records.values()) {
    if (rec.entityType === 'chat') chats.set(rec.id, { record: rec, usage: [], messages: [] });
  }
  for (const rec of scan.records.values()) {
    const p = rec.payload || {};
    if (rec.entityType === 'usage') chats.get(p.clientChatId)?.usage.push(rec);
    else if (rec.entityType === 'message') chats.get(p.chatClientId)?.messages.push(rec);
  }
  const rows = [];
  for (const [clientId, c] of chats) {
    const prompt = c.usage.reduce((s, r) => s + (r.payload?.promptTokens || 0), 0);
    const completion = c.usage.reduce((s, r) => s + (r.payload?.completionTokens || 0), 0);
    const peak = c.usage.reduce((m, r) => Math.max(m, r.payload?.promptTokens || 0), 0);
    const models = [...new Set(c.usage.map((r) => String(r.payload?.model)))].join('|');
    const user = c.messages.filter((m) => m.payload?.message?.role === 'user').length;
    rows.push({ serverId: serverChatIdOf(c.record), created: chatCreatedOf(c.record), title: chatTitleOf(c.record), usageRows: c.usage.length, prompt, completion, peak, models, user });
  }
  rows.sort((a, b) => String(a.created).localeCompare(String(b.created)));
  for (const r of rows) {
    console.log(`serverId=${r.serverId} created=${r.created} userTurns=${r.user} title=${JSON.stringify(r.title)}`);
    console.log(`   usageRows=${r.usageRows} prompt=${fmt(r.prompt)} completion=${fmt(r.completion)} peak=${fmt(r.peak)} models=${r.models || '-'}`);
  }
}

module.exports = { READY_PATTERNS, NEGATION, claimsReady };

if (require.main === module) {
  if (process.argv.includes('--probe')) probe();
  else report();
}
