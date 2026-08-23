/**
 * The PDF writer has to produce a file a viewer will actually open, and the
 * only structural guarantees a PDF gives are the header, the cross-reference
 * offsets and the trailer — so those are what is asserted here, byte-exactly,
 * rather than "it returned some bytes".
 */
import { describe, it, expect } from 'vitest';
import { markdownToPdf, renderPdf } from './pdfWriter';

const decode = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
};

/** Walk the xref table and confirm every offset lands on `<n> 0 obj`. */
function assertXrefOffsets(text: string): number {
  const startMatch = /startxref\s+(\d+)/.exec(text);
  expect(startMatch).toBeTruthy();
  const xrefStart = Number(startMatch![1]);
  expect(text.slice(xrefStart, xrefStart + 4)).toBe('xref');

  const header = /xref\n0 (\d+)\n/.exec(text.slice(xrefStart));
  expect(header).toBeTruthy();
  const count = Number(header![1]);
  const rows = text.slice(xrefStart + (header![0]?.length ?? 0)).split('\n');
  for (let i = 1; i < count; i++) {
    const row = rows[i] ?? '';
    const offset = Number(row.slice(0, 10));
    expect(text.slice(offset, offset + `${i} 0 obj`.length)).toBe(`${i} 0 obj`);
  }
  return count - 1;
}

describe('markdownToPdf', () => {
  it('writes a structurally valid single-page PDF', () => {
    const bytes = markdownToPdf('# Title\n\nHello **world**.', 'Title');
    const text = decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const objects = assertXrefOffsets(text);
    // 1 catalog + 1 pages + 12 fonts + 1 page + 1 content stream. Twelve, not
    // six: every family's four faces are always mapped, because a run may name
    // its own font (`[words]{font=Georgia}`) and cannot be drawn in a face the
    // resource dictionary does not carry.
    expect(objects).toBe(16);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/BaseFont /Helvetica');
    expect(text).toContain('/Encoding /WinAnsiEncoding');
  });

  it('drops a leading heading that repeats the cover title', () => {
    const withCover = decode(markdownToPdf('# Quarterly Report\n\nBody.', 'Quarterly Report'));
    // The title is drawn once (in the banner), not twice.
    expect(withCover.split('(Quarterly)').length - 1).toBe(1);
  });

  it('paginates long content onto multiple pages and numbers every one', () => {
    const long = Array.from({ length: 160 }, (_, i) => `Paragraph number ${i} with enough words to occupy a full line of the page.`).join('\n\n');
    const text = decode(markdownToPdf(long, 'Long'));
    const count = Number(/\/Count (\d+)/.exec(text)![1]);
    expect(count).toBeGreaterThan(3);
    // Every page carries the `n / total` footer.
    expect(text.split(`/ ${count})`).length - 1).toBe(count);
    assertXrefOffsets(text);
  });

  it('escapes literal-string delimiters instead of corrupting the stream', () => {
    const text = decode(markdownToPdf('A (parenthetical) and a back\\slash.'));
    expect(text).toContain('\\(parenthetical\\)');
    expect(text).toContain('back\\\\slash.');
  });

  it('renders tables, lists and code fences without throwing', () => {
    const md = [
      '## Costs',
      '',
      '| Line item | Amount |',
      '| --- | --- |',
      '| Build | $120,000 |',
      '| Margin | $30,000 |',
      '',
      '- first',
      '- second',
      '',
      '1. one',
      '2. two',
      '',
      '```ts',
      'const x = 1;',
      '```',
    ].join('\n');
    const text = decode(markdownToPdf(md, 'Costs'));
    expect(text).toContain('(Line)');
    expect(text).toContain('/F5');           // Courier for the fence
    assertXrefOffsets(text);
  });

  it('replaces glyphs WinAnsi cannot carry rather than emitting multi-byte text', () => {
    const bytes = markdownToPdf('Cost is 100 € and 你好.');
    for (const b of bytes) expect(b).toBeLessThanOrEqual(0xff);
    const text = decode(bytes);
    expect(text).toContain(String.fromCharCode(0x80));  // euro
    expect(text).toContain('??');                        // unrepresentable CJK
  });

  it('draws the cover badge and the footer when asked', () => {
    const text = decode(renderPdf({
      blocks: [{ kind: 'paragraph', text: 'Body.' }],
      title: 'Proposal',
      subtitle: 'Prepared for Acme',
      badge: { label: 'Quoted price', value: '$180,000' },
      footer: 'Confidential',
      theme: { accent: '#ff6b4a', secondary: '#0e7490' },
    }));
    expect(text).toContain('(Quoted price)');
    expect(text).toContain('($180,000)');
    expect(text).toContain('(Confidential)');
    expect(text).toContain('(Prepared)');
    expect(text).toContain('(Acme)');
    // The accent hex reached the content stream as a fill colour.
    expect(text).toContain('1.000 0.420 0.290 rg');
  });
});
