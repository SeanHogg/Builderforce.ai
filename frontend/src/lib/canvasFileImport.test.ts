import { describe, expect, it } from 'vitest';
import { importCanvasFile, type ImportTranslator } from './canvasFileImport';
import { PAGE_BREAK_MARKER } from './officeFormats';

/** Every visible string comes from the catalog, so the tests assert on the key
 * rather than on English that a translator is free to change. */
const t: ImportTranslator = (key, values) => `${key}(${Object.entries(values ?? {}).map(([name, value]) => `${name}=${value}`).join(',')})`;

/**
 * `BlobPart` narrowed to `ArrayBufferView<ArrayBuffer>`, so a `Uint8Array` built by the
 * ZIP helper below is accepted. The DOM lib's `Uint8Array` is generic over
 * `ArrayBufferLike` (it may sit on a `SharedArrayBuffer`), which `BlobPart` will not
 * take — a `Blob` cannot be backed by shared memory. Every buffer here is a plain
 * `ArrayBuffer`, so the copy is what proves it rather than a cast that asserts it.
 */
const file = (name: string, body: string | Uint8Array, type = '') =>
  new File([typeof body === 'string' ? body : new Uint8Array(body)], name, { type });

const encoder = new TextEncoder();

/** A STORED-member ZIP, matching the helper in officeFormats.test.ts. */
function makeZip(entries: Record<string, string>): Uint8Array {
  const files = Object.entries(entries).map(([name, content]) => ({ name: encoder.encode(name), data: encoder.encode(content) }));
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of files) {
    const local = new Uint8Array(30 + entry.name.length + entry.data.length);
    const header = new DataView(local.buffer);
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint32(18, entry.data.length, true);
    header.setUint32(22, entry.data.length, true);
    header.setUint16(26, entry.name.length, true);
    local.set(entry.name, 30);
    local.set(entry.data, 30 + entry.name.length);
    locals.push(local);

    const central = new Uint8Array(46 + entry.name.length);
    const record = new DataView(central.buffer);
    record.setUint32(0, 0x02014b50, true);
    record.setUint32(20, entry.data.length, true);
    record.setUint32(24, entry.data.length, true);
    record.setUint16(28, entry.name.length, true);
    record.setUint32(42, offset, true);
    central.set(entry.name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const end = new Uint8Array(22);
  const trailer = new DataView(end.buffer);
  trailer.setUint32(0, 0x06054b50, true);
  trailer.setUint16(8, files.length, true);
  trailer.setUint16(10, files.length, true);
  trailer.setUint32(12, centrals.reduce((total, part) => total + part.length, 0), true);
  trailer.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, end];
  const archive = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let cursor = 0;
  for (const part of parts) { archive.set(part, cursor); cursor += part.length; }
  return archive;
}

describe('importCanvasFile', () => {
  it('reads a CSV as a queryable Dataset, not an opaque attachment', async () => {
    const imported = await importCanvasFile(file('pipeline.csv', 'Region,Deals\nEMEA,12\nAPAC,7\n', 'text/csv'), t);
    const [object] = imported.objects;
    expect(object?.kind).toBe('dataset');
    expect(object?.data.columns).toEqual(['Region', 'Deals']);
    expect(object?.data.rowCount).toBe(2);
    expect(object?.data.profile).toHaveLength(2);
    expect(imported.notice).toContain('noticeDataset');
    expect(imported.suggestedPrompt).toContain('promptData');
  });

  it('reads a Word file as a document with the pages its author declared', async () => {
    const bytes = makeZip({
      'word/document.xml': '<w:body>'
        + '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Findings</w:t></w:r></w:p>'
        + '<w:p><w:r><w:t>Page one body.</w:t></w:r></w:p>'
        + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
        + '<w:p><w:r><w:t>Page two body.</w:t></w:r></w:p>'
        + '</w:body>',
    });
    const imported = await importCanvasFile(file('report.docx', bytes), t);
    const [object] = imported.objects;
    expect(object?.kind).toBe('document');
    expect(String(object?.data.markdown)).toContain('# Findings');
    expect(String(object?.data.markdown).split(PAGE_BREAK_MARKER)).toHaveLength(2);
    expect(object?.data.pageCount).toBe(2);
    expect(object?.data.sourceFormat).toBe('DOCX');
    expect(imported.suggestedPrompt).toContain('promptDocument');
  });

  it('reads a workbook as one editable sheet object carrying every tab', async () => {
    const bytes = makeZip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Pipeline" r:id="rId1"/><sheet name="Costs" r:id="rId2"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Region</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>EMEA</t></is></c></row></sheetData>',
      'xl/worksheets/sheet2.xml': '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Item</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Hosting</t></is></c></row></sheetData>',
    });
    const imported = await importCanvasFile(file('book.xlsx', bytes), t);
    expect(imported.objects).toHaveLength(1);
    const [object] = imported.objects;
    expect(object?.kind).toBe('spreadsheet');
    expect(object?.data.activeSheet).toBe('Pipeline');
    expect((object?.data.sheets as Array<{ name: string }>).map((sheet) => sheet.name)).toEqual(['Pipeline', 'Costs']);
    expect(object?.data.columns).toEqual(['Region']);
    expect(imported.notice).toContain('noticeWorkbook');
  });

  it('reads a deck as slides', async () => {
    const bytes = makeZip({
      'ppt/slides/slide1.xml': '<p:sld><p:sp><a:p><a:t>Why now</a:t></a:p><a:p><a:t>Budget cycle</a:t></a:p></p:sp></p:sld>',
    });
    const imported = await importCanvasFile(file('deck.pptx', bytes), t);
    const [object] = imported.objects;
    expect(object?.kind).toBe('slides');
    expect(object?.data.items).toEqual([{ title: 'Why now', bullets: ['Budget cycle'] }]);
    expect(imported.suggestedPrompt).toContain('promptDeck');
  });

  it('reads markdown as a document and source as code', async () => {
    const document = await importCanvasFile(file('notes.md', '# Notes\n\nBody text.', 'text/markdown'), t);
    expect(document.objects[0]?.kind).toBe('document');
    expect(document.objects[0]?.data.markdown).toContain('# Notes');

    const code = await importCanvasFile(file('worker.ts', 'export const value = 1;\n'), t);
    expect(code.objects[0]?.kind).toBe('code');
    expect(code.objects[0]?.data.language).toBe('typescript');
  });

  it('still lands an unreadable container on the board, labelled honestly', async () => {
    const imported = await importCanvasFile(file('broken.docx', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])), t);
    const [object] = imported.objects;
    expect(object?.kind).toBe('file');
    expect(object?.data.fileName).toBe('broken.docx');
    expect(imported.notice).toContain('noticeFile');
  });

  it('routes every visible string through the catalog', async () => {
    const seen: string[] = [];
    const record: ImportTranslator = (key, values) => { seen.push(key); return t(key, values); };
    const imported = await importCanvasFile(file('pipeline.csv', 'A,B\n1,2\n', 'text/csv'), record);
    expect(seen).toContain('statusImported');
    expect(Object.values(imported.objects[0]!.data).some((value) => typeof value === 'string' && /[A-Z][a-z]+ [a-z]+/.test(value) && !value.includes('('))).toBe(false);
  });
});
