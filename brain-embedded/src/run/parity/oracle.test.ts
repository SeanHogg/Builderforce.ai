/**
 * Guards the oracle list (`oracle.files.txt`): every test file that drives `startRun` is in it, and every entry exists.
 * The oracle is only an oracle if a new test cannot slip past it, so the list is derived the same way it was made.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const DRIVES_A_RUN = /startRun\b|brainRunStore|startEngineRun|driveRun|test\/continueHarness|brainRunHarness|draftHost|mirrorRun/;
/** A test that names BOTH engines itself (`engineKit`, the area harnesses under `run/areaR/`) is a parity test, not an oracle: the oracle's engine is the environment's. */
const CHOOSES_ITS_OWN_ENGINE = /engineKit|bothEngines/;
const OWN_ENGINE_DIRS = [join('src', 'run', 'areaR'), join('src', 'run', 'parity')];

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
      .filter((f) => !OWN_ENGINE_DIRS.some((d) => f.includes(d)))
      .filter((f) => { const text = readFileSync(f, 'utf8'); return DRIVES_A_RUN.test(text) && !CHOOSES_ITS_OWN_ENGINE.test(text); })
      .map((f) => relative(root, f).split('\').join('/'))
      .sort();
    expect(listed.slice().sort()).toEqual(found);
  });

  it('lists files that exist', () => {
    expect(listed.filter((f) => !existsSync(join(root, f)))).toEqual([]);
  });
});
