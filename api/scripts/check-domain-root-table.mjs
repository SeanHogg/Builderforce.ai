#!/usr/bin/env node
/**
 * Root-table guard (PRD 20 §3) — a seat's ROOT entity lives in that seat's module.
 *
 * `DOMAIN_MANIFEST` names a `rootKind` per domain: the thing a seat's surface leads
 * with, the row every other table in the domain hangs off. `check-domain-boundary.mjs`
 * already counts the edges BETWEEN modules, but it had nothing to say about the case
 * that matters most — a domain whose own root table is declared in somebody else's
 * file. Six of the seventeen seats were in that state when this guard was written:
 *
 *   hiring        rootKind `job_posting`      → `job_postings` was in `agents.ts`
 *   support       rootKind `ticket`           → `support_tickets` was in `commerce.ts`
 *   integrations  rootKind `connection`       → the connector family was in `platform.ts`
 *   growth        kind     `site`             → `project_sites` was in `delivery.ts`
 *   canvas        (ceremony)                  → `ceremony_sessions` was in `identity.ts`
 *   identity      kind     `team`             → `teams` was in `canvas.ts`
 *
 * WHY IT IS WORTH A GUARD AND NOT A CONVENTION. The hiring one shows the cost in a
 * column. `job_applications.job_posting_id` was a bare `varchar(36)` with no
 * `.references()`, and its own docstring said why: declaring the reference would have
 * made `hiring.ts` import `agents.ts`. So the single most important join in the ATS
 * was documented as a convention rather than declared as a constraint — not because
 * anybody decided that, but because a file boundary made the honest version cost an
 * edge. A misplaced root table does not announce itself; it quietly makes the correct
 * schema unwritable, and then the workaround gets a comment explaining that it is fine.
 *
 * NO BASELINE. Every other data-model guard here ratchets, because each landed against
 * a schema that already violated it in dozens of places and a guard that fails on day
 * one gets `|| true`'d into decoration. This one is different: there are seventeen
 * seats, the list is enumerated below, and all seventeen pass. A ratchet would be a
 * place to park the eighteenth violation instead of arguing about it, which is exactly
 * what this guard exists to prevent.
 *
 * ADDING A SEAT means adding a line to `ROOT_TABLE`. That is deliberate — the guard
 * refuses to run against a manifest entry it has never been told about, so a new
 * domain cannot arrive with its root table wherever it happened to get typed.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(import.meta.url), '..');
const schemaDir = resolve(here, '..', 'src', 'infrastructure', 'database', 'schema');
const manifestFile = resolve(here, '..', 'src', 'application', 'kernel', 'DomainService.ts');

/**
 * The kernel is the sanctioned shared home, exactly as it is for
 * `check-domain-boundary.mjs`: a seat whose root entity IS a kernel primitive —
 * delivery's `work_item`, finance's `ledger_entry`, integrations' `connection` — is
 * the model working as designed, not a boundary being crossed.
 */
const KERNEL_MODULE = 'kernel.ts';

/**
 * rootKind → the table that backs it, per domain.
 *
 * `null` means the root is an `objects` row and has no table of its own, which is the
 * common case in the target model (§3.1: a kind is a row in `objects`, not DDL). The
 * guard does not take that on trust — it asserts that no table exists under the name,
 * so the day somebody gives `signal` or `party` its own DDL, this file has to say
 * where it belongs before the build goes green.
 */
const ROOT_TABLE = {
  // Backed by a table in the domain's own module.
  agents:       'agents',
  canvas:       'creation_sessions',
  governance:   'soc_controls',
  hiring:       'job_postings',
  investor:     'companies',
  legal:        'legal_entities',
  operations:   'work_orders',
  revenue:      'deals',
  support:      'support_tickets',
  /** Four campaign tables live in `growth.ts` (marketing / social / email / ad) and
   *  the manifest's `campaign` is the marketing one the surface leads with. Named
   *  explicitly rather than matched by prefix: "which of the four" is a question a
   *  guard must not answer by guessing. */
  growth:       'marketing_campaigns',
  /** The employment RECORD, not the person — `users` is identity's. */
  people:       'people_employees',

  // Backed by a kernel primitive — the sanctioned shared home.
  delivery:     'work_items',
  finance:      'ledger_entries',
  integrations: 'connections',

  // `objects` rows: no DDL of their own, by design.
  /** A party is an `objects` row; `party_roles` (kernel) is what it PLAYS, which is a
   *  different fact and deliberately not the root. */
  identity:     null,
  /** `signal` is the observability EVENT, carried as `activity_log` / `metric_facts`
   *  rows. Note that `monitors` (delivery) and `uptime_monitors` (platform) are two
   *  genuinely different concepts that share a word — neither is the root. */
  platform:     null,
  /** A listing sells as a `catalog_items` row (kernel); `listings` is not a table and
   *  must not become one. */
  commerce:     null,
};

// ── Where every table is declared ───────────────────────────────────────────
const files = readdirSync(schemaDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
if (files.length === 0) {
  console.error(`❌  No schema modules found under ${schemaDir}. Failing rather than passing vacuously.`);
  process.exit(1);
}
const declaredIn = new Map(); // table name -> module file
for (const file of files) {
  for (const m of readFileSync(resolve(schemaDir, file), 'utf8').matchAll(/pgTable\(\s*'([a-z0-9_]+)'/g)) {
    declaredIn.set(m[1], file);
  }
}

// ── The roster, read from the manifest rather than restated ─────────────────
const manifest = readFileSync(manifestFile, 'utf8');
const roster = [...manifest.matchAll(/domain:\s*'(\w+)',[\s\S]{0,400}?rootKind:\s*'(\w+)'/g)]
  .map(([, domain, rootKind]) => ({ domain, rootKind }));
if (roster.length === 0) {
  console.error(`❌  Parsed no DOMAIN_MANIFEST entries out of ${manifestFile}. The guard cannot pass on an empty roster.`);
  process.exit(1);
}

/** `job_posting` → `job_postings`. Only used to police the `null` entries. */
const plural = (s) => (s.endsWith('y') ? `${s.slice(0, -1)}ies` : s.endsWith('s') ? `${s}es` : `${s}s`);

const problems = [];
for (const { domain, rootKind } of roster) {
  const own = `${domain}.ts`;

  if (!(domain in ROOT_TABLE)) {
    problems.push(
      `${domain} (rootKind '${rootKind}') has no entry in ROOT_TABLE.\n` +
        `        A new seat declares where its root entity lives. Add a line to\n` +
        `        scripts/check-domain-root-table.mjs — the table name, or null if the root\n` +
        `        is an \`objects\` row.`,
    );
    continue;
  }

  const table = ROOT_TABLE[domain];

  if (table === null) {
    const guess = plural(rootKind);
    const found = declaredIn.get(guess);
    if (found) {
      problems.push(
        `${domain}'s rootKind '${rootKind}' is recorded as an \`objects\` row, but \`${guess}\` is now a\n` +
          `        table declared in ${found}.\n` +
          `        Either it belongs in ${own} and ROOT_TABLE should name it, or it is a\n` +
          `        different concept that happens to share the word — say which, here.`,
      );
    }
    continue;
  }

  const found = declaredIn.get(table);
  if (!found) {
    problems.push(
      `${domain}'s root table \`${table}\` is not declared in any schema module.\n` +
        `        Either it was renamed (update ROOT_TABLE) or it was deleted (the seat has no root).`,
    );
    continue;
  }
  if (found !== own && found !== KERNEL_MODULE) {
    problems.push(
      `${domain} declares rootKind '${rootKind}', but \`${table}\` is declared in ${found}, not ${own}.\n` +
        `        A seat whose own root entity lives in another seat's module cannot be reviewed on\n` +
        `        its own, and its children cannot declare a foreign key to it without crossing a\n` +
        `        domain boundary — which is how \`job_applications.job_posting_id\` came to be a bare\n` +
        `        column. Move the table (and the family that hangs off it) into ${own}; carry any\n` +
        `        cross-domain columns as plain ids, per §3.`,
    );
  }
}

if (problems.length) {
  console.error(`❌  check-domain-root-table: ${problems.length} seat(s) whose root entity is misfiled.\n`);
  for (const p of problems) console.error(`    ${p}\n`);
  console.error(
    `    There is no baseline for this guard, on purpose: the roster is seventeen entries\n` +
      `    long and all seventeen passed when it landed. Fix the placement or state the\n` +
      `    ownership in ROOT_TABLE — do not add a way to record the violation.`,
  );
  process.exit(1);
}

const backed = roster.filter((r) => ROOT_TABLE[r.domain] !== null).length;
console.log(
  `✅  check-domain-root-table OK — ${roster.length} seats; ${backed} root entities declared in their own ` +
    `module or the kernel, ${roster.length - backed} carried as \`objects\` rows.`,
);
process.exit(0);
