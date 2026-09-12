import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAREER_RUNWAY_BANDS } from '@builderforce/creation-canvas-contract';
import en from '@/i18n/messages/en.json';
import zh from '@/i18n/messages/zh.json';
import es from '@/i18n/messages/es.json';
import fr from '@/i18n/messages/fr.json';
import de from '@/i18n/messages/de.json';
import { ACADEMIC_NAMESPACE } from './academicObjects';
import { CAREER_NAMESPACE } from './careerObjects';
import { FOUNDER_NAMESPACE } from './founderObjects';
import { HIRING_NAMESPACE } from './hiringObjects';
import { LEGAL_NAMESPACE } from './legalObjects';
import { OPERATIONS_NAMESPACE } from './operationsObjects';
import { PEOPLE_NAMESPACE } from './peopleObjects';
import { SELL_MOTION_NAMESPACE } from './sellMotionObjects';
import { SHARED_NAMESPACE } from './sharedCanvasObjects';

/**
 * Every verdict key a spec derivation can emit exists in all five catalogs.
 *
 * A verdict is a `specVerdict('key', …)` descriptor resolved at RENDER time under
 * `<namespace>.verdict.<key>` — so `check:i18n-keys`, which reads `t('…')` call sites,
 * cannot see one, and a missing key would reach the card as its raw dotted path. This
 * walks the SOURCE of every module that builds a verdict, reads each constructor call's
 * key (a literal, either arm of a literal ternary, or a template this file expands), and
 * resolves it under the namespace the call resolves in.
 *
 * It fails closed: a module that builds verdicts but has no namespace below, or a key
 * this cannot read statically, is a failure — not a skip.
 */

const LOCALES = { en, zh, es, fr, de } as Record<string, Record<string, unknown>>;
const LIB = resolve(__dirname);

/** The namespace a module's `specVerdict(...)` calls resolve under (the HOST vocabulary). */
const FILE_NAMESPACE: Record<string, string> = {
  'academicObjects.ts': ACADEMIC_NAMESPACE,
  'academic/derivations.ts': ACADEMIC_NAMESPACE, // imported only by academicObjects
  'careerObjects.ts': CAREER_NAMESPACE,
  'dataScienceObjects.ts': 'creationCanvas.dataScience',
  'founderObjects.ts': FOUNDER_NAMESPACE,
  'hiringObjects.ts': HIRING_NAMESPACE,
  'legalObjects.ts': LEGAL_NAMESPACE,
  'operationsObjects.ts': OPERATIONS_NAMESPACE,
  'peopleObjects.ts': PEOPLE_NAMESPACE,
  'sellMotionObjects.ts': SELL_MOTION_NAMESPACE,
  'sharedCanvasObjects.ts': SHARED_NAMESPACE,
};

/** Constructors that pin their own namespace, whatever the host kind. */
const PINNED_CONSTRUCTORS: Record<string, string> = { founderVerdict: FOUNDER_NAMESPACE };

/** Keys built from a template, and the values the template can take. */
const TEMPLATE_KEYS: Record<string, readonly string[]> = {
  'pressure.${band}': ['none', ...CAREER_RUNWAY_BANDS.map((entry) => entry.band)].map((band) => `pressure.${band}`),
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** The first argument's source text of a call whose `(` is at `open`. */
function firstArgument(code: string, open: number): string {
  let depth = 0;
  for (let index = open + 1; index < code.length; index += 1) {
    const char = code[index];
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') {
      if (depth === 0) return code.slice(open + 1, index);
      depth -= 1;
    } else if (char === ',' && depth === 0) return code.slice(open + 1, index);
  }
  return code.slice(open + 1);
}

interface EmittedKey { file: string; namespace: string; key: string }

function emittedKeys(): { keys: EmittedKey[]; problems: string[] } {
  const keys: EmittedKey[] = [];
  const problems: string[] = [];
  const constructors = ['specVerdict', ...Object.keys(PINNED_CONSTRUCTORS)];
  const call = new RegExp(`\\b(${constructors.join('|')})\\(`, 'g');
  for (const file of sourceFiles(LIB)) {
    const rel = relative(LIB, file).split('\\').join('/');
    if (rel === 'specObjects.ts') continue; // the constructor's own definition and docs
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
    for (const match of code.matchAll(call)) {
      const before = code.slice(Math.max(0, match.index - 9), match.index);
      if (/function\s*$/.test(before)) continue; // a wrapper's own declaration
      const constructor = match[1]!;
      const arg = firstArgument(code, match.index + match[0].length - 1).trim();
      if (constructor === 'specVerdict' && arg === 'key' && rel === 'founderObjects.ts') continue; // founderVerdict's body
      const namespace = PINNED_CONSTRUCTORS[constructor] ?? FILE_NAMESPACE[rel];
      if (!namespace) {
        problems.push(`${rel}: builds a verdict but has no namespace in FILE_NAMESPACE`);
        continue;
      }
      const template = arg.match(/^`([^`]*)`$/);
      if (template) {
        const expanded = TEMPLATE_KEYS[template[1]!];
        if (!expanded) problems.push(`${rel}: template key ${arg} is not in TEMPLATE_KEYS`);
        for (const key of expanded ?? []) keys.push({ file: rel, namespace, key });
        continue;
      }
      const literals = [...arg.matchAll(/'([^']+)'|"([^"]+)"/g)].map((found) => found[1] ?? found[2]!);
      if (literals.length === 0) {
        problems.push(`${rel}: verdict key \`${arg}\` cannot be read statically`);
        continue;
      }
      for (const key of literals) keys.push({ file: rel, namespace, key });
    }
  }
  return { keys, problems };
}

function lookup(catalog: Record<string, unknown>, path: string): unknown {
  let node: unknown = catalog;
  for (const part of path.split('.')) {
    if (!node || typeof node !== 'object' || !(part in (node as object))) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

describe('spec verdict keys', () => {
  const { keys, problems } = emittedKeys();

  it('reads every verdict constructor call statically', () => {
    expect(problems).toEqual([]);
    // A scan that found nothing would pass the next test vacuously.
    expect(keys.length).toBeGreaterThan(40);
  });

  it.each(Object.keys(LOCALES))('every emitted verdict key resolves to a message in %s', (locale) => {
    const missing = keys
      .map(({ file, namespace, key }) => ({ file, path: `${namespace}.verdict.${key}` }))
      .filter(({ path }) => typeof lookup(LOCALES[locale]!, path) !== 'string')
      .map(({ file, path }) => `${path}  (${file})`);
    expect([...new Set(missing)]).toEqual([]);
  });
});
