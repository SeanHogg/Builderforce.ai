#!/usr/bin/env node
/**
 * One-shot reconciliation of three frozen parity snapshots' `host.toolCalls` with the intended change to how a run reads its
 * chat's tickets, from 47642b1d5 ("fix(agent-run): hold a run's end while its linked tickets are open…") plus the per-run
 * listing memo that followed it (`listChatTickets` in brain-embedded/src/runStore/chatTickets.ts). The snapshots cannot be
 * regenerated from the agent (a snapshot made from the agent proves nothing about the agent), so — as the chat-link and
 * epic-parent reconciliations did before it — the intended change is applied to the stored records directly. Only the host's
 * call log changes; every other part of these records already matches.
 *
 *  1. The ticket-list backstops are GATED ON THE LISTING TOOL (`canListChatTickets(req.tools)`) and act only on run-owned
 *     tickets. `hand-off-execution`'s host advertises no `builtin_chats_list_tickets`, so the settle's in_progress advance no
 *     longer calls it: its trailing listing is dropped.
 *  2. The PARENT-EPIC LOOKUP lists once before a mint (`soleOpenLinkedEpic`). In `ship-gate` and `child-report-ship-gate` the
 *     host does advertise the listing, so the run's first-edit mint is preceded by one `builtin_chats_list_tickets`.
 *  3. The listing is MEMOISED PER SETTLE for READ-ONLY questions, and every MOVE reads it fresh: the open-work hold lists once
 *     at the run's end (model turns since the first-edit lookup), and the settle's parent-epic lookup reuses that listing
 *     (only notes in between). The settle mint is an attempted write, and the in_progress advance is a move, so the stored
 *     trailing listing — the advance's — stays where it was. The stored [push, from_delta, list] tail becomes
 *     [push, list, from_delta, list]: the hold's listing is added before the settle mint.
 *
 * Each rewrite is gated on the record's call names being exactly the old shape, so a second run changes nothing.
 *
 * Delete this script after it has run: a reconciliation is applied once, then it is history.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'run', 'parity', 'snapshots');
const LIST = 'builtin_chats_list_tickets';
const names = (calls) => calls.map((c) => c?.name).join(',');

/**
 * ship-gate / child-report-ship-gate: [edit, delta, commit, push, delta, list(advance)] →
 * [edit, list(parent-epic lookup), delta, commit, push, list(hold), delta, list(advance)].
 */
const SHIP_OLD = ['edit_file', 'builtin_tickets_from_delta', 'git_commit', 'git_push', 'builtin_tickets_from_delta', LIST].join(',');
function shipGate(calls) {
  if (names(calls) !== SHIP_OLD) return null;
  const [edit, openDelta, commit, push, settleDelta, advance] = calls;
  const listing = () => ({ name: LIST, args: { ...advance.args } });
  return [edit, listing(), openDelta, commit, push, listing(), settleDelta, advance];
}

/** hand-off-execution: the trailing listing (the ungated in_progress advance) is dropped. */
const HAND_OFF_OLD = [
  ...Array(12).fill('read_file'), 'builtin_tasks_create', 'builtin_tasks_create', 'spawn_agents', 'edit_file', 'builtin_tickets_from_delta', LIST,
].join(',');
function handOffExecution(calls) {
  if (names(calls) !== HAND_OFF_OLD) return null;
  return calls.slice(0, -1);
}

const RECONCILE = { 'ship-gate': shipGate, 'child-report-ship-gate': shipGate, 'hand-off-execution': handOffExecution };

let patched = 0;
for (const [id, rewrite] of Object.entries(RECONCILE)) {
  const path = join(DIR, `${id}.json`);
  const before = readFileSync(path, 'utf8');
  const record = JSON.parse(before);
  const next = rewrite(record.host?.toolCalls ?? []);
  if (!next) continue;
  record.host.toolCalls = next;
  const after = JSON.stringify(record, null, 1) + '\n';
  if (after !== before) {
    writeFileSync(path, after);
    patched += 1;
    console.log(`patched ${id}.json`);
  }
}
console.log(`${patched}/${Object.keys(RECONCILE).length} snapshot(s) reconciled with the gated, memoised ticket listing`);
