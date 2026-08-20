import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { WatermarkError, canWatermark, watermarkDocument } from './documentWatermark';

const LABEL = 'partner@meridian.example · 2026-08-19 09:12 UTC';

async function samplePdf(pages = 2): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) document.addPage([595, 842]).drawText(`Page ${i + 1}`);
  return document.save();
}

/**
 * `data_rooms.watermark` promises that every document a firm opens carries their
 * identity. The first pass could only keep the text half of that; these are the
 * properties that make the promise the same one for a PDF.
 */
describe('watermarking a document', () => {
  it('knows which formats can carry the stamp before anybody opens one', () => {
    // Reported on the room LIST, so an owner learns which documents can only be
    // served view-only before they share rather than when a fund complains.
    expect(canWatermark('application/pdf')).toBe(true);
    expect(canWatermark('text/markdown')).toBe(true);
    expect(canWatermark('application/json')).toBe(true);
    expect(canWatermark('image/png')).toBe(false);
    expect(canWatermark('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(false);
    expect(canWatermark(null)).toBe(false);
  });

  it('stamps every page of a PDF and leaves it a readable PDF', async () => {
    const source = await samplePdf(3);
    const result = await watermarkDocument(source, 'application/pdf', LABEL, 'Seed data room');

    expect(result.outcome).toBe('stamped');
    // Still a PDF — a stamp that produced bytes no reader opens is worse than none.
    expect(new TextDecoder().decode(result.bytes.slice(0, 5))).toBe('%PDF-');
    const reopened = await PDFDocument.load(result.bytes);
    expect(reopened.getPageCount()).toBe(3);
    // The mark is IN the file, not around it.
    expect(result.bytes.length).toBeGreaterThan(source.length);
  });

  it('never mutates the sealed original', async () => {
    // The stamp names one recipient at one instant, so a stamped copy must never
    // become the stored artifact — the next reader would inherit somebody else's name.
    const source = await samplePdf(1);
    const before = source.slice();
    await watermarkDocument(source, 'application/pdf', LABEL);
    expect(Array.from(source)).toEqual(Array.from(before));
  });

  it('brackets a text document top and bottom so a partial copy still carries it', async () => {
    const source = new TextEncoder().encode('Revenue was $412,000 in July.');
    const result = await watermarkDocument(source, 'text/plain', LABEL, 'Seed data room');
    const text = new TextDecoder().decode(result.bytes);

    expect(result.outcome).toBe('stamped');
    expect(text.startsWith('--- Confidential')).toBe(true);
    expect(text.trimEnd().endsWith('---')).toBe(true);
    expect(text).toContain(LABEL);
    expect(text).toContain('Seed data room');
    expect(text).toContain('Revenue was $412,000 in July.');
  });

  it('reports a format it cannot mark rather than pretending it did', async () => {
    const source = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const result = await watermarkDocument(source, 'image/png', LABEL);
    expect(result.outcome).toBe('not-applicable');
    // Untouched: the caller decides what an unstampable document means, and the
    // data room's answer is to refuse the download and serve it inline only.
    expect(Array.from(result.bytes)).toEqual(Array.from(source));
  });

  it('REFUSES a PDF it cannot parse instead of serving it unstamped', async () => {
    // The whole point of the column: a document that cannot carry the stamp must
    // not be handed over as though it had.
    const corrupt = new TextEncoder().encode('%PDF-1.7\nthis is not a pdf');
    await expect(watermarkDocument(corrupt, 'application/pdf', LABEL)).rejects.toBeInstanceOf(WatermarkError);
    await expect(watermarkDocument(corrupt, 'application/pdf', LABEL)).rejects.toMatchObject({ status: 422 });
  });
});
