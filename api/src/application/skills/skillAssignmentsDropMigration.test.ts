import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = resolve(__dirname, '..', '..', '..', '..');
/** Reading throws if the migration is missing, so these assertions never silently skip. */
const contract = readFileSync(resolve(repo, 'api/migrations', '1274_drop_skill_assignments.sql'), 'utf8')
  .replace(/--[^\n]*/g, ''); // assert on SQL, not on the prose describing it

/**
 * 1274 drops `skill_assignments` after 1261 folded it into `artifact_assignments`. Its
 * data-safety rule (abort rather than lose a grant) is asserted against the SQL itself:
 * a later edit that reorders or loosens it fails here, not on a production drop.
 */
describe('1274 — skill_assignments is dropped only after every grant is carried', () => {
  const backfill = contract.search(/PERFORM\s+backfill_skill_assignments\(\)/i);
  const guard = contract.search(/RAISE\s+EXCEPTION/i);
  const drop = contract.search(/DROP\s+TABLE\s+skill_assignments/i);

  it('re-runs the backfill, then guards, then drops — in that order', () => {
    expect(backfill).toBeGreaterThanOrEqual(0);
    expect(guard).toBeGreaterThan(backfill);
    expect(drop).toBeGreaterThan(guard);
  });

  it('raises only when some skill_assignments row is not carried by artifact_assignments', () => {
    expect(contract).toMatch(
      /SELECT\s+count\(\*\)\s+INTO\s+uncarried\s+FROM\s+skill_assignments[\s\S]*NOT\s+EXISTS\s*\([\s\S]*artifact_assignments/i,
    );
    expect(contract).toMatch(/IF\s+uncarried\s*>\s*0\s+THEN\s+RAISE\s+EXCEPTION/i);
  });

  it('looks the table up through search_path and drops the backfill function idempotently', () => {
    expect(contract).toMatch(/to_regclass\('skill_assignments'\)\s+IS\s+NULL/i);
    expect(contract).not.toMatch(/'public\./i);
    expect(contract).toMatch(/DROP\s+FUNCTION\s+IF\s+EXISTS\s+backfill_skill_assignments\(\)/i);
  });
});
