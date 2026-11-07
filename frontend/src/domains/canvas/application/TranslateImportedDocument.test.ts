import { describe, expect, it, vi } from 'vitest';
import type { ImportedCanvasObject } from './ImportCanvasFile';
import { languageSample, translatableMarkdown, translateImportedDocument } from './TranslateImportedDocument';

const doc = (markdown: string): ImportedCanvasObject => ({ kind: 'document', data: { title: 'a.md', markdown } });

describe('translateImportedDocument', () => {
  it('translates prose, keeps fenced code and figure-only blocks verbatim, and does not mutate the input', async () => {
    const source = doc('Hola mundo\n\n```ts\nconst x = 1;\n\nconst y = 2;\n```\n\n---\n\nAdios');
    const before = JSON.stringify(source);
    const translate = vi.fn(async (texts: string[]) => texts.map((t) => `<${t}>`));
    const out = await translateImportedDocument(source, translate);
    expect(translate).toHaveBeenCalledWith(['Hola mundo', 'Adios']);
    expect(out?.data['markdown']).toBe('<Hola mundo>\n\n```ts\nconst x = 1;\n\nconst y = 2;\n```\n\n---\n\n<Adios>');
    expect(JSON.stringify(source)).toBe(before);
  });

  it('returns null when the engine cannot translate, leaving the import as it is', async () => {
    expect(await translateImportedDocument(doc('Hola'), async () => null)).toBeNull();
  });

  it('only documents carry translatable text', () => {
    expect(translatableMarkdown({ kind: 'image', data: {} })).toBeNull();
    expect(languageSample('Hola\n\n```\ncode\n```')).toBe('Hola');
  });
});
