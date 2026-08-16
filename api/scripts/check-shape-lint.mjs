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
 * annotation tables. This repo has 54 names matching a kernel shape today.
 *
 * WHAT A FINDING MEANS. Not "this table is wrong" — a matching name is a question,
 * not a verdict. `chat_messages` matching the `message` shape is correct, it IS
 * the message table. What the baseline forces is that each of the 54 has been
 * LOOKED at once, and that the 55th cannot arrive unnoticed. Entries that are
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

/**
 * Names that match a shape but are a genuinely different noun — the second branch
 * of this guard's own fix hint, taken.
 *
 * These live here rather than in the baseline on purpose. A baseline entry says
 * "somebody looked at this once"; it carries no reason, and `--update` rewrites
 * the file and drops any comment explaining it. An adjudication is a decision
 * with an argument attached, and it survives a regeneration. The baseline is for
 * work still to do; this is for work that was done and came out the other way.
 */
const ADJUDICATED = new Map([
  [
    'agent_definition_versions',
    'an executable identity boundary, not an edit-history entry. Releases, runs and ' +
      'rehearsals hold restrictive foreign keys to its content-addressed UUID; the generic ' +
      '`revisions` primitive has a bigint history id, requires an objects-registry owner, ' +
      'and stores patches or external snapshot keys rather than the executable definition. ' +
      'Substituting it would weaken exact-definition pinning and release rollback.',
  ],
  [
    'placement_documents',
    'the DOCUMENT is an `artifacts` row; this is the obligation to hold one — a ' +
      'compliance requirement with a status, an expiry and a verifier. Deleting the ' +
      'file must not delete the requirement, which is the test that they are two nouns.',
  ],
  [
    'lrs_documents',
    'xAPI Learning Record Store state, addressed exactly as the specification ' +
      'addresses it — (scope, activityId, agentKey, registration, documentId). It is a ' +
      'key/value store an external standard defines the shape of, not a made object with ' +
      'a kind; an `artifacts` row could not be looked up the way the spec requires.',
  ],
  [
    'due_diligence_documents',
    'the same two-nouns test as `placement_documents`: this is the REQUEST for a ' +
      'document, with a reviewer and an accept/reject decision. It exists before any file ' +
      'does, which an `artifacts` row cannot.',
  ],
  [
    'scratch_pad_attachments',
    'not the file — the file is an `artifacts` row. This is its PLACEMENT on a canvas ' +
      'board: a coordinate, a label and who pinned it. The same artifact can be pinned to ' +
      'two pads at two positions, which is an edge, not a property of the artifact.',
  ],
  [
    'stock_media_assets',
    'an `artifacts` row is something the tenant MADE and owns. This is something a ' +
      'provider LICENSED, and the terms — attribution, territory, expiry, per-seat caps — ' +
      'are the reason the row exists. Using one copies it into `artifacts`.',
  ],
  [
    'web_search_documents',
    'a mutable search-index record for externally crawled content, not a tenant-made ' +
      'artifact. Its identity is a canonical URL and content hash; crawl freshness, HTTP ' +
      'state, duplicate detection and term-frequency rows control recrawling and retrieval. ' +
      'An `artifacts` row instead identifies an owned creation and its stored rendition.',
  ],
  [
    'extension_versions',
    'an installable ARTIFACT, not a step in an edit history. `tenant_extension_installs` ' +
      'holds an ON DELETE RESTRICT foreign key to it, every tenant installs the SAME ' +
      'version, and the row carries the review verdict and the scopes an admin is asked to ' +
      'approve. `revisions` is tenant-scoped, keyed by a bigint history number under one ' +
      "object, and stores a patch or a snapshot key — none of which a stranger's install " +
      'can point at. Same argument as `agent_definition_versions` above, one layer out.',
  ],
  [
    'stage_sandbox_runs',
    "a CONTENT-ADDRESSED cache entry, not a task execution. Its primary access pattern " +
      "is \"find the newest row for (tenant, payload_hash)\" — a re-stage of an unchanged " +
      "build must reuse its prior clean run, and a one-byte edit must invalidate it — which " +
      "needs `payload_hash` as a first-class indexed column, not a value buried inside the " +
      "kernel `runs` primitive's opaque `input` jsonb. `runs`/`executions` are looked up by " +
      "id or by (tenant, kind, status); neither shape has a content-hash access path. The " +
      "kernel `runs` table is also unadopted by any real feature today (migration 0418, " +
      "referenced only by the generic read-only entity browser) — becoming its first write " +
      "consumer inside an already-large change would be validating two unproven things at " +
      "once instead of one.",
  ],
]);

const tables = parseDrizzleTables(srcDir);
if (tables.size === 0) {
  console.error('❌  Parsed zero tables. The schema moved or the parser broke — failing rather than passing vacuously.');
  process.exit(1);
}

const findings = [];
for (const name of [...tables.keys()].sort()) {
  if (KERNEL_TABLES.has(name) || ADJUDICATED.has(name)) continue;
  for (const [primitive, re] of SHAPES) {
    if (re.test(name)) {
      findings.push({ key: name, detail: `matches the \`${primitive}\` shape — should this be a row in \`${primitive}\` with a kind, rather than a table?` });
      break; // one shape per table; the first match is the most specific
    }
  }
}

reportRatchet({
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
