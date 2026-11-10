import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_RUN_DELTA_LABELS,
  RUN_DELTA_CLAUSE_CODES,
  RUN_DELTA_EXCLUDED_REASONS,
  RUN_DELTA_METRIC_IDS,
  RUN_DELTA_NAMESPACE,
  RUN_DELTA_REASON_CODES,
  RUN_DELTA_TOOL_REASON_PREFIXES,
  labelKey,
  runDeltaLabels,
} from '@builderforce/knowledge-graph-view';
import en from '@/i18n/messages/en.json';
import zh from '@/i18n/messages/zh.json';
import es from '@/i18n/messages/es.json';
import fr from '@/i18n/messages/fr.json';
import de from '@/i18n/messages/de.json';

/**
 * The run delta card and panel (PRD 41 §C11) render the engine's CODES through the `runDelta.*`
 * catalog — the VS Code webview ships the same five web catalogs. Every code the engine can emit
 * must have a label in every locale, or the card would show a raw `guard-removed`.
 */

type Tree = { [key: string]: unknown };
const CATALOGS = { en, zh, es, fr, de } as unknown as Record<string, Tree>;

const read = (catalog: Tree) => (key: string): unknown =>
  key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Tree)[part] : undefined), catalog[RUN_DELTA_NAMESPACE]);

function leaves(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : leaves(v as Tree, `${prefix}${k}.`)));
}

const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

/**
 * The engine's own registries, read from its SOURCE (`@builderforce/run-delta`): the rule rows'
 * `id`s, the fact-finding kinds, and the `DimensionId` / `Verdict` unions of the contract. Read as
 * text rather than imported, so this catalog test does not execute the engine (and its analyzer
 * imports) to learn a list of names.
 */
const ENGINE = join(__dirname, '../../../../packages/run-delta/src');
const engineFile = (rel: string) => readFileSync(join(ENGINE, rel), 'utf8');
const literals = (block: string) => [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
const unionOf = (name: string) => literals(new RegExp(`export type ${name} =([^;]+);`).exec(engineFile('contract.ts'))![1]!);

function engineRuleIds(): string[] {
  const rows = readdirSync(join(ENGINE, 'rules'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'index.ts')
    .map((f) => engineFile(`rules/${f}`))
    .filter((src) => !src.includes('MetricRule'))
    .flatMap((src) => [...src.matchAll(/^ {4}id: '([a-z-]+)'/gm)].map((m) => m[1]!));
  const kinds = /FACT_FINDING_KINDS[^{]*\{([\s\S]*?)\n\};/.exec(engineFile('rules/factFindings.ts'))![1]!;
  return [...rows, ...[...kinds.matchAll(/^\s+'?([a-z-]+)'?:/gm)].map((m) => m[1]!)];
}

/** Every key the engine's codes resolve to, by label map. */
function requiredKeys(): string[] {
  const rules = engineRuleIds();
  expect(rules).toEqual(expect.arrayContaining(['guard-removed', 'test-deleted', 'clone-group', 'unused-file', 'rm-rf']));
  expect(rules.length).toBeGreaterThanOrEqual(31);
  return [
    ...rules.map((r) => `rules.${labelKey(r)}`),
    ...unionOf('DimensionId').map((d) => `dimensions.${labelKey(d)}`),
    ...unionOf('Verdict').map((v) => `verdicts.${labelKey(v)}`),
    ...RUN_DELTA_REASON_CODES.map((r) => `reasons.${labelKey(r)}`),
    ...RUN_DELTA_TOOL_REASON_PREFIXES.map((p) => `reasons.${labelKey(p)}`),
    ...RUN_DELTA_CLAUSE_CODES.map((c) => `clauses.${labelKey(c)}`),
    ...RUN_DELTA_METRIC_IDS.map((m) => `metrics.${labelKey(m)}`),
    ...RUN_DELTA_EXCLUDED_REASONS.map((r) => `excluded.${labelKey(r)}`),
  ];
}

/** Values that are legitimately identical to English in a locale (marks, templates, cognates). */
const SAME_AS_ENGLISH = new Set([
  'heuristicMark', 'metricValue', 'headline.sentenceNoClauses', 'headline.clause', 'headline.detail', 'headline.listSeparator',
  'headline.clauseSeparator', 'headline.sentence', 'paramsHeading', 'dimensions.performance', 'severities.info', 'severities.error',
  'reasons.notComparable',
]);

describe('runDelta catalogs', () => {
  it('maps the English catalog onto exactly the package defaults', () => {
    expect(runDeltaLabels(read(en as Tree))).toEqual(DEFAULT_RUN_DELTA_LABELS);
  });

  it('labels every rule id, dimension, verdict, reason, clause code, metric and excluded reason the engine can emit, in every locale', () => {
    const keys = requiredKeys();
    expect(keys.length).toBeGreaterThan(80);
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      const missing = keys.filter((key) => typeof read(catalog)(key) !== 'string');
      expect(missing, `${locale}.json runDelta is missing`).toEqual([]);
    }
  });

  it.each([['zh', zh], ['es', es], ['fr', fr], ['de', de]])('%s carries every label, translated, with the same placeholders', (locale, catalog) => {
    const english = read(en as Tree);
    const translated = read(catalog as Tree);
    const untranslated: string[] = [];
    for (const key of leaves(DEFAULT_RUN_DELTA_LABELS as unknown as Tree)) {
      const value = translated(key);
      expect(typeof value, `${locale}.${key}`).toBe('string');
      expect(holes(value as string), `${locale}.${key}`).toEqual(holes(english(key) as string));
      if (value === english(key) && !SAME_AS_ENGLISH.has(key)) untranslated.push(key);
    }
    // A cognate the same in one language ("Performance", "Info") is fine; an English copy is not.
    expect(untranslated, `${locale}: English copies`).toEqual([]);
  });

  it('knows every reason, clause code and metric id written in the engine and memory comparable()', () => {
    // The grep-style half: these are string literals, not exported lists, so a new one must land in `delta/codes.ts`.
    const sources = ['engine', 'rules']
      .flatMap((dir) => readdirSync(join(ENGINE, dir)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => join(ENGINE, dir, f)))
      .map((file) => readFileSync(file, 'utf8'));
    const found = (re: RegExp) => new Set(sources.flatMap((src) => [...src.matchAll(re)].map((m) => m[1]!)));

    const known = new Set<string>([...RUN_DELTA_REASON_CODES, ...RUN_DELTA_CLAUSE_CODES, ...RUN_DELTA_EXCLUDED_REASONS]);
    for (const code of found(/reasons(?:\.push\(|: \[|, )\s*'([a-z-]+)'/g)) expect(known, `reason '${code}'`).toContain(code);
    for (const code of found(/(?:code|reason): '([a-z-]+)'/g)) expect(known, `code '${code}'`).toContain(code);
    for (const code of found(/'([a-z]+(?:-[a-z]+)+)'\s*:\s*'[a-z]+(?:-[a-z]+)+'\)/g)) expect(known, `fallback '${code}'`).toContain(code);
    for (const id of found(/metricId: '([^']+)'/g)) expect(RUN_DELTA_METRIC_IDS as readonly string[], `metric '${id}'`).toContain(id);

    const memory = readFileSync(join(__dirname, '../../../node_modules/@seanhogg/builderforce-memory/dist/knowledge/comparability.js'), 'utf8');
    for (const [, code] of memory.matchAll(/reasons\.add\('([a-z-]+)'\)/g)) expect(known, `memory reason '${code}'`).toContain(code);
    for (const [, prefix] of memory.matchAll(/reasons\.add\(`([a-z-]+):\$\{/g)) expect(RUN_DELTA_TOOL_REASON_PREFIXES as readonly string[], `memory prefix '${prefix}'`).toContain(prefix);
  });
});
