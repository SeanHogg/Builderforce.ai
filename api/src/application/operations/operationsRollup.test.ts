/**
 * The contract between the operations MANIFEST and the operations WRITER.
 *
 * `financeRollup.ts` exists because three surfaces read `finance.*` keys by name and
 * nothing on the platform ever wrote one — a live promise over an empty read that no
 * guard could see, because a declared metric and a written metric look identical from
 * every other angle. This test is what stops that recurring for the sixteenth seat: the
 * keys `DOMAIN_MANIFEST` advertises and the keys `runOperationsRollup` inserts are
 * asserted to be the same set, so declaring a fourth metric without teaching the writer
 * to produce it fails here rather than rendering an empty panel forever.
 *
 * It reads the writer's SQL as SOURCE rather than executing it: the rollup is four
 * grouped aggregates against Postgres, which a unit test cannot run, and the drift this
 * exists to catch is a NAME — which the source carries exactly.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOMAIN_MANIFEST, metricsFor } from '../kernel/DomainService';

const source = readFileSync(resolve(__dirname, 'operationsRollup.ts'), 'utf8');

/** Every `'operations.…'` literal the writer actually inserts. */
const written = new Set([...source.matchAll(/'(operations\.[a-z_]+)'/g)].map((m) => m[1]));

describe('the operations rollup writes what the seat advertises', () => {
  it('produces every metric the manifest declares', () => {
    for (const metric of DOMAIN_MANIFEST.operations.metrics) {
      expect(written.has(metric), `${metric} is charted by the seat and written by nobody`).toBe(true);
    }
  });

  it('advertises every metric it produces', () => {
    // The other direction matters too: a key written and never declared is a number
    // computed on every sweep that no surface will ever draw.
    for (const metric of written) {
      expect(
        DOMAIN_MANIFEST.operations.metrics.includes(metric),
        `${metric} is written by the rollup and charted by no seat`,
      ).toBe(true);
    }
  });

  it('leaves the universal item/event keys to the registry projection', () => {
    // `operations.items` and `operations.events` are written by `registryProjection`
    // for every seat. A second writer for them would be two rollups upserting the same
    // point, which is the duplication the universal pair exists to prevent.
    for (const universal of metricsFor('operations').filter((k) => !DOMAIN_MANIFEST.operations.metrics.includes(k))) {
      expect(written.has(universal), `${universal} must come from the registry sweep, not this rollup`).toBe(false);
    }
  });
});

describe('the numbers refuse rather than guess', () => {
  it('never zero-fills a rate for a tenant with no completed work', () => {
    // A first-time-fix rate of 0 renders as a catastrophically broken operation, and
    // `trigger` objects fire on these keys. Absence is the honest answer, so the
    // aggregate is bounded by a NOT NULL predicate rather than a COALESCE.
    expect(source).toContain('o.first_time_fix IS NOT NULL');
    expect(source).not.toMatch(/COALESCE\([^)]*first_time_fix/i);
  });

  it('excludes cancelled work from both the backlog and the breach count', () => {
    // A cleaned-up queue must not read as a failing one.
    expect(source).toContain("o.status <> 'cancelled'");
    expect(source).toContain('o.status NOT IN');
  });

  it('counts an open, overdue job as a breach rather than waiting for it to finish', () => {
    // Counting only late COMPLETIONS understates the number precisely during the
    // outage that is currently running.
    expect(source).toContain('o.completed_at IS NULL AND o.sla_due_at < NOW()');
  });

  it('derives first-time fix from ATTENDED visits, not from booked ones', () => {
    // A visit that was cancelled, or where nobody could get in, did not consume a
    // second attendance and must not count against the engineer who fixed it on
    // their only trip.
    expect(source).toContain('FILTER (WHERE check_in_at IS NOT NULL)');
  });
});
