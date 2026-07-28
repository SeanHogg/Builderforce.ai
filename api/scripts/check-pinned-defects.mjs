/**
 * check-pinned-defects — a KNOWN-BROKEN invariant may be pinned, never parked.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────────
 * `it.fails` is the honest way to record a defect you are not fixing this pass: the test
 * states the invariant, the suite stays green while it is open, and it turns RED the
 * moment someone fixes it. That is strictly better than deleting the test or writing a
 * comment nobody re-reads.
 *
 * It is also the perfect hiding place. A pinned defect is, by construction, a failing
 * assertion that CI reports as success. Three separate selector/guard asymmetries and two
 * budget leaks reached production on this codebase, and every one of them was a contract
 * nobody had written down anywhere a machine could check.
 *
 * So the deal is: pin whatever you like, but the Consolidated Gap Register must name the
 * file. Fixing the defect flips the test to a plain `it` and the register entry moves to
 * DONE.md — and if you forget the register, this fails the build before the pin can rot.
 *
 * Enforced both ways, deliberately:
 *   • a pinned test with no register entry ⇒ an untracked known defect;
 *   • a register entry naming a test file with no pin left ⇒ the defect was fixed and
 *     nobody closed the entry, which is how a roadmap becomes fiction.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROADMAP = path.resolve('..', 'ROADMAP.md');
const sourceRoot = path.resolve('src');

const testFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.test.ts')) testFiles.push(full);
  }
}
walk(sourceRoot);

/**
 * `it.fails(`, `test.fails(`, `it.fails.each(`, `describe.fails(` … anchored to the start
 * of a line so a doc comment DESCRIBING a pin ("this was `it.fails` for one commit") is
 * not mistaken for one. Comment bodies start with `*` or `//` and never match.
 */
const PIN = /^\s*(it|test|describe)\s*\.\s*fails\b/;

const pinned = [];
for (const filePath of testFiles) {
  const count = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter((l) => PIN.test(l)).length;
  if (count === 0) continue;
  pinned.push({ file: path.basename(filePath), rel: path.relative(process.cwd(), filePath), count });
}

let roadmap = '';
try {
  roadmap = fs.readFileSync(ROADMAP, 'utf8');
} catch {
  console.error(`check-pinned-defects: cannot read ${ROADMAP}. The gap register is the ledger for pinned defects.`);
  process.exit(1);
}

const problems = [];
for (const p of pinned) {
  if (!roadmap.includes(p.file)) {
    problems.push(
      `${p.rel} pins ${p.count} known-broken invariant(s) with \`it.fails\`, but ROADMAP.md's `
      + `Consolidated Gap Register never names \`${p.file}\`. Add an entry stating the defect, `
      + 'the evidence, and the blocker — a pinned defect that is not on the register is an '
      + 'untracked one.',
    );
  }
}

// The other direction, scoped to entries that CLAIM a pin. The register names test files
// for plenty of innocent reasons ("covered by", "add a case to"); only a line that says
// it is PINNED is making the claim this check verifies.
const pinnedNames = new Set(pinned.map((p) => p.file));
const CLAIMS_A_PIN = /\bit\s*\.\s*fails\b|\bpinn?(?:ed|s)\b/i;
for (const line of roadmap.split(/\r?\n/)) {
  if (!CLAIMS_A_PIN.test(line)) continue;
  for (const name of new Set(line.match(/[A-Za-z0-9._-]+\.test\.ts/g) ?? [])) {
    if (pinnedNames.has(name)) continue;
    if (!testFiles.some((f) => path.basename(f) === name)) continue; // file gone entirely
    problems.push(
      `ROADMAP.md still cites \`${name}\` as PINNING a defect, but that file has no \`it.fails\` `
      + 'left — the defect was fixed and the register entry was not moved to DONE.md.',
    );
  }
}

if (problems.length > 0) {
  console.error('Pinned-defect bookkeeping:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error(`\n${problems.length} problem(s). See api/scripts/check-pinned-defects.mjs.`);
  process.exit(1);
}
console.log(`check-pinned-defects: OK (${pinned.length} file(s) pinning known defects, all on the register)`);
