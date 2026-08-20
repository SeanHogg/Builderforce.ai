/**
 * Stamping a document with who is reading it, and when.
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────
 * `data_rooms.watermark` promises that every document a firm opens carries their
 * identity on it. The first pass could only keep half of that promise: text-shaped
 * documents were stamped, and a PDF — the format a data room is mostly made of —
 * was served inline and unstamped, with the column downgraded to "no download".
 * That is a real control and it is not the control the column names.
 *
 * This applies the stamp to the BYTES, for both shapes, so the promise is the
 * same one whatever was uploaded.
 *
 * ── WHY THE STAMP IS APPLIED ON THE WAY OUT AND NEVER STORED ────────────────
 * The stamp names ONE recipient at ONE instant. A stamped copy in R2 would be a
 * second artifact that is wrong for every other reader, and the first time it was
 * served to somebody else it would attribute a leak to the wrong firm. So the
 * sealed artifact stays exactly as uploaded and the stamp is applied per response
 * — which is also why the read seam sends `cache-control: no-store`.
 *
 * ── WHY pdf-lib AND NOT A HAND-ROLLED INCREMENTAL UPDATE ────────────────────
 * Overlaying text on a PDF page means resolving the page tree, which means
 * handling both classic xref tables and cross-reference streams, object streams
 * and every compression filter in between. A hand-rolled version of that is a
 * parser that works on the PDFs you tested and fails on the one a fund sends. The
 * library is pure JS with no Node built-ins, so it runs in a Worker unchanged.
 *
 * A PDF that cannot be parsed at all — corrupt, or encrypted with an owner
 * password — is REFUSED rather than served unstamped. That is the whole point of
 * the column: a document that cannot carry the stamp must not be handed over as
 * though it did.
 */

import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

/** Mime types whose bytes are text and can carry a banner directly. */
const TEXT_LIKE = /^(text\/|application\/json|application\/xml|application\/x-yaml)/i;
const PDF_LIKE = /^application\/pdf/i;

export class WatermarkError extends Error {
  constructor(message: string, readonly status: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WatermarkError';
  }
}

export type WatermarkOutcome = 'stamped' | 'not-applicable';

export interface WatermarkedBytes {
  bytes: Uint8Array;
  outcome: WatermarkOutcome;
}

/** Whether this mime is one the stamp can be applied to at all. Exported so a
 *  caller can tell a user WHICH documents in a room are unstampable before they
 *  share it, rather than at the moment somebody tries to open one. */
export function canWatermark(mime: string | null): boolean {
  const value = mime ?? '';
  return TEXT_LIKE.test(value) || PDF_LIKE.test(value);
}

/**
 * Draw the label diagonally across every page, plus a footer line.
 *
 * Diagonal and semi-transparent because the stamp has to survive a screenshot and
 * still leave the document readable — a corner mark is cropped out in one gesture,
 * and an opaque band makes the page useless. The footer repeats it horizontally so
 * it is legible when somebody actually needs to read who this copy belongs to.
 */
async function stampPdf(bytes: Uint8Array, label: string): Promise<Uint8Array> {
  try {
    return await drawStamp(bytes, label);
  } catch (error) {
    // The WHOLE operation is guarded, not just the parse. A malformed PDF often
    // loads and then fails on the page tree, the font table or the save — and all
    // of those mean the same thing to a caller: this document cannot carry the
    // stamp. `cause` keeps the real failure attached for diagnosis without leaking
    // it to an external recipient.
    throw new WatermarkError(
      'This document cannot be watermarked, and this data room requires a watermark, so it cannot be opened. Re-upload it as an unencrypted, uncorrupted PDF.',
      422,
      { cause: error },
    );
  }
}

async function drawStamp(bytes: Uint8Array, label: string): Promise<Uint8Array> {
  // `ignoreEncryption` lets a permissions-flagged (but readable) PDF through — the
  // common case for a document exported by a finance tool. A PDF that needs a
  // password to open still throws, and is refused by the guard above.
  const document = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const font = await document.embedFont(StandardFonts.Helvetica);
  const text = label.slice(0, 120);

  for (const page of document.getPages()) {
    const { width, height } = page.getSize();
    // Sized to the page rather than fixed, so an A4 portrait and a wide slide deck
    // both get a mark that spans them instead of one that overflows or vanishes.
    const diagonalSize = Math.max(10, Math.min(width, height) / Math.max(14, text.length * 0.55));
    page.drawText(text, {
      x: width * 0.08,
      y: height * 0.22,
      size: diagonalSize,
      font,
      color: rgb(0.45, 0.45, 0.5),
      opacity: 0.22,
      rotate: degrees(38),
    });
    const footerSize = 8;
    page.drawText(text, {
      x: 24,
      y: 14,
      size: footerSize,
      font,
      color: rgb(0.35, 0.35, 0.4),
      opacity: 0.75,
      maxWidth: Math.max(60, width - 48),
    });
  }

  return document.save({ useObjectStreams: false });
}

/** The banner a text-shaped document carries, top and bottom, so it survives a
 *  copy-paste of either end. */
function stampText(bytes: Uint8Array, label: string, context: string): Uint8Array {
  const banner = `--- Confidential · shared with ${label}${context ? ` · ${context}` : ''} ---`;
  const body = new TextDecoder().decode(bytes);
  return new TextEncoder().encode(`${banner}\n\n${body}\n\n${banner}\n`);
}

/**
 * Apply the stamp, or refuse.
 *
 * `not-applicable` is returned only for a mime this cannot mark at all (an image,
 * an archive, a spreadsheet in a binary format). The CALLER decides what that
 * means — the data room's answer is to refuse the download and serve it inline
 * only, which is the honest remaining control for a format the stamp cannot reach.
 */
export async function watermarkDocument(
  bytes: Uint8Array,
  mime: string | null,
  label: string,
  context = '',
): Promise<WatermarkedBytes> {
  const value = mime ?? '';
  if (PDF_LIKE.test(value)) return { bytes: await stampPdf(bytes, `${label}${context ? ` · ${context}` : ''}`), outcome: 'stamped' };
  if (TEXT_LIKE.test(value)) return { bytes: stampText(bytes, label, context), outcome: 'stamped' };
  return { bytes, outcome: 'not-applicable' };
}
