/**
 * Translating an imported document (PRD 42 · E2) — the use case behind the import offer
 * "Translate to <locale>". Pure: it takes the imported object and an engine, returns a NEW
 * object, and mutates nothing. It runs only on the person's explicit click; an import
 * never translates anything on its own.
 *
 * Only prose is sent to the engine. Fenced code, and blocks with no letters (rules, tables
 * of figures), are carried over verbatim, so a translated README keeps its code intact.
 */
import type { ImportedCanvasObject } from './ImportCanvasFile';

/** Translates the given texts, in order; null when the engine could not translate them all. */
export type TranslateTexts = (texts: string[]) => Promise<string[] | null>;

const FENCE = /^\s*(```|~~~)/;
const HAS_LETTER = /\p{L}/u;

/** The imported markdown a document object carries, or null for any other kind of object. */
export function translatableMarkdown(object: ImportedCanvasObject): string | null {
  if (object.kind !== 'document') return null;
  const markdown = object.data['markdown'];
  return typeof markdown === 'string' && markdown.trim() ? markdown : null;
}

/** A short prose sample for language detection — no code fences, bounded. */
export function languageSample(markdown: string, limit = 1_200): string {
  return splitBlocks(markdown).filter((block) => !block.code).map((block) => block.text).join('\n\n').slice(0, limit);
}

interface Block { text: string; code: boolean }

function splitBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let inFence = false;
  for (const chunk of markdown.split(/\n{2,}/)) {
    const opens = FENCE.test(chunk);
    // A fence that spans blank lines arrives as several chunks; keep every one of them verbatim.
    const code = inFence || opens;
    const fences = chunk.split('\n').filter((line) => FENCE.test(line)).length;
    if (fences % 2 === 1) inFence = !inFence;
    blocks.push({ text: chunk, code });
  }
  return blocks;
}

/** The document with its prose translated, or null when the engine could not (the original stays as imported). */
export async function translateImportedDocument(object: ImportedCanvasObject, translate: TranslateTexts): Promise<ImportedCanvasObject | null> {
  const markdown = translatableMarkdown(object);
  if (!markdown) return null;
  const blocks = splitBlocks(markdown);
  const slots = blocks.flatMap((block, index) => (!block.code && HAS_LETTER.test(block.text) ? [index] : []));
  const translated = slots.length ? await translate(slots.map((i) => blocks[i]!.text)) : [];
  if (!translated || translated.length !== slots.length) return null;
  const out = blocks.map((block) => block.text);
  for (const [n, index] of slots.entries()) out[index] = translated[n]!;
  return { kind: object.kind, data: { ...object.data, markdown: out.join('\n\n') } };
}
