/**
 * What MOVED a ratchet — the half every count-based guard was missing.
 *
 * ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────
 * `check-design-scale` and `check-frontend-architecture` both failed with a COUNT and a
 * `.slice(0, 12)` sample of *all* offenders. On a codebase with 3,793 literal font sizes
 * that sample is the same twelve lines every time, and none of them is necessarily the
 * one that broke the build. Finding the actual regression meant diffing per-file counts
 * against the last green commit by hand — roughly 150 `git show` calls, which is why the
 * two guards sat red for two days while everyone read the CI jobs instead.
 *
 * So each ratchet now records a per-FILE tally beside its number. A count is the gate; the
 * tally is the explanation. When the gate trips, the guard subtracts the two tallies and
 * names the files that actually changed — usually one or two — instead of reprinting a
 * corpus.
 *
 * ── WHY PER-FILE AND NOT PER-OFFENDER ────────────────────────────────────────────
 * Storing all 3,793 offender strings would make the diff exact and the baseline file
 * unreadable and unmergeable — every line move rewrites it. A per-file tally is stable
 * under edits that do not change how many offences a file carries, which is precisely the
 * signal wanted: "this file went from 0 to 12". Line numbers stay out of the record and
 * come from the live scan, where they are correct.
 *
 * ── WHY IT IS ADVISORY, NEVER A SECOND GATE ──────────────────────────────────────
 * The tally is written from whatever the tree measured on the last accepted run, so it can
 * be stale in ways the count is not. It therefore only ever EXPLAINS a failure the count
 * already decided. A guard must never fail because a tally disagreed — that would be a
 * ratchet nobody can land a legitimate change through.
 */

import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Per-file tally from offender strings.
 *
 * Accepts either bare paths (`'components/Foo.tsx'`) or the `path:line  detail` form both
 * guards already build for their samples, so a caller hands over the list it was going to
 * print anyway rather than maintaining a second shape.
 */
export function tallyByFile(offenders) {
  const tally = {};
  for (const offender of offenders) {
    const file = String(offender).split(/[:\s]/, 1)[0];
    tally[file] = (tally[file] ?? 0) + 1;
  }
  return tally;
}

/**
 * Files whose offence count changed, worst first.
 *
 * `added` is what a failing guard has to name. `removed` matters too: a slack ratchet is
 * a real failure in a shrink-only guard, and "which file got better" is the sentence that
 * makes lowering the baseline an obvious decision rather than a leap of faith.
 */
export function fileDelta(before = {}, after = {}) {
  const files = new Set([...Object.keys(before), ...Object.keys(after)]);
  const added = [];
  const removed = [];
  for (const file of files) {
    const change = (after[file] ?? 0) - (before[file] ?? 0);
    if (change > 0) added.push({ file, change, now: after[file] ?? 0 });
    else if (change < 0) removed.push({ file, change, was: before[file] ?? 0 });
  }
  added.sort((a, b) => b.change - a.change);
  removed.sort((a, b) => a.change - b.change);
  return { added, removed };
}

/**
 * Print the delta for one ratchet, or say plainly that it cannot be computed.
 *
 * Silence would be worse than the old sample: a guard that prints nothing where the
 * explanation belongs reads as "no explanation exists", when the truth is "no tally was
 * recorded yet". Saying so is what gets the tally recorded.
 */
export function printDelta(label, before, after, log = console.error) {
  if (!before) {
    log(`\n  No recorded tally for ${label} yet, so this run cannot say which files moved it.`);
    log('  Run with RATCHET_WRITE_TALLY=1 on a green tree to record one.');
    return;
  }
  const { added, removed } = fileDelta(before, after);
  if (added.length === 0 && removed.length === 0) {
    log(`\n  No file changed its ${label} count since the recorded tally — the number moved`);
    log('  because a file was ADDED or REMOVED wholesale. Check the new files in this change.');
    return;
  }
  if (added.length > 0) {
    log(`\n  Files that ADDED to ${label} since the recorded tally:`);
    for (const { file, change, now } of added.slice(0, 20)) log(`    +${change}  ${file}  (now ${now})`);
    if (added.length > 20) log(`    … and ${added.length - 20} more`);
  }
  if (removed.length > 0) {
    log(`\n  Files that REMOVED from ${label}:`);
    for (const { file, change, was } of removed.slice(0, 10)) log(`    ${change}  ${file}  (was ${was})`);
    if (removed.length > 10) log(`    … and ${removed.length - 10} more`);
  }
}

/** The recorded tallies, or `{}` when the sidecar is absent or unreadable. */
export function readTallies(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Record the current tallies — only when explicitly asked.
 *
 * Writing on every green run would mean a guard that silently re-baselines itself, which
 * is the failure mode this whole family of ratchets exists to prevent. The env var makes
 * recording a decision somebody made.
 */
export function writeTallies(path, tallies) {
  if (process.env.RATCHET_WRITE_TALLY !== '1') return false;
  writeFileSync(path, `${JSON.stringify(tallies, null, 2)}\n`);
  return true;
}
