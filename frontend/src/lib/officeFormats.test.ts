import { describe, expect, it } from 'vitest';
import {
  PAGE_BREAK_MARKER, decodeXmlText, docxXmlToMarkdown, openZip, readDocx, readPdf, readPptx, readXlsx, rtfToText,
} from './officeFormats';

const encoder = new TextEncoder();

/**
 * A ZIP written with STORED members. The reader's inflate path needs
 * `DecompressionStream`, which the OOXML structure under test does not — this
 * keeps the tests on the parsing, not on the platform's codec.
 */
function makeZip(entries: Record<string, string>): Uint8Array {
  const files = Object.entries(entries).map(([name, content]) => ({ name: encoder.encode(name), data: encoder.encode(content) }));
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const local = new Uint8Array(30 + file.name.length + file.data.length);
    const header = new DataView(local.buffer);
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(8, 0, true);
    header.setUint32(18, file.data.length, true);
    header.setUint32(22, file.data.length, true);
    header.setUint16(26, file.name.length, true);
    local.set(file.name, 30);
    local.set(file.data, 30 + file.name.length);
    locals.push(local);

    const central = new Uint8Array(46 + file.name.length);
    const record = new DataView(central.buffer);
    record.setUint32(0, 0x02014b50, true);
    record.setUint16(10, 0, true);
    record.setUint32(20, file.data.length, true);
    record.setUint32(24, file.data.length, true);
    record.setUint16(28, file.name.length, true);
    record.setUint32(42, offset, true);
    central.set(file.name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const trailer = new DataView(end.buffer);
  trailer.setUint32(0, 0x06054b50, true);
  trailer.setUint16(8, files.length, true);
  trailer.setUint16(10, files.length, true);
  trailer.setUint32(12, centralSize, true);
  trailer.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, end];
  const archive = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let cursor = 0;
  for (const part of parts) { archive.set(part, cursor); cursor += part.length; }
  return archive;
}

const DOCUMENT_XML = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Quarterly review</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Revenue grew </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>18%</w:t></w:r><w:r><w:t> against plan &amp; forecast.</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>Expand EMEA</w:t></w:r></w:p>
<w:p><w:r><w:br w:type="page"/></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Risks</w:t></w:r></w:p>
<w:tbl>
<w:tr><w:tc><w:p><w:r><w:t>Risk</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Owner</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>Churn</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Dana</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>
</w:body></w:document>`;

describe('openZip', () => {
  it('lists and reads stored members', async () => {
    const archive = openZip(makeZip({ 'a/one.xml': '<one/>', 'two.txt': 'hello' }));
    expect(archive?.names).toEqual(['a/one.xml', 'two.txt']);
    expect(await archive?.readText('two.txt')).toBe('hello');
    expect(await archive?.read('missing.txt')).toBeNull();
  });

  it('is null for bytes that are not an archive', () => {
    expect(openZip(encoder.encode('not a zip at all'))).toBeNull();
  });
});

describe('docxXmlToMarkdown', () => {
  const converted = docxXmlToMarkdown(DOCUMENT_XML);

  it('reads headings, emphasis, lists, and entities', () => {
    expect(converted.markdown).toContain('# Quarterly review');
    expect(converted.markdown).toContain('Revenue grew **18%** against plan & forecast.');
    expect(converted.markdown).toContain('1. Expand EMEA');
    expect(converted.markdown).toContain('## Risks');
  });

  it('reads a table as a markdown table', () => {
    expect(converted.markdown).toContain('| Risk | Owner |');
    expect(converted.markdown).toContain('| Churn | Dana |');
  });

  it('puts a declared page break before the heading that follows it, not after', () => {
    const [first, second] = converted.markdown.split(PAGE_BREAK_MARKER);
    expect(converted.authoredPages).toBe(2);
    expect(first).toContain('Expand EMEA');
    expect(first).not.toContain('Risks');
    expect(second).toContain('## Risks');
  });

  it('reports a single page when the source declared no breaks', () => {
    const plain = docxXmlToMarkdown('<w:body><w:p><w:r><w:t>Just one page</w:t></w:r></w:p></w:body>');
    expect(plain.authoredPages).toBe(1);
    expect(plain.markdown).toBe('Just one page');
  });
});

describe('readDocx', () => {
  it('reads the body and the declared title out of the container', async () => {
    const read = await readDocx(makeZip({
      'word/document.xml': DOCUMENT_XML,
      'docProps/core.xml': '<cp:coreProperties><dc:title>Q3 review</dc:title></cp:coreProperties>',
    }));
    expect(read?.title).toBe('Q3 review');
    expect(read?.markdown).toContain('# Quarterly review');
  });

  it('is null when the container holds no document part', async () => {
    expect(await readDocx(makeZip({ 'word/styles.xml': '<styles/>' }))).toBeNull();
  });
});

describe('readXlsx', () => {
  const workbook = {
    'xl/workbook.xml': '<workbook><sheets><sheet name="Pipeline" sheetId="1" r:id="rId1"/><sheet name="Costs" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Region</t></si><si><t>Deals</t></si><si><t>EMEA</t></si><si><t>APAC</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>12</v></c></row>'
      + '<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>7</v></c></row>'
      + '</sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="inlineStr"><is><t>Item</t></is></c></row>'
      + '<row r="2"><c r="A2" t="inlineStr"><is><t>Hosting</t></is></c></row>'
      + '</sheetData></worksheet>',
  };

  it('reads every sheet, resolving shared strings and numbers', async () => {
    const sheets = await readXlsx(makeZip(workbook));
    expect(sheets?.map((sheet) => sheet.name)).toEqual(['Pipeline', 'Costs']);
    expect(sheets?.[0]?.columns).toEqual(['Region', 'Deals']);
    expect(sheets?.[0]?.rows).toEqual([{ Region: 'EMEA', Deals: 12 }, { Region: 'APAC', Deals: 7 }]);
    expect(sheets?.[1]?.rows).toEqual([{ Item: 'Hosting' }]);
  });

  it('places cells by their reference, so a skipped cell does not shift the row', async () => {
    const sheets = await readXlsx(makeZip({
      ...workbook,
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData>'
        + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
        + '<row r="2"><c r="B2"><v>9</v></c></row>'
        + '</sheetData></worksheet>',
    }));
    expect(sheets?.[0]?.rows).toEqual([{ Region: '', Deals: 9 }]);
  });

  it('renders a date-formatted serial as a date rather than a number', async () => {
    const sheets = await readXlsx(makeZip({
      ...workbook,
      'xl/styles.xml': '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData>'
        + '<row r="1"><c r="A1" t="s"><v>0</v></c></row>'
        + '<row r="2"><c r="A2" s="1"><v>45231</v></c></row>'
        + '</sheetData></worksheet>',
    }));
    expect(sheets?.[0]?.rows[0]?.Region).toBe('2023-11-01');
  });
});

describe('readPptx', () => {
  it('reads slides in presentation order, preferring the title placeholder', async () => {
    const slides = await readPptx(makeZip({
      'ppt/slides/slide1.xml': '<p:sld><p:sp><p:nvSpPr><p:ph type="title"/></p:nvSpPr><a:p><a:r><a:t>Why now</a:t></a:r></a:p></p:sp>'
        + '<p:sp><a:p><a:t>Budget cycle</a:t></a:p><a:p><a:t>Competitor gap</a:t></a:p></p:sp></p:sld>',
      'ppt/slides/slide2.xml': '<p:sld><p:sp><a:p><a:t>Roadmap</a:t></a:p><a:p><a:t>Q1 launch</a:t></a:p></p:sp></p:sld>',
      'ppt/slides/slide10.xml': '<p:sld><p:sp><a:p><a:t>Appendix</a:t></a:p></p:sp></p:sld>',
    }));
    expect(slides?.map((slide) => slide.title)).toEqual(['Why now', 'Roadmap', 'Appendix']);
    expect(slides?.[0]?.bullets).toEqual(['Budget cycle', 'Competitor gap']);
    expect(slides?.[1]?.bullets).toEqual(['Q1 launch']);
  });
});

describe('rtfToText', () => {
  it('keeps paragraphs and drops control words', () => {
    expect(rtfToText('{\\rtf1\\ansi {\\fonttbl\\f0 Arial;}First line\\par Second line}')).toBe('First line\nSecond line');
  });

  it('drops nested metadata tables instead of reading them as body text', () => {
    const source = '{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}{\\f1 Times New Roman;}}{\\colortbl;\\red0\\green0\\blue0;}'
      + '{\\*\\generator Word}\\b Heading\\b0\\par Body \\u8212 ? text\\par}';
    expect(rtfToText(source)).toBe('Heading\nBody — text');
  });

  it('decodes escaped braces and hex characters', () => {
    expect(rtfToText('{\\rtf1 caf\\\'e9 \\{braced\\}}')).toBe('café {braced}');
  });

  it('is empty for anything that is not RTF', () => {
    expect(rtfToText('# Just markdown')).toBe('');
  });
});

describe('decodeXmlText', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeXmlText('a &amp; b &lt;c&gt; &#8212; &#x2014;')).toBe('a & b <c> — —');
  });
});

/**
 * A PDF written the way every modern producer writes one: a subset CID font
 * under `/Encoding /Identity-H`, hex strings holding GLYPH INDICES rather than
 * characters, and a `/ToUnicode` CMap that maps them back. Assembled here rather
 * than checked in as a binary so the shape under test is readable, and written
 * with uncompressed streams so the assertions are about the parser and not about
 * the platform's inflate.
 */
function makePdf(options: { contentsAsArrayObject?: boolean } = {}): Uint8Array {
  // Glyph indices are arbitrary; the CMap below is the only thing that gives
  // them meaning, which is exactly the property under test.
  const glyphs: Record<string, string> = { S: '0024', e: '0048', a: '0044', n: '0051', ' ': '0003', H: '002B', o: '0052', g: '004A' };
  const hex = (word: string) => [...word].map((character) => glyphs[character] ?? '0003').join('');
  const cmap = [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '1 begincodespacerange <0000> <FFFF> endcodespacerange',
    `${Object.keys(glyphs).length} beginbfchar`,
    ...Object.entries(glyphs).map(([character, code]) => `<${code}> <${character.charCodeAt(0).toString(16).padStart(4, '0')}>`),
    'endbfchar',
    'endcmap CMapName currentdict /CMap defineresource pop end end',
  ].join('\n');
  const content = [
    'BT', '/F1 12 Tf', '1 0 0 -1 72 100 Tm', `[<${hex('Sean Hogg')}>] TJ`, 'ET',
    'BT', '/F1 12 Tf', '1 0 0 -1 72 120 Tm', `[<${hex('Sean')}>] TJ`, 'ET',
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    options.contentsAsArrayObject
      ? '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 9 0 R >>'
      : '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type0 /BaseFont /AAAAAA+Test /Encoding /Identity-H /DescendantFonts [ << /Type /Font /Subtype /CIDFontType2 /BaseFont /AAAAAA+Test /DW 600 /W [3 [300]] >> ] /ToUnicode 6 0 R >>',
    `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`,
    '<< /Unused true >>',
    '<< /Unused true >>',
    '[ 4 0 R ]',
  ];
  const body = objects.map((dict, index) => `${index + 1} 0 obj\n${dict}\nendobj\n`).join('');
  return encoder.encode(`%PDF-1.7\n${body}trailer\n<< /Root 1 0 R >>\n%%EOF\n`);
}

describe('readPdf', () => {
  it('reads a subset CID font through its ToUnicode CMap instead of showing glyph indices', async () => {
    const document = await readPdf(makePdf());
    expect(document?.pageCount).toBe(1);
    expect(document?.text).toContain('Sean Hogg');
  });

  it('keeps separately positioned lines apart', async () => {
    const document = await readPdf(makePdf());
    expect(document?.text?.split('\n').filter(Boolean)).toEqual(['Sean Hogg', 'Sean']);
  });

  it('follows a /Contents reference that points at an array of streams', async () => {
    const document = await readPdf(makePdf({ contentsAsArrayObject: true }));
    expect(document?.text).toContain('Sean Hogg');
  });

  it('is null for bytes that are not a PDF', async () => {
    expect(await readPdf(encoder.encode('# Just markdown'))).toBeNull();
  });

  it('reports pages without text rather than pretending to have read them', async () => {
    const page = '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>';
    const drawing = '0 0 612 792 re\nf';
    const body = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      page,
      `<< /Length ${drawing.length} >>\nstream\n${drawing}\nendstream`,
    ].map((dict, index) => `${index + 1} 0 obj\n${dict}\nendobj\n`).join('');
    const document = await readPdf(encoder.encode(`%PDF-1.7\n${body}%%EOF\n`));
    expect(document?.pageCount).toBe(1);
    expect(document?.text).toBeNull();
  });
});
