/**
 * THE file-download response for the api — one place that turns bytes into a
 * download a browser saves under the right name.
 *
 * ── WHY ONE FUNCTION ────────────────────────────────────────────────────────
 * The same four headers were assembled by hand in a dozen route files: the
 * Office exports, the decks, the legal documents, the workflow YAML, the invoice
 * PDF and every CSV report. Each copy made its own choices — one stripped quotes
 * out of the filename and one did not, one sent `charset=utf-8` and one did not,
 * one set `no-store` and the rest let an intermediary keep yesterday's numbers —
 * and the symptom of a wrong copy is a file saved as `export` with no extension,
 * or a stale balance on a customer's invoice, not an error anybody here sees.
 *
 * The format → content-type/extension table lives here too, so "what is a .xlsx
 * served as" is answered once.
 *
 * Built on the web-standard `Response` (no Hono), so the application-layer
 * export renderer can answer with it and a route simply returns it.
 */

/** Every download format the api serves, with its media type and extension. */
export const DOWNLOAD_FORMATS = {
  csv: { contentType: 'text/csv; charset=utf-8', ext: 'csv' },
  json: { contentType: 'application/json; charset=utf-8', ext: 'json' },
  html: { contentType: 'text/html; charset=utf-8', ext: 'html' },
  xlsx: { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' },
  docx: { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' },
  pptx: { contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: 'pptx' },
  pdf: { contentType: 'application/pdf', ext: 'pdf' },
  yaml: { contentType: 'application/yaml; charset=utf-8', ext: 'yaml' },
  zip: { contentType: 'application/zip', ext: 'zip' },
} as const;

export type DownloadFormat = keyof typeof DOWNLOAD_FORMATS;

export interface DownloadOptions {
  /** The saved filename, extension included. Quotes are stripped (header-safe). */
  filename: string;
  /** Media type; pass a {@link DownloadFormat} key or a literal type. */
  contentType: string;
  /**
   * `attachment` (default) saves the file; `inline` lets the browser's own viewer
   * show it (an invoice a customer opened from a link) while the filename still
   * rides along for when they save it.
   */
  disposition?: 'attachment' | 'inline';
  /**
   * Defaults to `no-store`: a download is a point-in-time snapshot, and an
   * intermediary serving a cached copy would hand someone numbers that have since
   * moved. Pass `private, no-store` (or anything else) when a route needs to.
   */
  cacheControl?: string;
  /** Route-specific extra headers (a deck id, a watermark marker, a length). */
  headers?: Record<string, string>;
}

/** Header-safe filename: no quotes (they would end the quoted-string) and no CR/LF. */
export function safeDownloadName(filename: string): string {
  return filename.replace(/["\r\n]/g, '');
}

/** Resolve a format key to its media type, passing a literal type through. */
function contentTypeOf(contentType: string): string {
  return contentType in DOWNLOAD_FORMATS
    ? DOWNLOAD_FORMATS[contentType as DownloadFormat].contentType
    : contentType;
}

/**
 * Answer `body` as a file download. A `Uint8Array` is copied onto its own
 * `ArrayBuffer` first: a Response built straight from a view over a pooled buffer
 * (fflate's, for the Office writers) can serialise the WHOLE pool. A stream (an
 * R2 object body) passes through untouched.
 */
export function downloadResponse(body: string | Uint8Array | ReadableStream, opts: DownloadOptions): Response {
  const payload: BodyInit = body instanceof Uint8Array ? (body.slice().buffer as ArrayBuffer) : body;
  return new Response(payload, {
    headers: {
      'content-type': contentTypeOf(opts.contentType),
      'content-disposition': `${opts.disposition ?? 'attachment'}; filename="${safeDownloadName(opts.filename)}"`,
      'cache-control': opts.cacheControl ?? 'no-store',
      ...opts.headers,
    },
  });
}
