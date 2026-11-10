import { describe, expect, it } from 'vitest';
import { DEFAULT_RUN_DELTA_HISTORY_LABELS, runDeltaHistoryLabels } from '@builderforce/knowledge-graph-view';
import en from '@/i18n/messages/en.json';
import zh from '@/i18n/messages/zh.json';
import es from '@/i18n/messages/es.json';
import fr from '@/i18n/messages/fr.json';
import de from '@/i18n/messages/de.json';

/**
 * The run delta history and trend (PRD 41 §C11.3) read `runDelta.history.*`: every label in every locale, translated, with
 * the English placeholders — the VS Code webview ships the same five catalogs.
 */

type Tree = { [key: string]: unknown };

const read = (catalog: Tree) => (key: string): unknown =>
  key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Tree)[part] : undefined), (catalog.runDelta as Tree).history);

function leaves(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : leaves(v as Tree, `${prefix}${k}.`)));
}

const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

/** Pure templates: the same in a language that punctuates like English. */
const SAME_AS_ENGLISH = new Set(['cellTitle']);

describe('runDelta.history catalogs', () => {
  it('maps the English catalog onto exactly the package defaults', () => {
    expect(runDeltaHistoryLabels(read(en as Tree))).toEqual(DEFAULT_RUN_DELTA_HISTORY_LABELS);
  });

  it.each([['zh', zh], ['es', es], ['fr', fr], ['de', de]])('%s carries every label, translated, with the same placeholders', (locale, catalog) => {
    const english = read(en as Tree);
    const translated = read(catalog as Tree);
    const untranslated: string[] = [];
    for (const key of leaves(DEFAULT_RUN_DELTA_HISTORY_LABELS as unknown as Tree)) {
      const value = translated(key);
      expect(typeof value, `${locale}.${key}`).toBe('string');
      expect(holes(value as string), `${locale}.${key}`).toEqual(holes(english(key) as string));
      if (value === english(key) && !SAME_AS_ENGLISH.has(key)) untranslated.push(key);
    }
    expect(untranslated, `${locale}: English copies`).toEqual([]);
  });
});
