/**
 * Office export client — turn a Brain capability reply into a real file.
 *
 * Document → .docx and Slides → .pptx are rendered server-side (`/api/exports`,
 * where the OOXML writers live); Spreadsheet → .csv needs no round-trip because
 * the model already emits the rows, so it saves straight from the browser.
 */

import { AUTH_API_URL, getStoredTenantToken } from './auth';
import { downloadBlob, downloadText, filenameFromResponse } from './download';

export type OfficeFormat = 'docx' | 'pptx';

async function exportOffice(format: OfficeFormat, markdown: string, title: string): Promise<void> {
  const token = getStoredTenantToken();
  const res = await fetch(`${AUTH_API_URL}/api/exports/${format}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ markdown, title }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Export failed (${res.status})`);
  }
  downloadBlob(await res.blob(), filenameFromResponse(res, `export.${format}`));
}

/** Render markdown as a Word document and download it. */
export const exportDocx = (markdown: string, title: string) => exportOffice('docx', markdown, title);

/** Render markdown slides (one `##` per slide) as a PowerPoint deck and download it. */
export const exportPptx = (markdown: string, title: string) => exportOffice('pptx', markdown, title);

/** Save CSV text as a .csv file — no server round-trip needed. */
export function exportCsv(csv: string, filename: string): void {
  downloadText(csv, filename, 'text/csv');
}
