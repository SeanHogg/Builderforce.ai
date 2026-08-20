#!/usr/bin/env node
/**
 * Polymorphic reference guard (PRD 20 §2) — a `(kind, id)` pair is not a foreign key.
 *
 * The kernel's whole argument is that 33 comment tables should be one `annotation`
 * table, 43 membership tables one `membership` table, 24 share-link tables one
 * `share_link` table. Each of those collapses works by replacing a real foreign
 * key (`board_id → boards.id`) with an untyped pair (`object_kind`, `object_id`).
 * That trade is only defensible with somewhere for the pair to POINT: an `object`
 * registry every addressable entity registers in, so the reference is still
 * declaratively enforced. Without it the collapse is strictly worse than the
 * sprawl it replaces — a generic table can orphan rows the per-entity table
 * could not, and nothing in the database says so.
 *
 * This guard is the reason `object` is the one NEW table in a document otherwise
 * about deleting them. It fails when a polymorphic pair exists with no registry
 * to reference.
 *
 * WHERE THIS STANDS (re-measured 2026-08-19). `objects` EXISTS — migration 0418,
 * declared in `schema/kernel.ts`, written by `registryProjection.ts` and by
 * `EntityService` on every entity-layer write. So the sentence this docstring used
 * to carry ("there is no objects table for them to point at") is no longer true,
 * and the three baseline entries no longer mean what they used to.
 *
 * What they mean NOW is the harder half: the pair still has no FOREIGN KEY. Adding
 * one is not a schema edit that can land on its own, because a hard FK rejects any
 * row whose target is not registered yet, and the projection only covers the
 * navigable kinds. Each of the three clears when every target it can name is
 * registered — i.e. as PRD 20 §5 step 5 moves that family onto the entity layer —
 * not before. The guard counts them until then, and the detail line below already
 * says the right thing once the registry is present.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDrizzleTables } from './lib/drizzleSchema.mjs';
import { reportRatchet } from './lib/ratchet.mjs';

const here = resolve(fileURLToPath(import.meta.url), '..');
const srcDir = resolve(here, '..', 'src');

/** The naming conventions a polymorphic reference arrives under. The pair must be
 *  present TOGETHER — a lone `entity_type` is an enum, not a reference. */
const PAIRS = [
  ['entity_type', 'entity_id'],
  ['entity_kind', 'entity_id'],
  ['target_type', 'target_id'],
  ['target_kind', 'target_id'],
  ['subject_type', 'subject_id'],
  ['owner_type', 'owner_id'],
  ['object_kind', 'object_id'],
  ['object_type', 'object_id'],
  ['resource_type', 'resource_id'],
  ['parent_type', 'parent_id'],
  ['ref_type', 'ref_id'],
  ['related_type', 'related_id'],
  ['source_type', 'source_id'],
  ['item_type', 'item_id'],
];

/** The registry, once it exists. Named here rather than inline so the day it is
 *  added, this guard starts enforcing instead of merely counting. */
const REGISTRY_TABLE = 'objects';

const tables = parseDrizzleTables(srcDir);
if (tables.size === 0) {
  console.error('❌  Parsed zero tables. The schema moved or the parser broke — failing rather than passing vacuously.');
  process.exit(1);
}

const registryExists = tables.has(REGISTRY_TABLE);

const findings = [];
for (const [name, cols] of [...tables].sort((a, b) => a[0].localeCompare(b[0]))) {
  for (const [kindCol, idCol] of PAIRS) {
    if (cols.has(kindCol) && cols.has(idCol)) {
      findings.push({
        key: `${name}.(${kindCol}, ${idCol})`,
        detail: registryExists
          ? `points nowhere — add a FK from ${name}.${idCol} to ${REGISTRY_TABLE}.id.`
          : `there is no \`${REGISTRY_TABLE}\` registry yet, so this reference is unenforced by construction (PRD 20 §2).`,
      });
      break;
    }
  }
}

reportRatchet({
  name: 'check-polymorphic-fk',
  baselinePath: resolve(here, '.polymorphic-fk-baseline.txt'),
  findings,
  unit: `polymorphic reference(s) not yet keyed to ${REGISTRY_TABLE}`,
  header: `Tables using a (kind, id) pair with no FOREIGN KEY to \`${REGISTRY_TABLE}\` (PRD 20 §2). The registry exists; each entry clears when every target it can name is registered.`,
  fixHint:
    `A new table references another by an untyped (kind, id) pair. The database cannot\n` +
    `    enforce that, so it will orphan. Register the target in \`${REGISTRY_TABLE}\` and add a real FK.`,
  update: process.argv.includes('--update'),
});
