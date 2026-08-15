import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * ORDER BY null-placement guard.
 *
 * Postgres wants ONE ordered clause: `ORDER BY col ASC NULLS FIRST`. Drizzle's
 * `asc()` / `desc()` helpers append the direction to whatever they wrap, so
 * wrapping a fragment that ALREADY carries the null clause emits
 * `ORDER BY col nulls first asc` — which the server rejects outright with
 * `syntax error at or near "asc"`.
 *
 * This is not a style rule. `runRepoActivitySweep` shipped with
 * `asc(sql\`${col} nulls first\`)` and therefore threw on its FIRST query on every
 * single cron tick: the repo-activity producer never ingested one event, and
 * because the sweep was fire-and-forget inside `scheduled()` the failure was
 * invisible until an operator forced the sweep from the admin panel and read the
 * error back. A statically-detectable syntax error that costs a whole subsystem
 * deserves a check that runs in CI rather than a comment.
 *
 * Every other null-ordered query in the codebase already uses the correct idiom —
 * a bare `sql` template with direction and null placement in order (see
 * `ManagerService`, `TaskRepository`, `tenantProviderKeyService`). This pins that.
 */

const SRC = resolve(__dirname, '../..');

function tsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) { tsFiles(full, acc); continue; }
    if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) acc.push(full);
  }
  return acc;
}

/**
 * Find `asc(...)` / `desc(...)` calls whose argument mentions NULLS. Balances
 * parens so a nested `sql` template with its own calls is still captured whole.
 */
function nullsInsideDirection(source: string): string[] {
  const offenders: string[] = [];
  const head = /\b(asc|desc)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = head.exec(source)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < source.length && depth > 0) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') depth--;
      i++;
    }
    const arg = source.slice(m.index + m[0].length, i - 1);
    if (/nulls\s+(first|last)/i.test(arg)) offenders.push(`${m[1]}(${arg})`);
  }
  return offenders;
}

describe('ORDER BY null placement', () => {
  it('never wraps a NULLS FIRST/LAST fragment in asc() or desc()', () => {
    const offenders: string[] = [];
    for (const file of tsFiles(SRC)) {
      const found = nullsInsideDirection(readFileSync(file, 'utf8'));
      for (const snippet of found) {
        offenders.push(`${file.slice(SRC.length + 1)}: ${snippet}`);
      }
    }
    expect(
      offenders,
      'Put the direction INSIDE the sql fragment instead: sql`${col} asc nulls first`. '
      + 'asc()/desc() append the direction after the null clause, which Postgres rejects.',
    ).toEqual([]);
    // Reads every one of ~1,500 source files synchronously. That is ~1s idle and
    // over the 5s default on a loaded CI runner, where it failed as a TIMEOUT
    // reported against this assertion — indistinguishable, in the log, from an
    // actual `asc(sql`… nulls first`)` violation. Budget for the scan instead.
  }, 60_000);

  /** The detector has to actually catch the shape that shipped, or it guards nothing. */
  it('detects the shape that broke the repo-activity sweep', () => {
    expect(nullsInsideDirection('.orderBy(asc(sql`${t.syncedAt} nulls first`))')).toHaveLength(1);
    expect(nullsInsideDirection('.orderBy(desc(sql`${t.at} NULLS LAST`))')).toHaveLength(1);
    // The correct idiom, and an ordinary direction wrapper, must NOT trip it.
    expect(nullsInsideDirection('.orderBy(sql`${t.syncedAt} asc nulls first`)')).toEqual([]);
    expect(nullsInsideDirection('.orderBy(desc(sql`count(*)`), asc(t.name))')).toEqual([]);
  });
});
