import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { composeDispatcherLabel, MAX_SUBMITTED_BY_CHARS } from './dispatcherLabel';

/**
 * The bug this guard exists to prevent, for the SECOND time.
 *
 * `executions.submitted_by` was varchar(36) and a dozen call sites built it by raw
 * template — `` `system:ceremony:${sessionId}` ``, `` `quality:${userId}` `` — with a
 * UUID or a user id interpolated straight in. Postgres raised 22001 `value too long
 * for type character varying(36)` INSIDE the dispatch, so the run never started and
 * the failure never reached the chat that asked for it: the user saw silence, not an
 * error. Migration 0368 widened the column to 128, but a wider column only moves the
 * cliff — an unbounded interpolation overruns any fixed width.
 *
 * `composeDispatcherLabel` keeps the value inside the column BY CONSTRUCTION. This
 * test enforces that every producer actually goes through it, because the unit tests
 * for the composer cannot see a call site that bypasses it.
 */

const APP_ROOT = join(__dirname, '..', '..');

/** Every .ts source file under src/, excluding tests and the composer itself. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules') continue;
      sourceFiles(full, acc);
      continue;
    }
    if (!entry.endsWith('.ts')) continue;
    if (entry.includes('.test.') || entry === 'dispatcherLabel.ts') continue;
    acc.push(full);
  }
  return acc;
}

describe('submitted_by call sites', () => {
  it('never builds a dispatcher label by raw template', () => {
    // A `submittedBy:` assigned from a template literal containing an interpolation.
    const rawTemplate = /submittedBy:\s*`[^`]*\$\{/;

    const offenders: string[] = [];
    for (const file of sourceFiles(join(APP_ROOT, 'application')).concat(
      sourceFiles(join(APP_ROOT, 'presentation')),
    )) {
      const text = readFileSync(file, 'utf8');
      for (const [i, line] of text.split(/\r?\n/).entries()) {
        if (rawTemplate.test(line)) {
          offenders.push(`${relative(APP_ROOT, file)}:${i + 1}: ${line.trim()}`);
        }
      }
    }

    expect(
      offenders,
      'Build these with composeDispatcherLabel(base, kind, detail) — a raw template '
        + `can exceed executions.submitted_by (varchar(${MAX_SUBMITTED_BY_CHARS})) and `
        + 'raise Postgres 22001 inside the dispatch, losing the run silently:\n'
        + offenders.join('\n'),
    ).toEqual([]);
  });

  it('keeps the real-world labels inside the column', () => {
    // The exact shapes the converted call sites now emit, with pathological inputs:
    // a UUID session id, a 36-char user id, a long provider/kind name.
    const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    const cases: Array<[string, string, string | null]> = [
      ['system', 'ceremony', uuid],
      ['system', 'board-sync', 'some-very-long-provider-name'],
      ['manager', 'signoff-request', uuid],
      ['manager', 'conflict-resolution', uuid],
      ['quality', uuid, null],
      ['user', uuid, null],
      ['incident', uuid, null],
      ['system:coordinator', 'lane-approver', 'engineering-manager'],
    ];

    for (const [base, kind, detail] of cases) {
      const label = composeDispatcherLabel(base, kind, detail);
      expect(label.length).toBeLessThanOrEqual(MAX_SUBMITTED_BY_CHARS);
      expect(label).not.toBe('');
    }
  });
});
