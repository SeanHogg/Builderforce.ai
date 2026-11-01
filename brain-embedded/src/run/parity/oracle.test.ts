/**
 * Guards the oracle list (`oracle.files.txt`): every test file that drives `startRun` is in it, and every entry exists.
 * The list is what CI runs for the Brain's run store (`release.yml`, `runOracle.mjs`), so a new test that drives a run cannot
 * slip past it: the list is derived the same way it was made. The parity directory runs whole, as its own CI step.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const DRIVES_A_RUN = /startRun\b|brainRunStore|startEngineRun|test\/continueHarness|brainRunHarness|draftHost|mirrorRun|test\/engineKit|from '\.\/harness'/;
/** The parity directory runs whole in CI (`release.yml`): its suites are not listed one by one. */
const RUNS_WHOLE_DIRS = [join('src', 'run', 'parity')];

function testFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) testFiles(p, out);
    else if (/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const listed = readFileSync(join(here, 'oracle.files.txt'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

describe('the oracle list', () => {
  it('names every test file that drives startRun, and nothing else', () => {
    const found = ['brain-embedded/src', 'clients/chrome/src', 'clients/vscode/src']
      .flatMap((d) => testFiles(join(root, d)))
      .filter((f) => !RUNS_WHOLE_DIRS.some((d) => f.includes(d)))
      .filter((f) => DRIVES_A_RUN.test(readFileSync(f, 'utf8')))
      .map((f) => relative(root, f).split(String.fromCharCode(92)).join('/'))
      .sort();
    expect(listed.slice().sort()).toEqual(found);
  });

  it('lists files that exist', () => {
    expect(listed.filter((f) => !existsSync(join(root, f)))).toEqual([]);
  });
});
