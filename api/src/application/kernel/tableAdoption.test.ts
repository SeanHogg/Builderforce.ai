/**
 * The consolidated schema's adoption CONTRACT (PRD 20 §5, §7).
 *
 * Adoption is measured in TWO tiers, because one number lies in one direction or
 * the other. The generic entity layer registers all 245 consolidated tables, so
 * "is anything importing this?" became true for every one of them the day that
 * layer landed — without a single feature having been migrated. Reporting that as
 * full adoption would be false; reporting those tables as unreachable would also
 * be false. So: `registered` is the floor, `featureReached` is the progress.
 *
 * Three things are asserted here, and they fail differently on purpose:
 *
 *   · the FLOOR — nothing is cold. A consolidated table missing from every
 *     `entities.ts` is a hole in the registry, so this is flat zero, not a ratchet.
 *   · the PROGRESS — accounted for in exactly one tier, so a table cannot be
 *     counted as adopted and awaiting adoption at the same time.
 *   · the SURFACES PRD 20 ships — asserted by name and against the STRICT tier,
 *     because a count re-arms itself: deleting `ObjectRegistry`'s reads while
 *     adding an unrelated catalog entry nets to zero and would otherwise pass.
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
 * end to end.
 *
 * `job_applications`, `deals` and `email_campaigns` were listed here for a while
 * and are deliberately NOT: they are registered by their domain's `entities.ts`
 * and read by nothing else. They looked qualified while the measurement counted
 * entity-layer registration as a code path — which it did for all 245 at once.
 * They belong here the day a hiring, revenue or growth feature reads them, and
 * asserting it sooner would make this list say something untrue.
 */
const MUST_BE_LIVE = [
  'objects',
  'annotations',
  'memberships',
  'share_links',
  'revisions',
  'metric_facts',
  'email_otp_challenges',
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

  it.each(MUST_BE_LIVE)('keeps %s reached by a feature, not merely registered', (table) => {
    // Deliberately NOT satisfied by the entity layer. Every consolidated table is
    // registered in some `domains/<domain>/entities.ts`, so an assertion that
    // accepted registration would pass for all 245 and prove nothing about these
    // seven — which is exactly how the first version of this test read green.
    const entry = analysis.live.get(table);
    expect(entry, `${table} has no non-test reader or writer`).toBeDefined();
    expect(
      (entry?.imports.length ?? 0) + (entry?.rawSql.length ?? 0),
      `${table} is registered by the entity layer but no feature reads or writes it`,
    ).toBeGreaterThan(0);
  });

  it('registers every created table with its domain entity layer', () => {
    // A table absent from every `entities.ts` is a hole in the registry, not a
    // feature awaiting migration — so this is flat zero, not a ratchet.
    expect(analysis.cold).toEqual([]);
  });

  it('reports registry-only and feature-reached as disjoint', () => {
    const overlap = analysis.registryOnly.filter((t: string) => analysis.featureReached.includes(t));
    expect(overlap).toEqual([]);
  });

  it('accounts for every created table in exactly one tier', () => {
    expect(analysis.featureReached.length + analysis.registryOnly.length + analysis.cold.length)
      .toBe(analysis.created.size);
  });

  it('backs each object-panel relation with a feature-reached table', () => {
    // The panel's tabs come from OBJECT_RELATIONS; `activity` reads `activity_log`,
    // which predates the consolidation (migration 0287) and so is not in the created
    // set. The other four are consolidated tables and must be feature-reached.
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
      if (table) expect(analysis.featureReached.includes(table), `${relation} tab reads a table no feature touches`).toBe(true);
    }
  });
});
