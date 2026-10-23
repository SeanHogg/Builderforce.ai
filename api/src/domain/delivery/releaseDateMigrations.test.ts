import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RELEASE_STATUSES } from './releaseSchedule';

const repo = resolve(__dirname, '..', '..', '..', '..');
const migrationPath = (file: string) => resolve(repo, 'api/migrations', file);
const read = (file: string) =>
  readFileSync(migrationPath(file), 'utf8')
    .replace(/--[^\n]*/g, ''); // assert on SQL, not on the prose describing it

const EXPAND = '1266_release_dates_plan_vs_actual.sql';
const expand = read(EXPAND);
/** The contract step (1272). Required: reading it throws if it is missing, so its
 *  assertions can never silently skip. */
const CONTRACT = '1272_drop_release_date.sql';
const contract = read(CONTRACT);

/**
 * The release-date fold (1266 expand, 1272 contract) is SQL, so its data-safety rules
 * are asserted against the migrations themselves: a later edit that loosens one of
 * them fails here rather than on a production backfill.
 */
describe('1266 — release_date folds onto plan vs actual without losing data', () => {
  it('keeps release_date for the deploy window (expand only — no drop, no constraint)', () => {
    expect(expand).not.toMatch(/DROP\s+COLUMN[^;]*release_date/i);
    expect(expand).not.toMatch(/ADD\s+CONSTRAINT/i);
    expect(expand).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+fold_product_release_date\(\)/i);
    expect(expand).toMatch(/SELECT\s+fold_product_release_date\(\)/i);
  });

  it('clears released_at only for releases back in plan — a cancelled (rolled-back) release keeps its ship date', () => {
    expect(expand).toMatch(/SET\s+released_at\s*=\s*NULL\s+WHERE\s+status\s+IN\s*\('planned',\s*'in_progress'\)/i);
    expect(expand).not.toMatch(/SET\s+released_at\s*=\s*NULL\s+WHERE\s+status\s*<>/i);
  });

  it('maps the known legacy statuses and aborts on any other status outside the service vocabulary', () => {
    expect(expand).toMatch(/WHEN\s+'shipped'\s+THEN\s+'released'/i);
    expect(expand).toMatch(/WHEN\s+'frozen'\s+THEN\s+'in_progress'/i);
    expect(expand).toMatch(/WHEN\s+'rolled_back'\s+THEN\s+'cancelled'/i);
    const vocabulary = expand.match(/status\s+NOT\s+IN\s*\(([^)]*)\)/i)?.[1]
      ?.split(',').map((s) => s.trim().replace(/'/g, '')).sort();
    expect(vocabulary).toEqual([...RELEASE_STATUSES].sort());
    expect(expand).toMatch(/RAISE\s+EXCEPTION\s+'product_releases has status value/i);
  });

  it('writes a disagreeing release_date into notes, and aborts if any release_date is carried nowhere', () => {
    expect(expand).toMatch(/SET\s+notes\s*=[\s\S]*'Former release date: '/i);
    expect(expand).toMatch(/RAISE\s+EXCEPTION\s+'%\s+product_releases row\(s\) would lose their release_date/i);
  });
});

describe('1272 — contract step drops release_date after the fold', () => {
  it('is the only drop_release_date migration', () => {
    const contracts = readdirSync(resolve(repo, 'api/migrations')).filter((file) => /^\d+_drop_release_date\.sql$/.test(file));
    expect(contracts).toEqual([CONTRACT]);
  });

  it('drops release_date only after re-running the fold, then drops the fold function', () => {
    expect(contract).toMatch(/PERFORM\s+fold_product_release_date\(\)[\s\S]*DROP\s+COLUMN\s+release_date/i);
    expect(contract).toMatch(/DROP\s+FUNCTION\s+IF\s+EXISTS\s+fold_product_release_date\(\)/i);
  });

  it('adds the released_at ⇒ released|cancelled CHECK only after the fold has cleared planned rows', () => {
    expect(contract.indexOf('PERFORM fold_product_release_date()')).toBeGreaterThanOrEqual(0);
    expect(contract.indexOf('PERFORM fold_product_release_date()'))
      .toBeLessThan(contract.indexOf('product_releases_released_at_status_chk'));
    expect(contract).toMatch(/CHECK\s*\(\s*released_at\s+IS\s+NULL\s+OR\s+status\s+IN\s*\('released',\s*'cancelled'\)\s*\)/i);
  });
});
