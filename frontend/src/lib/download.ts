/**
 * Browser download — the ONE implementation.
 *
 * The "make a Blob URL, click a hidden <a>, revoke" dance was inlined in a dozen
 * places (API clients, admin panels, export buttons), each with its own subtle
 * differences — some revoked the object URL synchronously right after `.click()`,
 * which races the download in Safari/Firefox. This is the correct version:
 * append to the document, click, remove, and revoke on the next tick.
 */

/** Trigger a download of an already-built Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Trigger a download of text content (CSV, markdown, JSON, HTML, …). */
export function downloadText(text: string, filename: string, mimeType = 'text/plain'): void {
  downloadBlob(new Blob([text], { type: `${mimeType};charset=utf-8` }), filename);
}

/** Trigger a download of a value serialized as pretty-printed JSON. */
export function downloadJson(value: unknown, filename: string): void {
  downloadText(JSON.stringify(value, null, 2), filename, 'application/json');
}

/**
 * Read the filename a response advertises via `Content-Disposition`, falling
 * back to the caller's default — so server-named exports keep their name.
 */
export function filenameFromResponse(res: Response, fallback: string): string {
  const cd = res.headers.get('content-disposition') ?? '';
  return /filename="?([^";]+)"?/.exec(cd)?.[1] ?? fallback;
}

/** Turn a header row + body rows into RFC-4180 CSV (quotes escaped, CRLF rows). */
export function toCsv(head: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const cell = (v: string | number | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [head.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n');
}
