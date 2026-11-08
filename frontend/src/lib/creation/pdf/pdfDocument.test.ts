import { unzlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createPdfBuilder, pdfBytesToString } from './pdfDocument';

function simple(binary = true) {
  const pdf = createPdfBuilder({ binary });
  const catalog = pdf.reserve();
  const pages = pdf.reserve();
  const page = pdf.reserve();
  const content = pdf.reserve();
  pdf.pageTree(catalog, pages, [page]);
  pdf.object(page, `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 10 10] /Contents ${content} 0 R >>`);
  pdf.stream(content, '', '0 0 m 5 5 l S');
  return { pdf, catalog, bytes: pdf.build(catalog) };
}

describe('createPdfBuilder', () => {
  it('writes dense ids, an xref whose offsets land on each object and a correct startxref', () => {
    const { bytes } = simple();
    const text = pdfBytesToString(bytes);
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const startxref = Number(/startxref\n(\d+)\n/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 5)).toBe('xref\n');
    expect(text).toContain('xref\n0 5\n');
    const entries = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n /g)];
    expect(entries).toHaveLength(4);
    entries.forEach((entry, index) => expect(text.slice(Number(entry[1]), Number(entry[1]) + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`));
    expect(text).toContain('trailer\n<< /Size 5 /Root 1 0 R >>');
  });

  it('declares the exact byte length of a stream, including multi-byte-free binary data', () => {
    const pdf = createPdfBuilder();
    const root = pdf.reserve();
    const data = pdf.reserve();
    pdf.object(root, '<< /Type /Catalog >>');
    pdf.stream(data, '/Foo /Bar', new Uint8Array([0, 255, 128, 10, 13]));
    const text = pdfBytesToString(pdf.build(root));
    expect(text).toContain('<< /Foo /Bar /Length 5 >>\nstream\n\u0000ÿ\u0080\n\r\nendstream');
  });

  it('deflates an RGB image into a stream that inflates back to the pixels', () => {
    const pdf = createPdfBuilder();
    const root = pdf.reserve();
    const image = pdf.reserve();
    pdf.object(root, '<< /Type /Catalog >>');
    pdf.rgbImage(image, 2, 1, new Uint8Array([1, 2, 3, 4, 5, 6]));
    const bytes = pdf.build(root);
    const text = pdfBytesToString(bytes);
    const match = /\/Width 2 \/Height 1 [^>]*\/Length (\d+) >>\nstream\n/.exec(text)!;
    const start = match.index + match[0].length;
    expect(unzlibSync(bytes.subarray(start, start + Number(match[1])))).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
  });

  it('adds the binary marker line only when asked, and leaves the ASCII form pure ASCII', () => {
    expect(pdfBytesToString(simple(true).bytes).split('\n')[1]).toBe('%ÿÿÿÿ');
    expect(/^[\x00-\x7f]*$/.test(pdfBytesToString(simple(false).bytes))).toBe(true);
  });

  it('refuses an object that was reserved but never written, written twice, or never reserved', () => {
    const pdf = createPdfBuilder();
    const a = pdf.reserve();
    pdf.reserve();
    pdf.object(a, '<< >>');
    expect(() => pdf.build(a)).toThrow(/never written/);
    expect(() => pdf.object(a, '<< >>')).toThrow(/twice/);
    expect(() => pdf.object(99, '<< >>')).toThrow(/not reserved/);
  });
});
