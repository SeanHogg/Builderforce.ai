/**
 * Office export client — turn a canvas object into a real file in its NATIVE
 * format.
 *
 * Document → .docx, Slides → .pptx and Spreadsheet → .xlsx are rendered
 * server-side (`/api/exports`, where the OOXML writers live), because all three
 * are zips of XML parts rather than text a browser can write out. CSV needs no
 * round-trip — the rows are already in hand — so it saves straight from the
 * browser, and PDF is the browser's own print pipeline (`printDocument.ts`).
 */


import { apiRequestStream } from './apiClient';
import { downloadBlob, downloadText, filenameFromResponse } from './download';

export type OfficeFormat = 'docx' | 'pptx' | 'xlsx';

async function exportOffice(format: OfficeFormat, body: Record<string, unknown>): Promise<void> {
  const res = await apiRequestStream(`/api/exports/${format}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const failure = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(failure.error || `Export failed (${res.status})`);
  }
  downloadBlob(await res.blob(), filenameFromResponse(res, `export.${format}`));
}

/** Render markdown as a Word document and download it. */
export const exportDocx = (markdown: string, title: string) => exportOffice('docx', { markdown, title });

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
