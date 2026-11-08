import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { extractResumeText } from './resumeExtract';

/** Parity oracle for `extractResumeText`: the outcomes (and messages) callers see for each file kind. */

const docx = (bodyXml: string, extra: Record<string, Uint8Array> = {}): Uint8Array =>
  zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(`<w:document><w:body>${bodyXml}</w:body></w:document>`),
    ...extra,
  });

const para = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

/** A one-page PDF whose content stream is `stream`, with a correct xref table. */
function pdf(stream: string): Uint8Array {
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) out += `${String(at).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return strToU8(out);
}

describe('extractResumeText', () => {
  it('reads a DOCX: one line per paragraph, tabs kept, entities decoded', async () => {
    const bytes = docx(`${para('Jane &amp; Co')}<w:p><w:r><w:t>Skills</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>TypeScript</w:t></w:r></w:p>`);
    expect(await extractResumeText(bytes, { filename: 'cv.docx' })).toEqual({ ok: true, text: 'Jane & Co\nSkills\tTypeScript' });
  });

  it('detects a DOCX by its zip magic even when mislabeled', async () => {
    const result = await extractResumeText(docx(para('Hello')), { contentType: 'application/octet-stream' });
    expect(result).toEqual({ ok: true, text: 'Hello' });
  });

  it('a DOCX with no text is NO_TEXT_LAYER', async () => {
    const result = await extractResumeText(docx(''), { filename: 'cv.docx' });
    expect(result).toMatchObject({ ok: false, code: 'NO_TEXT_LAYER' });
  });

  it('a zip that is not a Word document is UNSUPPORTED_MEDIA_TYPE', async () => {
    const xlsx = zipSync({ 'xl/workbook.xml': strToU8('<workbook/>') });
    expect(await extractResumeText(xlsx, { filename: 'book.xlsx' })).toEqual({
      ok: false,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'This zip is not a Word .docx.',
    });
  });

  it('bytes that start PK but do not unzip are UNSUPPORTED_MEDIA_TYPE "not a readable .docx"', async () => {
    expect(await extractResumeText(new Uint8Array([0x50, 0x4b, 1, 2, 3, 4, 5, 6]), { filename: 'cv.docx' })).toEqual({
      ok: false,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'This file is not a readable .docx.',
    });
  });

  it('a malformed PDF is NO_TEXT_LAYER with the "Could not read this PDF" message', async () => {
    const result = await extractResumeText(strToU8('%PDF-1.4 this is not a pdf'), { filename: 'bad.pdf' });
    expect(result).toMatchObject({ ok: false, code: 'NO_TEXT_LAYER' });
    expect((result as { message: string }).message).toMatch(/^Could not read this PDF: .+.$/);
  });

  it('reads a PDF with a text layer', async () => {
    const bytes = pdf('BT /F1 12 Tf 10 50 Td (Hello Resume) Tj ET');
    expect(await extractResumeText(bytes, { contentType: 'application/pdf' })).toEqual({ ok: true, text: 'Hello Resume' });
  });

  it('detects a PDF by magic bytes when unlabeled', async () => {
    const result = await extractResumeText(pdf('BT /F1 12 Tf 10 50 Td (Hello Resume) Tj ET'));
    expect(result).toEqual({ ok: true, text: 'Hello Resume' });
  });

  it('a PDF with no text layer is NO_TEXT_LAYER with the scan message', async () => {
    expect(await extractResumeText(pdf(''), { filename: 'scan.pdf' })).toEqual({
      ok: false,
      code: 'NO_TEXT_LAYER',
      message: 'This PDF has no text layer — it looks like a scan or a photo.',
    });
  });

  it('legacy .doc is UNSUPPORTED_MEDIA_TYPE', async () => {
    expect(await extractResumeText(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]), { filename: 'cv.doc' })).toEqual({
      ok: false,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Legacy .doc files are not supported — save as .docx or PDF.',
    });
    expect(await extractResumeText(new Uint8Array([1, 2, 3]), { contentType: 'application/msword' })).toMatchObject({
      ok: false,
      code: 'UNSUPPORTED_MEDIA_TYPE',
    });
  });

  it('binary bytes of an unknown type are UNSUPPORTED_MEDIA_TYPE and name the content type', async () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 4, 5]);
    expect(await extractResumeText(bytes, { contentType: 'image/png' })).toEqual({
      ok: false,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Unsupported file type (image/png). Supported: PDF, DOCX, text, Markdown, JSON.',
    });
  });

  it('plain text and Markdown are decoded as-is, trimmed and control-stripped', async () => {
    const bytes = new TextEncoder().encode('  # Jane\u0007 Doe\n- TypeScript  ');
    expect(await extractResumeText(bytes, { filename: 'cv.md' })).toEqual({ ok: true, text: '# Jane Doe\n- TypeScript' });
  });

  it('an empty text file is NO_TEXT_LAYER', async () => {
    expect(await extractResumeText(new TextEncoder().encode('   \n'), { filename: 'cv.txt' })).toEqual({
      ok: false,
      code: 'NO_TEXT_LAYER',
      message: 'This file decoded to empty text.',
    });
  });
});
