#!/usr/bin/env node
/**
 * Shape lint (PRD 20 §0) — a feature may add domain tables. It may not add
 * another instance of an existing shape.
 *
 * Needing comments does not earn a comments table; it earns a row kind. Needing a
 * balance does not earn a balance table; it earns a denomination. Needing an
 * integration does not earn a connections table; it earns a manifest row.
 *
 * Across the three schemas being consolidated, 564 of 1,206 tables are one of 25
 * shapes re-modelled once per feature: 70 event/log/history tables, 59 balance and
 * transaction tables, 58 per-vendor connection tables, 43 membership tables, 33
 * annotation tables. This repo has 65 names matching a kernel shape today, after 31 of the 96 were
 * adjudicated below as genuinely different nouns (2026-08-19).
 *
 * WHAT A FINDING MEANS. Not "this table is wrong" — a matching name is a question,
 * not a verdict. `chat_messages` matching the `message` shape is correct, it IS
 * the message table. What the baseline forces is that each of the 65 has been
 * LOOKED at once, and that the 66th cannot arrive unnoticed. Entries that are
 * legitimate stay in the baseline with a comment; entries that are duplication get
 * migrated and trimmed out.
 *
 * The complement to `check-signature-duplication.mjs`: that one compares columns
 * and is blind to two teams writing the same fact with different column names;
 * this one compares names and is blind to the same shape under a different noun.
 * Neither is sufficient. Together they cover most of it.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDrizzleTables } from './lib/drizzleSchema.mjs';
import { reportRatchet } from './lib/ratchet.mjs';

const here = resolve(fileURLToPath(import.meta.url), '..');
const srcDir = resolve(here, '..', 'src');

/**
 * Kernel shape → the name suffixes that mean "somebody rebuilt it".
 * Keyed by the primitive from PRD 20 §2 so a finding says what to use instead.
 */
const SHAPES = [
  ['activity_log', /_(events|logs|history|audits|audit_events|activity)$/],
  ['annotation',   /_(comments|notes|tags|likes|votes|ratings|reactions)$/],
  ['membership',   /_(members|memberships|participants|attendees|subscribers)$/],
  ['setting',      /_(settings|preferences|prefs|config|configs|options)$/],
  ['revision',     /_(versions|revisions|history_entries|snapshots)$/],
  ['share_link',   /_(shares|share_links|share_tokens|public_links)$/],
  ['invitation',   /_(invites|invitations)$/],
  ['artifact',     /_(attachments|files|documents|assets|media)$/],
  ['message',      /_(messages)$/],
  ['thread',       /_(threads|conversations)$/],
  ['delivery',     /_(deliveries|sends|dispatches|notifications|alerts)$/],
  ['ledger_entry', /_(balances|transactions|credits|payouts|commissions)$/],
  ['connection',   /_(connections|integrations|providers)$/],
  ['run',          /_(runs|executions|attempts|jobs)$/],
];

/** Tables that ARE the kernel primitive rather than a copy of it. Matching by
 *  exact name, so a new `foo_events` cannot hide behind this list. */
const KERNEL_TABLES = new Set([
  'activity_log', 'annotations', 'memberships', 'settings', 'revisions',
  'share_links', 'invitations', 'artifacts', 'messages', 'threads',
  'deliveries', 'ledger_entries', 'connections', 'runs', 'objects',
]);


const tables = parseDrizzleTables(srcDir);
if (tables.size === 0) {
  console.error('❌  Parsed zero tables. The schema moved or the parser broke — failing rather than passing vacuously.');
  process.exit(1);
}

const findings = [];
for (const name of [...tables.keys()].sort()) {
  if (KERNEL_TABLES.has(name)) continue;
  for (const [primitive, re] of SHAPES) {
    if (re.test(name)) {
      findings.push({ key: name, detail: `matches the \`${primitive}\` shape — should this be a row in \`${primitive}\` with a kind, rather than a table?` });
      break; // one shape per table; the first match is the most specific
    }
  }
}

await reportRatchet({
  name: 'check-shape-lint',
  baselinePath: resolve(here, '.shape-lint-baseline.txt'),
  findings,
  unit: 'table name(s) matching a kernel shape',
  header: 'Tables whose name matches a kernel primitive shape (PRD 20 §0). A listed entry has been looked at; it is not necessarily wrong.',
  fixHint:
    'A new table matches a shape the kernel already owns. Use the primitive with a kind\n' +
    '    column, or say why this one is genuinely a different noun.',
  update: process.argv.includes('--update'),
});
