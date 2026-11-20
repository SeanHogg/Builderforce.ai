#!/usr/bin/env node
/**
 * One-shot reconciliation of the frozen parity snapshots with ONE intended prompt change from
 * 47642b1d5 ("fix(agent-run): hold a run's end while its linked tickets are open; open epics never
 * read 100%"): `chatWorkLinkingDirective` (brain-embedded/src/chatWorkLinking.ts) gained one bullet
 * for a LINKED chat — the EPIC-PARENT bullet — telling the model to record a code change for an open
 * linked epic with builtin_tickets_from_delta `parentTaskId` and to file child tasks under it. The
 * snapshots cannot be regenerated from the agent (a snapshot made from the agent proves nothing about
 * the agent), so — as `apply-intended-snapshot-change-chat-link.mjs` did before it — the intended
 * change is applied to the stored records directly. Exactly two things change:
 *
 *  1. PROMPT. In every string of the record, the linked directive's STATUS bullet ("… Never leave a
 *     ticket you are actively working sitting in backlog.") is followed by the new bullet, inserted
 *     immediately before the linked "• Call builtin_chats_list_tickets (chatId=N)" bullet — exactly
 *     where the directive now emits it. Every parity record uses the server ticket vocabulary
 *     (create = builtin_tasks_create, parent key parentTaskId); a record whose prompt shows the local
 *     vocabulary is refused rather than guessed.
 *  2. TOKENS. The bullet (with its leading newline) is 380 characters, i.e. exactly 95 more estimated
 *     tokens per message that received it (ceil(len/4) per message, and 380 is a multiple of 4, so the
 *     shift does not depend on the message's prior length). The shift is tied to the contexts that
 *     actually received the bullet:
 *       - a wire request's `metadata.memory.trimmedTokens` (the window left after the prompt) moves by
 *         −95 × the insertions in THAT request's messages; a zero stays 0 (nothing trimmed), and a value
 *         that would go negative is refused;
 *       - a window-fit pack's `estimatedTokens` and its "~N tokens — still over its window" notice (on a
 *         step row, not a request) move by +95 × the insertions per request — required to be the same
 *         for every request of the record that carries the directive, so the shift is unambiguous.
 *
 * Idempotent: the insertion and the token shift are gated on the status bullet NOT already being
 * followed by the epic-parent bullet, so a second run changes nothing.
 *
 * Usage: node apply-intended-snapshot-change-epic-parent.mjs [snapshot dir] (default: the parity snapshots).
 *
 * Delete this script after it has run: a reconciliation is applied once, then it is history.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'run', 'parity', 'snapshots');

const STATUS_END = 'Never leave a ticket you are actively working sitting in backlog.';
const LIST_BULLET = '\n• Call builtin_chats_list_tickets (chatId=';
const ANCHOR = STATUS_END + LIST_BULLET;
const EPIC_PARENT_BULLET =
  "\n• When an open EPIC is linked to this chat, its remaining work belongs under it: record a code change for it with builtin_tickets_from_delta passing parentTaskId=<the epic's numeric ref> (so a newly minted ticket is filed under the epic), and file a child task with builtin_tasks_create (parentTaskId=<the epic's ref>) for each remaining slice of the epic that has no ticket yet.";
const LOCAL_VOCABULARY = 'It is saved on this device, syncs to the account in the background';

if (EPIC_PARENT_BULLET.length % 4 !== 0) throw new Error(`bullet is ${EPIC_PARENT_BULLET.length} chars: the token shift would depend on prompt length`);
const TOKENS_PER_INSERTION = EPIC_PARENT_BULLET.length / 4;

/** Rewrite every string in a JSON value, counting the insertions made. */
const rewriteStrings = (v, counter) => {
  if (typeof v === 'string') {
    const parts = v.split(ANCHOR);
    counter.n += parts.length - 1;
    return parts.join(STATUS_END + EPIC_PARENT_BULLET + LIST_BULLET);
  }
  if (Array.isArray(v)) return v.map((x) => rewriteStrings(x, counter));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewriteStrings(x, counter)]));
  return v;
};

const anyString = (v, test) => {
  if (typeof v === 'string') return test(v);
  if (Array.isArray(v)) return v.some((x) => anyString(x, test));
  if (v && typeof v === 'object') return Object.values(v).some((x) => anyString(x, test));
  return false;
};

/** Shift a pack's `estimatedTokens` and its still-over notice, anywhere outside the wire requests. */
const shiftPackTokens = (v, by) => {
  if (typeof v === 'string') return v.replace(/~(\d+) tokens — still over/g, (_, n) => `~${Number(n) + by} tokens — still over`);
  if (Array.isArray(v)) return v.map((x) => shiftPackTokens(x, by));
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => (k === 'estimatedTokens' && typeof x === 'number' ? [k, x + by] : [k, shiftPackTokens(x, by)])));
  }
  return v;
};

const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
let patched = 0;
for (const f of files) {
  const path = join(DIR, f);
  const before = readFileSync(path, 'utf8');
  const original = JSON.parse(before);
  // Tested on the parsed strings: in the raw file the prompt's quotes and newlines are JSON-escaped.
  if (!anyString(original, (s) => s.includes(ANCHOR))) continue;
  if (anyString(original, (s) => s.includes(LOCAL_VOCABULARY))) throw new Error(`${f}: local ticket vocabulary — the bullet would name ticket_create/parentTicketId; not handled`);

  const { wire = [], ...rest } = original;
  // Each request: its messages rewritten, and its own trimmedTokens moved by what IT received.
  const perRequest = [];
  const nextWire = wire.map((req, i) => {
    const counter = { n: 0 };
    const messages = req.messages === undefined ? undefined : rewriteStrings(req.messages, counter);
    const others = rewriteStrings(Object.fromEntries(Object.entries(req).filter(([k]) => k !== 'messages')), { n: 0 });
    if (counter.n > 0) perRequest.push(counter.n);
    const out = { ...req, ...others, ...(messages === undefined ? {} : { messages }) };
    const memory = out.metadata?.memory;
    if (memory && typeof memory.trimmedTokens === 'number' && memory.trimmedTokens > 0 && counter.n > 0) {
      const trimmed = memory.trimmedTokens - TOKENS_PER_INSERTION * counter.n;
      if (trimmed < 0) throw new Error(`${f}: wire[${i}] trimmedTokens ${memory.trimmedTokens} would go negative`);
      out.metadata = { ...out.metadata, memory: { ...memory, trimmedTokens: trimmed } };
    }
    return out;
  });
  // Key order of each request is preserved: rebuild it in the original's order.
  const orderedWire = nextWire.map((req, i) => Object.fromEntries(Object.keys(wire[i]).map((k) => [k, req[k]])));

  const distinct = [...new Set(perRequest)];
  if (distinct.length > 1) throw new Error(`${f}: requests received different numbers of bullets (${distinct.join(', ')}): the pack shift is ambiguous`);
  const packShift = distinct.length ? TOKENS_PER_INSERTION * distinct[0] : 0;
  const restRewritten = rewriteStrings(packShift ? shiftPackTokens(rest, packShift) : rest, { n: 0 });

  const record = Object.fromEntries(Object.keys(original).map((k) => [k, k === 'wire' ? orderedWire : restRewritten[k]]));
  const after = JSON.stringify(record, null, 1) + '\n';
  if (after !== before) {
    writeFileSync(path, after);
    patched += 1;
    console.log(`patched ${f}`);
  }
}
console.log(`${patched}/${files.length} snapshot(s) reconciled with the epic-parent bullet (+${TOKENS_PER_INSERTION} prompt tokens per insertion)`);
