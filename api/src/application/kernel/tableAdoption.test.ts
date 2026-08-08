/**
 * The consolidated schema's adoption CONTRACT (PRD 20 §5, §7).
 *
 * The baseline this used to describe is EMPTY: every table migrations 0418+
 * create now has a code path, so `check-table-adoption.mjs` is a gate at zero
 * rather than a ratchet over a list of 237. The interesting assertion changed
 * with it — "did the number shrink" is no longer a question worth asking, and
 * "did anything fall out" is.
 *
 * Two things are asserted here, and they fail differently on purpose:
 *
 *   · the AGGREGATE — nothing is cold. A table added without a code path fails
 *     here and in the guard, and neither can be satisfied by a comment.
 *   · the SURFACES PRD 20 ships — pinned by name, because a count re-arms itself.
 *     Deleting `ObjectRegistry`'s reads while adding an unrelated catalog entry
 *     nets to zero cold tables and would otherwise pass.
 */
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { analyseTableAdoption } from '../../../scripts/lib/tableAdoption.mjs';
import { OBJECT_RELATIONS } from './ObjectRegistry';

const api = resolve(__dirname, '..', '..', '..');
const analysis = analyseTableAdoption({
  srcDir: resolve(api, 'src'),
  migrationsDir: resolve(api, 'migrations'),
  schemaDir: resolve(api, 'src', 'infrastructure', 'database', 'schema'),
});

/**
 * The tables whose loss would be a regression in DELIVERED behaviour rather than
 * a change in sequencing.
 *
 * `objects` is the registry itself; the next four back the object panel's tabs;
 * `metric_facts` backs every seat's Trends chart and is written by the projection
 * sweep; `email_otp_challenges` is the legacy consolidation §5 step 3 finished
 * end to end; the last three are the roots the entity layer registers, one per
 * seat family, so a catalog that stopped being wired fails here by name.
 */
const MUST_BE_LIVE = [
  'objects',
  'annotations',
  'memberships',
  'share_links',
  'revisions',
  'metric_facts',
  'email_otp_challenges',
  'job_applications',
  'deals',
  'email_campaigns',
] as const;

describe('consolidated table adoption', () => {
  it('parses the consolidation series rather than passing vacuously', () => {
    // If the migrations move or the parser breaks, every other assertion here
    // becomes trivially true. Fail loudly on an empty read instead.
    expect(analysis.created.size).toBeGreaterThan(200);
  });

  it('gives every migrated table a Drizzle declaration', () => {
    // A table with no `pgTable` export is unreachable from typed code, which is a
    // different and worse problem than a table whose feature has not landed yet.
    expect(analysis.missingExport).toEqual([]);
  });

  it.each(MUST_BE_LIVE)('keeps %s wired to a code path', (table) => {
    const entry = analysis.live.get(table);
    expect(entry, `${table} has no non-test reader or writer`).toBeDefined();
    expect((entry?.imports.length ?? 0) + (entry?.rawSql.length ?? 0)).toBeGreaterThan(0);
  });

  it('leaves nothing cold — the ratchet reached its gate', () => {
    // PRD 20 §5's stated failure mode, measured: a schema that ships and a code
    // path that never arrives. Zero is the whole claim.
    expect(analysis.cold).toEqual([]);
  });

  it('reports live and cold as disjoint', () => {
    const overlap = analysis.cold.filter((t: string) => analysis.live.has(t));
    expect(overlap).toEqual([]);
  });

  it('accounts for every created table as either live or cold', () => {
    expect(analysis.live.size + analysis.cold.length).toBe(analysis.created.size);
  });

  it('backs each object-panel relation with a live table', () => {
    // The panel's tabs come from OBJECT_RELATIONS; `activity` reads `activity_log`,
    // which predates the consolidation (migration 0287) and so is not in the created
    // set. The other four are consolidated tables and must be live.
    const relationTables: Record<string, string | null> = {
      activity: null,
      annotations: 'annotations',
      members: 'memberships',
      shares: 'share_links',
      revisions: 'revisions',
    };
    for (const relation of OBJECT_RELATIONS) {
      const table = relationTables[relation];
      expect(Object.keys(relationTables), `OBJECT_RELATIONS gained "${relation}" with no table mapping`).toContain(
        relation,
      );
      if (table) expect(analysis.live.has(table), `${relation} tab reads a cold table`).toBe(true);
    }
  });
});
