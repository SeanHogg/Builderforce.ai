import { describe, it, expect } from 'vitest';
import {
  blocksToMarkdown,
  mediaTypeForUrl,
  parseMarkdownToBlocks,
  textBlockKind,
  urlExtension,
} from './blockDocument';

/** Blocks minus their minted ids — what a round-trip is allowed to preserve. */
const shape = (markdown: string) =>
  parseMarkdownToBlocks(markdown).map(({ type, text, attrs }) => ({ type, text, attrs }));

describe('parseMarkdownToBlocks', () => {
  it('splits on blank lines', () => {
    expect(shape('one\n\ntwo')).toEqual([
      { type: 'text', text: 'one', attrs: {} },
      { type: 'text', text: 'two', attrs: {} },
    ]);
  });

  it('keeps a fenced code block whole, blank lines and all', () => {
    const blocks = shape('```ts\na\n\nb\n```\n\nafter');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.text).toBe('```ts\na\n\nb\n```');
    expect(blocks[1]!.text).toBe('after');
  });

  it('reads an image line as an image block', () => {
    expect(shape('![a cat](https://cdn/x.png)')).toEqual([
      { type: 'image', text: '', attrs: { label: 'a cat', url: 'https://cdn/x.png' } },
    ]);
  });

  it('reads a link to a video as a video block and one to a document as a file block', () => {
    expect(shape('[demo](https://cdn/x.mp4)')[0]).toMatchObject({ type: 'video' });
    expect(shape('[spec](https://cdn/x.pdf)')[0]).toMatchObject({ type: 'file' });
  });

  it('leaves an ORDINARY link as text — a sentence that is only a link is still a sentence', () => {
    expect(shape('[our docs](https://example.com)')[0]).toMatchObject({ type: 'text' });
  });

  it('gives an empty document one empty block, so there is somewhere to type', () => {
    expect(parseMarkdownToBlocks('')).toHaveLength(1);
    expect(parseMarkdownToBlocks('   \n\n  ')).toHaveLength(1);
  });
});

describe('round trip', () => {
  /**
   * The property the whole design rests on: blocks are a VIEW of markdown, so
   * opening a document and closing it without typing must not rewrite it, and the
   * five readers that consume the markdown must see what they saw before.
   */
  const documents = [
    '# Title\n\nA paragraph.\n\n- one\n- two\n\n> quoted\n\n```ts\nconst a = 1;\n```\n\n![shot](https://cdn/a.png)\n\n[clip](https://cdn/a.mp4)\n\n[spec](https://cdn/a.pdf)\n\n---\n\nLast word.',
    'Just one paragraph.',
    '![only an image](https://cdn/only.png)',
  ];

  it.each(documents)('re-serialises to the same markdown', (markdown) => {
    expect(blocksToMarkdown(parseMarkdownToBlocks(markdown))).toBe(markdown);
  });

  it.each(documents)('re-parses to the same blocks', (markdown) => {
    expect(shape(blocksToMarkdown(parseMarkdownToBlocks(markdown)))).toEqual(shape(markdown));
  });
});

describe('textBlockKind', () => {
  it.each([
    ['# Heading', 'heading'],
    ['###### Deep', 'heading'],
    ['- item', 'list'],
    ['1. item', 'list'],
    ['> quote', 'quote'],
    ['```ts\nx\n```', 'code'],
    ['---', 'rule'],
    ['ordinary words', 'paragraph'],
    ['#hashtag not a heading', 'paragraph'],
  ])('reads %o as %s', (text, kind) => {
    expect(textBlockKind(text)).toBe(kind);
  });
});

describe('urlExtension / mediaTypeForUrl', () => {
  it('ignores the query string, which is where a signed URL keeps its signature', () => {
    expect(urlExtension('https://cdn/a.mp4?exp=1&sig=abc')).toBe('mp4');
    expect(mediaTypeForUrl('https://cdn/a.mp4?exp=1&sig=abc')).toBe('video');
  });

  it('is null for a URL with no extension it recognises', () => {
    expect(mediaTypeForUrl('https://example.com/page')).toBeNull();
  });
});
