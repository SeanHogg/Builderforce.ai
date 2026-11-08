#!/usr/bin/env node
/**
 * One-shot reconciliation of the frozen parity snapshots with ONE intended behaviour change:
 * "a created work item is linked to its chat BY the create call" (the host stamps the run's
 * chat onto the server create tool; the server links it). The snapshots cannot be regenerated
 * from the agent (a snapshot made from the agent proves nothing about the agent), so — as
 * `apply-intended-snapshot-change.mjs` did before it — the intended change is applied to the
 * stored records directly. Exactly three things changed:
 *
 *  1. PROMPT. The server create bullet of `chatWorkLinkingDirective` no longer asks the model to
 *     "AND link it with builtin_chats_link_ticket (chatId=N, linkType="created")"; it says the item
 *     "is linked to this chat automatically". The restated-reply nudge says the create tool "links
 *     this chat itself" instead of "linked to this chat". Rewritten in every string of the record.
 *     The new bullet is 33 characters longer, i.e. 8 more estimated tokens in the system prompt, so
 *     in a record that carried the old bullet the context-fold arithmetic moves by exactly that:
 *     `estimatedTokens` +8, a non-zero `trimmedTokens` −8 (the window left after the prompt), and the
 *     "~N tokens — still over its window" notice N+8. A zero `trimmedTokens` (nothing trimmed) stays 0.
 *  2. NO AUTO-LINK STEP. The run no longer fires a separate `builtin_chats_link_ticket` (`auto: true`)
 *     after a create, so those step rows leave `persisted` and `trace`, and the call leaves the host's
 *     `host.toolCalls`. The stored records' normalised ids (`<id:N>`, numbered by first appearance) are
 *     compacted afterwards, because the removed rows' ids no longer appear and every later id moves down.
 *  3. STAMPED CHAT. A `builtin_tasks_create` the run makes now carries `chatId` = the run's server
 *     chat (appended to its args, where `stampRunChat` puts it) — read from the removed link's own
 *     `chatId`, i.e. the chat the old loop linked into.
 *
 * Idempotent only from the ORIGINAL snapshots: the token shift is gated on the old bullet being
 * present, so a second run changes nothing.
 *
 * Delete this script after it has run: a reconciliation is applied once, then it is history.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'run', 'parity', 'snapshots');

const LINK_STEP = / AND link it with builtin_chats_link_ticket \(chatId=\d+, linkType="created"\)\./g;
const LINK_STEP_NEW = '. It is linked to this chat automatically — do not call builtin_chats_link_ticket for an item you just created.';
const NUDGE_OLD = ', linked to this chat)';
const NUDGE_NEW = ' — it links this chat itself)';

const rewriteText = (s) => s.replace(LINK_STEP, LINK_STEP_NEW).split(NUDGE_OLD).join(NUDGE_NEW);

/** Rewrite every string in a JSON value (prompt text appears in wire messages and step results alike). */
const rewriteStrings = (v) => {
  if (typeof v === 'string') return rewriteText(v);
  if (Array.isArray(v)) return v.map(rewriteStrings);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewriteStrings(x)]));
  return v;
};

/** Whether any string in the record still carries the old link-step bullet. */
const hasOldBullet = (v) => {
  if (typeof v === 'string') { const hit = LINK_STEP.test(v); LINK_STEP.lastIndex = 0; return hit; }
  if (Array.isArray(v)) return v.some(hasOldBullet);
  if (v && typeof v === 'object') return Object.values(v).some(hasOldBullet);
  return false;
};

/** The prompt grew by 8 estimated tokens: shift the fold arithmetic that counts it. */
const PROMPT_TOKEN_GROWTH = 8;
const shiftTokens = (v) => {
  if (typeof v === 'string') return v.replace(/~(\d+) tokens — still over/g, (_, n) => `~${Number(n) + PROMPT_TOKEN_GROWTH} tokens — still over`);
  if (Array.isArray(v)) return v.map(shiftTokens);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => {
      if (k === 'estimatedTokens' && typeof x === 'number') return [k, x + PROMPT_TOKEN_GROWTH];
      if (k === 'trimmedTokens' && typeof x === 'number' && x > 0) return [k, x - PROMPT_TOKEN_GROWTH];
      return [k, shiftTokens(x)];
    }));
  }
  return v;
};

const isAutoLink = (step) => step?.label === 'builtin_chats_link_ticket' && step?.args?.auto === true;

/** The host's own call log: drop the link calls, stamping the preceding create with the link's chat. */
const dropHostLinkCalls = (calls) => {
  const out = [];
  for (const call of calls) {
    if (call?.name === 'builtin_chats_link_ticket' && call?.args?.linkType) {
      const prior = [...out].reverse().find((c) => c?.name === 'builtin_tasks_create');
      if (prior?.args && typeof prior.args === 'object' && prior.args.chatId == null && typeof call.args.chatId === 'number') prior.args.chatId = call.args.chatId;
      continue;
    }
    out.push(call);
  }
  return out;
};

/** Drop the auto-link steps from one ordered list, stamping the preceding create with the link's chat. */
const dropAutoLinks = (rows, stepOf) => {
  const out = [];
  for (const row of rows) {
    const step = stepOf(row);
    if (isAutoLink(step)) {
      const prior = [...out].reverse().find((r) => stepOf(r)?.label === 'builtin_tasks_create');
      const args = prior ? stepOf(prior).args : undefined;
      if (args && typeof args === 'object' && args.chatId == null && typeof step.args.chatId === 'number') args.chatId = step.args.chatId;
      continue;
    }
    out.push(row);
  }
  return out;
};

/** Renumber `<id:N>` placeholders to a gapless sequence, preserving their order. */
const compactIds = (text) => {
  const seen = [...new Set([...text.matchAll(/<id:(\d+)>/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  if (seen.length === 0) return text;
  const base = seen[0];
  const map = new Map(seen.map((n, i) => [n, base + i]));
  return text.replace(/<id:(\d+)>/g, (_, n) => `<id:${map.get(Number(n))}>`);
};

const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
let patched = 0;
for (const f of files) {
  const path = join(DIR, f);
  const before = readFileSync(path, 'utf8');
  const original = JSON.parse(before);
  // Tested on the parsed strings: in the raw file the bullet's quotes are JSON-escaped.
  const hadOldBullet = JSON.stringify(rewriteStrings(original)) !== JSON.stringify(original) && hasOldBullet(original);
  let record = rewriteStrings(hadOldBullet ? shiftTokens(original) : original);
  const hadLinks = JSON.stringify(record).includes('"label":"builtin_chats_link_ticket"');
  if (hadLinks) {
    record.persisted = dropAutoLinks(record.persisted ?? [], (r) => r?.metadata);
    for (const key of Object.keys(record.trace ?? {})) record.trace[key] = dropAutoLinks(record.trace[key] ?? [], (e) => e);
    if (Array.isArray(record.host?.toolCalls)) record.host.toolCalls = dropHostLinkCalls(record.host.toolCalls);
  }
  let after = JSON.stringify(record, null, 1) + '\n';
  if (hadLinks) after = compactIds(after);
  if (after !== before) {
    writeFileSync(path, after);
    patched += 1;
    console.log(`patched ${f}`);
  }
}
console.log(`${patched}/${files.length} snapshot(s) reconciled with the intended change`);
