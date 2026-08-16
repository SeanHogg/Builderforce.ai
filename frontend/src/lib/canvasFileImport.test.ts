// @vitest-environment jsdom
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
  it('opens a draw.io file as an editable Diagram object', async () => {
    const xml = '<mxfile><diagram><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram></mxfile>';
    const imported = await importCanvasFile(file('system.drawio', xml, 'application/vnd.jgraph.mxfile'), t);
    expect(imported.objects[0]).toMatchObject({ kind: 'diagram', data: { fileName: 'system.drawio', diagramFormat: 'drawio', diagram: xml } });
  });

  it('opens every text notation the canvas can also write, verbatim', async () => {
    // A notation with a writer is stored EXACTLY as the person gave it. The
    // file they get back out is the file they put in — no round-trip loss to a
    // conversion nobody asked for.
    const cases: Array<[string, string, string]> = [
      ['flow.mmd', 'flowchart TD\n  a[Draft] --> b[Ship]', 'mermaid'],
      ['arch.puml', '@startuml\nrectangle "Web" as w\ndatabase "DB" as d\nw --> d\n@enduml', 'plantuml'],
      ['deps.gv', 'digraph g { a [label="API"]; b [label="DB"]; a -> b; }', 'dot'],
    ];
    for (const [name, body, format] of cases) {
      const imported = await importCanvasFile(file(name, body), t);
      expect(imported.objects[0], name).toMatchObject({ kind: 'diagram', data: { diagramFormat: format, diagram: body } });
      expect(imported.notice, name).toContain('noticeDiagram');
      expect(imported.suggestedPrompt, name).toContain('promptDiagram');
    }
  });

  it('converts a notation it can read but not write, and says where it came from', async () => {
    // An ArchiMate model cannot be stored as itself — writing one means
    // choosing an element type per box. It lands as draw.io, and the notice
    // SAYS so rather than looking as though the file was replaced.
    const model = `<archimate:model xmlns:archimate="http://www.archimatetool.com/archimate" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" name="E" id="m">
      <folder name="Business" type="business"><element xsi:type="archimate:BusinessActor" name="Customer" id="e1"/></folder>
      <folder name="Views" type="diagrams"><element xsi:type="archimate:ArchimateDiagramModel" name="V" id="v1">
        <children xsi:type="archimate:DiagramObject" id="o1" archimateElement="e1"><bounds x="10" y="10" width="120" height="55"/></children>
      </element></folder></archimate:model>`;
    const imported = await importCanvasFile(file('estate.archimate', model), t);
    expect(imported.objects[0]).toMatchObject({ kind: 'diagram', data: { diagramFormat: 'drawio', sourceFormat: 'ArchiMate' } });
    expect(String(imported.objects[0]?.data.diagram)).toContain('Customer');
    expect(imported.notice).toContain('noticeDiagramConverted');
  });

  it('does not turn an .xml file that is not a diagram into an empty one', async () => {
    // `.xml` is draw.io's second extension and everything else's first. The
    // extension proposes the notation; the CONTENT has to agree.
    const imported = await importCanvasFile(file('pom.xml', '<project><name>api</name></project>', 'text/xml'), t);
    expect(imported.objects[0]?.kind).not.toBe('diagram');
  });

  it('reads an Excalidraw scene saved as .json as a drawing, not a one-row Dataset', async () => {
    // The same trap the JSON-résumé path documents: a `.json` name sent the
    // scene to the tabular importer, which made a Dataset of one row whose
    // cells were JSON fragments.
    const scene = JSON.stringify({
      type: 'excalidraw',
      elements: [
        { id: 'r', type: 'rectangle', x: 0, y: 0, width: 120, height: 60 },
        { id: 'r-t', type: 'text', containerId: 'r', text: 'Ingest', x: 8, y: 20 },
      ],
    });
    const imported = await importCanvasFile(file('workshop.excalidraw.json', scene, 'application/json'), t);
    expect(imported.objects[0]?.kind).toBe('diagram');
    expect(imported.objects[0]?.data.diagramFormat).toBe('excalidraw');
    expect(String(imported.objects[0]?.data.diagram)).toContain('Ingest');
  });

  it('leaves an .svg an image, because a vector picture is a picture', async () => {
    const imported = await importCanvasFile(file('logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="80" height="40"/></svg>', 'image/svg+xml'), t);
    expect(imported.objects[0]?.kind).toBe('image');
  });

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

  /**
   * A JSON RESUME MUST NOT LAND AS A DATASET.
   *
   * The standard export is one top-level object, so the tabular reader turned it into a
   * single row of stringified sections — nothing on the board could render it, and
   * "put my résumé in ten styles" had no route to the template engine at all.
   */
  describe('a JSON Resume export', () => {
    const HIRED_EXPORT = JSON.stringify({
      Basics: { Name: 'Sean Hogg', Label: 'CTO and Technology Leader', Email: 'sean@example.com', Summary: 'Technology leader.' },
      Work: [{ Name: 'Alliance', Position: 'VP of Technology', StartDate: '2021-08-01', EndDate: '2024-01-01', Highlights: ['Cut costs by $1.79M.'] }],
      Education: [{ Institution: 'University of Windsor', Area: 'Computer Science', StudyType: 'Bachelor' }],
      Skills: [], Projects: [],
    });

    it('lands as a renderable résumé, not a one-row dataset', async () => {
      const imported = await importCanvasFile(file('JsonResume-Sean Hogg.json', HIRED_EXPORT, 'application/json'), t);
      const [object] = imported.objects;
      expect(object?.kind).toBe('resume');
      // Titled by the person, not the file — the card the user recognises.
      expect(object?.data.title).toBe('Sean Hogg');
      expect(object?.data.markdown).toContain('VP of Technology — Alliance');
      expect(imported.notice).toContain('noticeResume');
      expect(imported.suggestedPrompt).toContain('promptResume');
    });

    it('arrives with a résumé family the template engine can restyle', async () => {
      const imported = await importCanvasFile(file('JsonResume-Sean Hogg.json', HIRED_EXPORT, 'application/json'), t);
      const family = imported.objects[0]?.data.resumeFamily as { revisions: Array<{ kind: string; document?: { basics?: { name?: string } } }> };
      expect(family.revisions).toHaveLength(1);
      expect(family.revisions[0]?.kind).toBe('original');
      expect(family.revisions[0]?.document?.basics?.name).toBe('Sean Hogg');
    });

    it('still reads an ordinary JSON data export as a Dataset', async () => {
      const imported = await importCanvasFile(file('pipeline.json', JSON.stringify([{ region: 'EMEA', deals: 12 }, { region: 'APAC', deals: 7 }]), 'application/json'), t);
      expect(imported.objects[0]?.kind).toBe('dataset');
      expect(imported.objects[0]?.data.rowCount).toBe(2);
    });
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

  describe('a file that lands as an attachment but could still be escalated', () => {
    /** A PDF with one page and no extractable text — a scan, in miniature.
     * Same shape as the `readPdf` fixture in officeFormats.test.ts: a page
     * whose content stream is a drawing operator, never a text-showing one. */
    function scannedPdf(): Uint8Array {
      const drawing = '0 0 612 792 re\nf';
      const body = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',
        `<< /Length ${drawing.length} >>\nstream\n${drawing}\nendstream`,
      ].map((dict, index) => `${index + 1} 0 obj\n${dict}\nendobj\n`).join('');
      return new TextEncoder().encode(`%PDF-1.7\n${body}%%EOF\n`);
    }

    it('asks a strategy to retain the bytes of a scanned PDF, and keeps what it returns', async () => {
      const retain = async () => ({ sourceFileKey: 'tenant-1/user-1/attachments/scan.pdf' });
      const imported = await importCanvasFile(file('scan.pdf', scannedPdf(), 'application/pdf'), t, retain);
      const [object] = imported.objects;
      expect(object?.kind).toBe('file');
      expect(object?.data.sourceFileKey).toBe('tenant-1/user-1/attachments/scan.pdf');
    });

    it('retains nothing when there is no strategy, exactly as before', async () => {
      const imported = await importCanvasFile(file('scan.pdf', scannedPdf(), 'application/pdf'), t);
      const [object] = imported.objects;
      expect(object?.data.sourceFileKey).toBeUndefined();
      expect(object?.data.sourceDataUrl).toBeUndefined();
    });

    it('retains nothing when the strategy fails', async () => {
      const retain = async () => { throw new Error('upload failed'); };
      const imported = await importCanvasFile(file('scan.pdf', scannedPdf(), 'application/pdf'), t, retain);
      const [object] = imported.objects;
      expect(object?.data.sourceFileKey).toBeUndefined();
      expect(object?.data.sourceDataUrl).toBeUndefined();
    });
  });

  it('routes every visible string through the catalog', async () => {
    const seen: string[] = [];
    const record: ImportTranslator = (key, values) => { seen.push(key); return t(key, values); };
    const imported = await importCanvasFile(file('pipeline.csv', 'A,B\n1,2\n', 'text/csv'), record);
    expect(seen).toContain('statusImported');
    expect(Object.values(imported.objects[0]!.data).some((value) => typeof value === 'string' && /[A-Z][a-z]+ [a-z]+/.test(value) && !value.includes('('))).toBe(false);
  });
});

describe('HTML files land as documents, not as source code', () => {
  const t: ImportTranslator = (key, values) => (values ? `${key}:${JSON.stringify(values)}` : key);

  it('reads a saved HTML page as a readable document', async () => {
    const html = '<!doctype html><html><head><title>Sales Discovery Guide</title></head>'
      + '<body><h1>Sales Discovery Guide</h1><p>Use this guide to understand the buyer.</p></body></html>';
    const file = new File([html], 'Builderforce-Sales-Discovery-Guide.htm', { type: 'text/html' });
    const result = await importCanvasFile(file, t);
    expect(result.objects).toHaveLength(1);
    // The reported failure: this arrived as `code` and showed raw markup.
    expect(result.objects[0]!.kind).toBe('document');
    expect(result.objects[0]!.data.sourceFormat).toBe('HTML');
    expect(result.objects[0]!.data.documentTitle).toBe('Sales Discovery Guide');
    expect(String(result.objects[0]!.data.markdown ?? result.objects[0]!.data.content)).toContain('Sales Discovery Guide');
    // The exact markup survives, so an HTML export is still lossless.
    expect(String(result.objects[0]!.data.sourceHtml)).toContain('<!doctype html>');
  });

  it('leaves an HTML FRAGMENT as code', async () => {
    const file = new File(['<div class="row"><span>ok</span></div>'], 'snippet.html', { type: 'text/html' });
    const result = await importCanvasFile(file, t);
    expect(result.objects[0]!.kind).toBe('code');
    expect(result.objects[0]!.data.language).toBe('html');
  });

  it('still treats real source files as code', async () => {
    const file = new File(['export const a = 1;\n'], 'a.ts', { type: 'text/plain' });
    const result = await importCanvasFile(file, t);
    expect(result.objects[0]!.kind).toBe('code');
  });
});
