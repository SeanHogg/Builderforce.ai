#!/usr/bin/env node
/**
 * One-shot reconciliation of the frozen parity snapshots with two intended behaviour changes that
 * landed after the old loop was deleted (the snapshots cannot be regenerated from the agent — a
 * snapshot made from the agent proves nothing about the agent, so the intended change is applied
 * to the stored record directly):
 *
 *  1. PR #6421 (`269bdbe8d`): the `ask_user` tool gained an optional `recommended` flag on each
 *     option and its description now ends with the sentence telling the model to mark the
 *     advised default. The wire's tool list carries that spec, so every snapshot's copy is
 *     updated: the description sentence appended and `recommended` added to
 *     `options.items.properties`.
 *  2. `67f461953` ("fIXES"): the turn recorder now stamps `answeredInProse: true` on a turn that
 *     was handed tools but answered in prose. The same turn is recorded in the snapshots'
 *     `persisted[].metadata.args` and `trace.*[].args`; the key is added exactly where the
 *     recorder's spread places it (after `catalogTools`, before `narratedUnadvertised`).
 *
 * Delete this script after it has run: a reconciliation is applied once, then it is history.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'run', 'parity', 'snapshots');

const DESC_OLD_TAIL = 'answer yourself from the code or context.';
const DESC_NEW_TAIL =
  'answer yourself from the code or context. When one option is the choice you would advise (e.g. the sensible default), mark it with "recommended": true so a default/auto pick can select it.';
const RECOMMENDED_PROP = { type: 'boolean', description: 'Optional: true on the option you would advise as the default pick.' };

const isAskUser = (tool) => tool?.function?.name === 'ask_user';

const patchTool = (tool) => {
  const fn = tool.function;
  let changed = false;
  if (typeof fn.description === 'string' && fn.description.endsWith(DESC_OLD_TAIL)) {
    fn.description = fn.description.slice(0, fn.description.length - DESC_OLD_TAIL.length) + DESC_NEW_TAIL;
    changed = true;
  }
  const props = fn.parameters?.properties?.options?.items?.properties;
  if (props && !('recommended' in props)) {
    // Insert after `description`, mirroring the source object's key order (label, description, recommended).
    const reordered = {};
    for (const [k, v] of Object.entries(props)) {
      reordered[k] = v;
      if (k === 'description') reordered.recommended = RECOMMENDED_PROP;
    }
    fn.parameters.properties.options.items.properties = reordered;
    changed = true;
  }
  return changed;
};

const patchArgsObject = (args) => {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false;
  if ('answeredInProse' in args) return false;
  if (!(args.toolCalls === 0 && args.advertisedTools > 0)) return false;
  // Place the key where the recorder's spread puts it: after catalogTools, before narratedUnadvertised.
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === 'narratedUnadvertised') out.answeredInProse = true;
    out[k] = v;
  }
  if (!('answeredInProse' in out)) out.answeredInProse = true;
  for (const k of Object.keys(args)) delete args[k];
  Object.assign(args, out);
  return true;
};

const patchRecord = (record) => {
  let changed = false;
  for (const call of record.wire ?? []) {
    for (const tool of call.tools ?? []) {
      if (isAskUser(tool)) changed = patchTool(tool) || changed;
    }
  }
  for (const row of record.persisted ?? []) {
    // Turn-record rows are persisted with role "tool" — the predicate inside decides, not the role.
    changed = patchArgsObject(row?.metadata?.args) || changed;
  }
  for (const events of Object.values(record.trace ?? {})) {
    for (const ev of events ?? []) changed = patchArgsObject(ev?.args) || changed;
  }
  return changed;
};

const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
let patched = 0;
for (const f of files) {
  const path = join(DIR, f);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  if (patchRecord(record)) {
    writeFileSync(path, JSON.stringify(record, null, 1) + '\n');
    patched += 1;
    console.log(`patched ${f}`);
  }
}
console.log(`${patched}/${files.length} snapshot(s) reconciled with the intended change`);
