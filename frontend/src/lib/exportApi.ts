/**
 * Office export client — turn a canvas object into a real file in its NATIVE
 * format.
 *
 * Document → .docx, Slides → .pptx and Spreadsheet → .xlsx are rendered
 * server-side (`/api/exports`, where the OOXML writers live), because all three
 * are zips of XML parts rather than text a browser can write out. CSV needs no
 * round-trip — the rows are already in hand — so it saves straight from the
 * browser.
 *
 * PDF joined the server list for every DOCUMENT-shaped kind: the print pipeline
 * cannot produce a file without a human at the dialog, and it produces a
 * different one per browser. A picture or a deck still prints, because its PDF
 * is a rendering of what is on the board — `pdfExportStrategy` in
 * `canvasExports.ts` owns that split so both callers read one answer.
 */


import { apiRequestStream, getAuthHeaders } from './apiClient';
import { downloadBlob, downloadText, filenameFromResponse } from './download';
import { getStoredGuestToken } from './guestChatApi';
import { ensureGuestToken } from './guestRoomApi';

export type OfficeFormat = 'docx' | 'pptx' | 'xlsx' | 'pdf';
export interface DocxTheme { accent?: string; font?: 'sans' | 'serif' | 'mono'; density?: 'compact' | 'comfortable' | 'spacious'; columns?: 1 | 2 }
/** The PDF writer reads the same theme vocabulary plus a second brand colour. */
export interface PdfTheme extends Omit<DocxTheme, 'columns'> { secondary?: string }

/**
 * The renderer could not be reached FOR THIS CALLER — no credential at all, or a
 * guest who has spent their daily downloads.
 *
 * Typed rather than a plain Error because it is the one failure the canvas
 * answers by writing the nearest browser-native format instead. Everything else
 * — a malformed payload, a render fault — is a real failure and must surface.
 */
export class OfficeExportUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfficeExportUnavailableError';
  }
}

/** Refusals that mean "not you / not today", as opposed to "that did not work". */
const CREDENTIAL_REFUSALS = [401, 403, 429];

async function exportOffice(format: OfficeFormat, body: Record<string, unknown>): Promise<void> {
  // A signed-out visitor still gets the real file: the export surface takes a
  // guest token, charged against its own daily allowance. The credential is
  // resolved HERE rather than passed in, so no caller has to know which kind of
  // session it is in.
  const tenant = !!getAuthHeaders({}, 'tenant').Authorization;
  const guestToken = tenant ? null : ((await ensureGuestToken()) ?? getStoredGuestToken());
  if (!tenant && !guestToken) throw new OfficeExportUnavailableError('No session to render this file with');

  const res = await apiRequestStream(`/api/exports/${format}`, {
    method: 'POST',
    body: JSON.stringify(body),
    expectedErrors: CREDENTIAL_REFUSALS,
    ...(guestToken ? { auth: 'none' as const, headers: { Authorization: `Bearer ${guestToken}` } } : {}),
  });
  if (!res.ok) {
    const failure = (await res.json().catch(() => ({}))) as { error?: string };
    const message = failure.error || `Export failed (${res.status})`;
    if (CREDENTIAL_REFUSALS.includes(res.status)) throw new OfficeExportUnavailableError(message);
    throw new Error(message);
  }
  downloadBlob(await res.blob(), filenameFromResponse(res, `export.${format}`));
}

/** Render markdown as a Word document and download it. */
export const exportDocx = (markdown: string, title: string, theme?: DocxTheme) => exportOffice('docx', { markdown, title, ...(theme ? { theme } : {}) });

/** Render markdown as a paginated PDF and download it. `subtitle` and `footer`
 * ride the cover band and every page foot when the caller has them. */
export const exportPdf = (markdown: string, title: string, opts: { theme?: PdfTheme; subtitle?: string; footer?: string } = {}) =>
  exportOffice('pdf', {
    markdown, title,
    ...(opts.theme ? { theme: opts.theme } : {}),
    ...(opts.subtitle ? { subtitle: opts.subtitle } : {}),
    ...(opts.footer ? { footer: opts.footer } : {}),
  });

/** Render markdown slides (one `##` per slide) as a PowerPoint deck and download it. */
export const exportPptx = (markdown: string, title: string) => exportOffice('pptx', { markdown, title });

/** Render rows as an Excel workbook and download it. Rows are positional against
 * `columns`, which is what the writer indexes them by. */
export const exportXlsx = (columns: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null>>, title: string) =>
  exportOffice('xlsx', { columns, rows, title });

/** Save CSV text as a .csv file — no server round-trip needed. */
export function exportCsv(csv: string, filename: string): void {
  downloadText(csv, filename, 'text/csv');
}
