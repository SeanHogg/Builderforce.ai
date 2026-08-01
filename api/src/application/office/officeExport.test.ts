import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { parseMarkdownBlocks, parseSlides, parseInlineRuns } from './markdownBlocks';
import { markdownToDocx } from './docxWriter';
import { markdownToPptx } from './slidesRenderer';

const DOC = `# Q3 Plan

Intro **paragraph** with *emphasis*.

## Scope

- First item
- Second item

| Team | Cost |
| --- | --- |
| Core | 12 |
| Web | 8 |

\`\`\`csv
Team,Cost
Core,12
\`\`\`
`;

const DECK = `# Launch Deck

## Why now
- Market is moving
- We are ready
Note: keep this short

## Numbers

| Metric | Value |
| --- | --- |
| ARR | 1.2M |
`;

describe('parseMarkdownBlocks', () => {
  it('reads headings, paragraphs, lists, tables and fences', () => {
    const b = parseMarkdownBlocks(DOC);
    expect(b.map((x) => x.kind)).toEqual(['heading', 'paragraph', 'heading', 'list', 'table', 'code']);
    const table = b.find((x) => x.kind === 'table');
    expect(table).toMatchObject({ head: ['Team', 'Cost'], rows: [['Core', '12'], ['Web', '8']] });
    expect(b.find((x) => x.kind === 'list')).toMatchObject({ ordered: false, items: ['First item', 'Second item'] });
    expect(b.find((x) => x.kind === 'code')).toMatchObject({ lang: 'csv' });
  });

  it('splits inline emphasis into runs', () => {
    expect(parseInlineRuns('a **b** c *d*')).toEqual([
      { text: 'a ' }, { text: 'b', bold: true }, { text: ' c ' }, { text: 'd', italic: true },
    ]);
  });
});

describe('parseSlides', () => {
  it('makes one slide per heading, keeping notes and tables', () => {
    const slides = parseSlides(DECK);
    expect(slides.map((s) => s.title)).toEqual(['Launch Deck', 'Why now', 'Numbers']);
    expect(slides[1]?.bullets).toEqual(['Market is moving', 'We are ready']);
    expect(slides[1]?.note).toBe('keep this short');
    expect(slides[2]?.table?.rows).toEqual([['ARR', '1.2M']]);
  });
});

describe('markdownToDocx', () => {
  it('produces a zip with the three OOXML parts and well-formed body XML', () => {
    const bytes = markdownToDocx(DOC, 'Q3 Plan');
    // Zip local-file-header magic — a real .docx, not a text blob.
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);

    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/document.xml']);

    const xml = strFromU8(files['word/document.xml'] as Uint8Array);
    expect(xml.startsWith('<?xml')).toBe(true);
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('Q3 Plan');
    // Every opened tag closes: count the paired ones we emit.
    for (const tag of ['w:document', 'w:body', 'w:tbl', 'w:p']) {
      const open = xml.split(`<${tag}>`).length - 1 + (xml.split(`<${tag} `).length - 1);
      const close = xml.split(`</${tag}>`).length - 1;
      expect(close, `${tag} balance`).toBe(open);
    }
    // Content is escaped, so a stray & or < in the chat can't corrupt the part.
    expect(strFromU8(unzipSync(markdownToDocx('a & b < c'))['word/document.xml'] as Uint8Array)).toContain('a &amp; b &lt; c');
  });
});

describe('markdownToPptx', () => {
  it('produces a .pptx zip with one slide per section plus the title slide', async () => {
    const bytes = await markdownToPptx(DECK, 'Launch Deck');
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
    const files = Object.keys(unzipSync(bytes));
    expect(files).toContain('[Content_Types].xml');
    const slides = files.filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    // Title slide ("Launch Deck" heading has no body) + Why now + Numbers.
    expect(slides.length).toBe(3);
  });

  it('still renders when the reply has no headings at all', async () => {
    const bytes = await markdownToPptx('just one line of prose', 'Fallback');
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
  });
});
