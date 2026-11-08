/**
 * Résumé file → plain text, deterministically and without a model.
 *
 * ── WHY THIS EXISTS RATHER THAN "ASK THE LLM" ────────────────────────────────────
 * `POST /api/creative/resume/import` reads a PDF by handing the whole file to a
 * multimodal model. That works, but it spends tokens on every upload, needs a tenant
 * with plan-resolved proxy credentials, and returns nothing at all when the provider
 * is down — for the ONE artefact a for-hire account exists to produce. A résumé with
 * a real text layer does not need a model to be read; it needs a parser.
 *
 * So this runs first and the model is the fallback, not the path:
 *   - PDF / DOCX → `readDocument` (`@builderforce/agent-tools/documents`, the ONE document extractor; no pdf.js of its own).
 *   - text / Markdown / JSON → decoded as-is.
 *   - scanned PDFs, legacy .doc (OLE), images → declined HERE, so the caller can
 *     escalate to the multimodal path knowing why rather than guessing.
 *
 * Ported from hired.video `services/resume/extractFile.ts` as part of PRD 18 T1.
 * Pure of DB, network, AI and Worker env — which is what lets the tenantless
 * for-hire upload path and the tenant-scoped canvas import path share one reader.
 */

import {
  type DocumentRead, DOCX_MEDIA_TYPE, PDF_MEDIA_TYPE, readDocument, zipEntryNames,
} from '@builderforce/agent-tools/documents';

export type ResumeExtractResult =
  | { ok: true; text: string }
  | { ok: false; code: 'UNSUPPORTED_MEDIA_TYPE' | 'NO_TEXT_LAYER'; message: string };

const PDF_MAGIC = '%PDF';
const ZIP_MAGIC = [0x50, 0x4b]; // "PK" — docx/xlsx/pptx are zip containers

/**
 * True for text that is really raw bytes — a PDF read as latin1, a zip read as
 * text. Such a blob must never reach a model (wasted tokens, garbage out) or
 * JSONB, so the check lives beside the extractor both callers go through.
 */
export function looksLikeBinaryText(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trimStart();
  if (text.indexOf(String.fromCharCode(0)) !== -1) return true; // a NUL byte is decisive
  if (trimmed.startsWith('PK')) return true;
  if (trimmed.startsWith(PDF_MAGIC)) return true;
  // Real résumé text is overwhelmingly printable. Sample the head so this stays
  // O(1) on large blobs.
  const sample = text.slice(0, 1000);
  let control = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const code = sample.charCodeAt(i);
    // Allow tab(9), LF(10), CR(13); count the rest of C0 + DEL as control.
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) control += 1;
  }
  return sample.length > 0 && control / sample.length > 0.1;
}

/** Strip the C0 control range (minus tab/newline/CR) so text is safe to store in JSONB. */
export function stripResumeControlChars(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function startsWithBytes(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((b, i) => bytes[i] === b);
}

function looksLikePdf(bytes: Uint8Array, contentType?: string): boolean {
  if (contentType && /pdf/i.test(contentType)) return true;
  return new TextDecoder('latin1').decode(bytes.subarray(0, 5)).startsWith(PDF_MAGIC);
}

const unreadablePdf = (reason: string): ResumeExtractResult => ({ ok: false, code: 'NO_TEXT_LAYER', message: `Could not read this PDF: ${reason}.` });
const unreadableDocx: ResumeExtractResult = { ok: false, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'This file is not a readable .docx.' };

async function extractPdf(bytes: Uint8Array): Promise<ResumeExtractResult> {
  let read: DocumentRead;
  try {
    read = await readDocument(bytes, PDF_MEDIA_TYPE);
  } catch (error) {
    return unreadablePdf(error instanceof Error ? error.message : 'unknown error');
  }
  if ('text' in read) return { ok: true, text: stripResumeControlChars(read.text).trim() };
  if (read.failure === 'unreadable') return unreadablePdf(read.reason);
  return { ok: false, code: 'NO_TEXT_LAYER', message: 'This PDF has no text layer — it looks like a scan or a photo.' };
}

async function extractDocx(bytes: Uint8Array): Promise<ResumeExtractResult> {
  const names = zipEntryNames(bytes);
  if (!names) return unreadableDocx;
  // A PK zip that isn't a Word document (.xlsx / .pptx / .pages).
  if (!names.includes('word/document.xml')) return { ok: false, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'This zip is not a Word .docx.' };
  let read: DocumentRead;
  try {
    read = await readDocument(bytes, DOCX_MEDIA_TYPE);
  } catch {
    return unreadableDocx;
  }
  if ('text' in read) return { ok: true, text: stripResumeControlChars(read.text).trim() };
  // The zip opens but its deflate data is corrupt (or over the caps): not a readable .docx, never "no text".
  if (read.failure === 'unreadable') return unreadableDocx;
  return { ok: false, code: 'NO_TEXT_LAYER', message: 'This .docx contained no text.' };
}

/**
 * Decode a résumé file's bytes to plain text. `contentType` and `filename` are only
 * HINTS — detection falls back to magic bytes, so a mislabeled upload (the common
 * case when a file arrives from a phone) still reads correctly.
 */
export async function extractResumeText(
  bytes: Uint8Array,
  opts: { contentType?: string; filename?: string } = {},
): Promise<ResumeExtractResult> {
  const name = (opts.filename ?? '').toLowerCase();
  const contentType = opts.contentType ?? '';

  if (looksLikePdf(bytes, contentType) || name.endsWith('.pdf')) return extractPdf(bytes);
  if (startsWithBytes(bytes, ZIP_MAGIC)) return extractDocx(bytes);
  if (/msword/i.test(contentType) || name.endsWith('.doc')) {
    return {
      ok: false,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Legacy .doc files are not supported — save as .docx or PDF.',
    };
  }

  const text = new TextDecoder('utf-8').decode(bytes);
  if (looksLikeBinaryText(text)) {
    return {
      ok: false,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: `Unsupported file type${contentType ? ` (${contentType})` : ''}. Supported: PDF, DOCX, text, Markdown, JSON.`,
    };
  }
  const clean = stripResumeControlChars(text).trim();
  if (!clean) return { ok: false, code: 'NO_TEXT_LAYER', message: 'This file decoded to empty text.' };
  return { ok: true, text: clean };
}
