import { describe, expect, it } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS } from '@builderforce/knowledge-graph-view';
import en from '@/i18n/messages/en.json';
import zh from '@/i18n/messages/zh.json';
import es from '@/i18n/messages/es.json';
import fr from '@/i18n/messages/fr.json';
import de from '@/i18n/messages/de.json';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KNOWLEDGE_GRAPH_NAMESPACE, knowledgeGraphLabels } from './labels';

type Tree = { [key: string]: unknown };

const reader = (catalog: Tree) => (key: string): unknown =>
  key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Tree)[part] : undefined), catalog.knowledgeGraph);

function leaves(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : leaves(v as Tree, `${prefix}${k}.`)));
}

describe('knowledgeGraph labels adapter', () => {
  it('maps the English catalog onto exactly the package defaults', () => {
    expect(knowledgeGraphLabels(reader(en as Tree))).toEqual(DEFAULT_KNOWLEDGE_GRAPH_LABELS);
  });

  it.each([['zh', zh], ['es', es], ['fr', fr], ['de', de]])('%s carries every label, translated, with the same placeholders', (_lang, catalog) => {
    const read = reader(catalog as Tree);
    for (const key of leaves(DEFAULT_KNOWLEDGE_GRAPH_LABELS as unknown as Tree)) {
      const value = read(key);
      expect(typeof value, key).toBe('string');
      const english = reader(en as Tree)(key) as string;
      const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(holes(value as string), key).toEqual(holes(english));
    }
  });

  it('covers every Fix-with-agent request memory and the code pack stamp', () => {
    for (const key of ['cloneGroup', 'partitionViolation', 'cycle', 'unpartitioned', 'nearDuplicate', 'possibleSame', 'stale',
      'brokenLink', 'orphan', 'unusedFile', 'unusedExport', 'unusedDependency', 'violation', 'unlayered', 'unused', 'contradiction']) {
      expect(typeof reader(en as Tree)(`fix.${key}`), key).toBe('string');
    }
  });

  it('keeps the English default for a key a catalog lacks', () => {
    expect(knowledgeGraphLabels(() => undefined).title).toBe(DEFAULT_KNOWLEDGE_GRAPH_LABELS.title);
    expect(knowledgeGraphLabels((k) => `knowledgeGraph.${k}`).reviewFolder).toBe(DEFAULT_KNOWLEDGE_GRAPH_LABELS.reviewFolder);
  });

  it('keeps the English default when the host fallback returns the bare key (the VS Code webview)', () => {
    const labels = knowledgeGraphLabels((k) => k);
    expect(labels.emptyTitle).toBe(DEFAULT_KNOWLEDGE_GRAPH_LABELS.emptyTitle);
    expect(labels.reviewFolder).toBe(DEFAULT_KNOWLEDGE_GRAPH_LABELS.reviewFolder);
    const leaf = knowledgeGraphLabels((k) => k.split('.').pop());
    expect(leaf.fix.cloneGroup).toBe(DEFAULT_KNOWLEDGE_GRAPH_LABELS.fix.cloneGroup);
  });

  it('reads the namespace by the literal the webview trimmer can see, equal to the shared constant', () => {
    const src = readFileSync(join(__dirname, 'labels.ts'), 'utf8');
    expect(src).toContain(`useTranslations('${KNOWLEDGE_GRAPH_NAMESPACE}')`);
  });
});
