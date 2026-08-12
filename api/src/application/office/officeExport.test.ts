import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { parseMarkdownBlocks, parseSlides, parseInlineRuns } from './markdownBlocks';
import { markdownToDocx } from './docxWriter';
import { markdownToPptx } from './slidesRenderer';
import { columnName, rowsToXlsx } from './xlsxWriter';

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

  it('applies resume template semantics to Word output', () => {
    const bytes = markdownToDocx('# Ada\n\n## Experience\n\n- Built engines', 'Ada', {
      accent: '#047857', font: 'mono', density: 'compact', columns: 2,
    });
    const xml = strFromU8(unzipSync(bytes)['word/document.xml'] as Uint8Array);
    expect(xml).toContain('w:color w:val="047857"');
    expect(xml).toContain('w:ascii="Consolas"');
    expect(xml).toContain('<w:cols w:num="2" w:space="720"/>');
    expect(xml).toContain('<w:sz w:val="35"/>');
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

describe('rowsToXlsx', () => {
  const read = (bytes: Uint8Array) => {
    const files = unzipSync(bytes);
    return {
      names: Object.keys(files).sort(),
      sheet: strFromU8(files['xl/worksheets/sheet1.xml']!),
      workbook: strFromU8(files['xl/workbook.xml']!),
    };
  };

  it('writes every part Excel needs to open the workbook', () => {
    const { names } = read(rowsToXlsx({ columns: ['Team'], rows: [['Core']] }));
    expect(names).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels',
      'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml',
    ]);
  });

  it('keeps a number a number and text text — the thing CSV cannot do', () => {
    const { sheet } = read(rowsToXlsx({ columns: ['Plan', 'Price', 'Code'], rows: [['Pro', 40, '01234']] }));
    expect(sheet).toContain('<c r="B2"><v>40</v></c>');
    expect(sheet).toContain('<c r="C2" t="inlineStr"><is><t xml:space="preserve">01234</t></is></c>');
  });

  it('writes a header band, freezes it, and filters on it', () => {
    const { sheet } = read(rowsToXlsx({ columns: ['Team', 'Cost'], rows: [['Core', 12]] }));
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Team</t></is></c>');
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('<autoFilter ref="A1:B2"/>');
  });

  it('pads a short row instead of shifting its cells left', () => {
    const { sheet } = read(rowsToXlsx({ columns: ['A', 'B', 'C'], rows: [['only']] }));
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">only</t></is></c>');
    expect(sheet).toContain('<c r="B2"/><c r="C2"/>');
  });

  it('escapes markup and strips characters XML cannot carry', () => {
    const { sheet } = read(rowsToXlsx({ columns: ['X'], rows: [['a <b> & \u0007c']] }));
    expect(sheet).toContain('a &lt;b&gt; &amp; c');
  });

  it('normalizes a sheet name Excel would reject', () => {
    expect(read(rowsToXlsx({ columns: ['A'], rows: [], title: 'Q3 [draft]: pricing/costs' })).workbook)
      .toContain('name="Q3 draft pricing costs"');
    expect(read(rowsToXlsx({ columns: ['A'], rows: [], title: '   ' })).workbook).toContain('name="Sheet1"');
    expect(read(rowsToXlsx({ columns: ['A'], rows: [], title: 'x'.repeat(60) })).workbook).toContain(`name="${'x'.repeat(31)}"`);
  });

  it('names columns past Z the way a spreadsheet does', () => {
    expect(columnName(0)).toBe('A');
    expect(columnName(25)).toBe('Z');
    expect(columnName(26)).toBe('AA');
    expect(columnName(701)).toBe('ZZ');
  });
});
