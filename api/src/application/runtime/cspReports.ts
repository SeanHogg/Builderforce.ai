/**
 * CSP violation reports from the preview origin's scripts (make.md §4 W10, control 6).
 *
 * Browsers POST these without credentials, so the endpoint is unauthenticated and its
 * content is untrusted: reports are TELEMETRY. They tell an operator which host an app
 * tried to reach (so a missing installer host can be allowlisted by name), and nothing
 * here feeds enforcement — the browser already blocked the request.
 *
 * Two wire formats: the legacy `report-uri` body (`application/csp-report`,
 * `{ "csp-report": { … } }`) and the Reporting API (`application/reports+json`, an array
 * of `{ type: "csp-violation", url, body: { … } }`). Each report is reduced to a redacted
 * record — the blocked host (or CSP keyword), the directive and the document's path —
 * and logged. Query strings (which carry the signed policy id), full blocked URLs,
 * samples and source positions are never logged.
 */
import { readBounded } from '../../infrastructure/http/gzipBody';

/** Largest body read; anything larger is refused unread past this point. */
export const CSP_REPORT_MAX_BYTES = 16 * 1024;

/** Reports logged per POST; the Reporting API batches, and a batch must stay bounded. */
export const CSP_REPORTS_PER_REQUEST = 20;

/** Reports accepted per client IP per minute. */
export const CSP_REPORT_RPM = 60;

export const CSP_REPORT_CONTENT_TYPES = ['application/csp-report', 'application/reports+json'] as const;

export interface CspViolationRecord {
  /** Hostname of the blocked URL, or a CSP keyword (`inline`, `eval`, …), or `other`. */
  blocked: string;
  /** The effective directive (`connect-src`, `script-src-elem`, …), or `unknown`. */
  directive: string;
  /** Path of the document or worker that was blocked, without its query. */
  documentPath: string | null;
}

export type CspReportOutcome =
  | { outcome: 'accepted'; records: CspViolationRecord[] }
  | { outcome: 'unsupported_media_type' }
  | { outcome: 'too_large' }
  | { outcome: 'invalid' };

/** Keywords browsers put in `blocked-uri` instead of a URL. */
const BLOCKED_KEYWORDS = new Set(['inline', 'eval', 'wasm-eval', 'trusted-types-policy', 'trusted-types-sink', 'self', 'data', 'blob']);

function mediaType(contentType: string | null): string {
  return (contentType ?? '').split(';')[0]!.trim().toLowerCase();
}

function redactBlocked(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return 'other';
  const keyword = raw.replace(/:$/, '').toLowerCase();
  if (BLOCKED_KEYWORDS.has(keyword)) return keyword;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return /^[a-z0-9.-]{1,253}$/.test(host) ? host : 'other';
  } catch {
    return 'other';
  }
}

function redactDirective(raw: unknown): string {
  const first = typeof raw === 'string' ? raw.trim().split(/\s+/)[0]!.toLowerCase() : '';
  return /^[a-z-]{1,40}$/.test(first) ? first : 'unknown';
}

function redactPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    return new URL(raw).pathname.slice(0, 200);
  } catch {
    return null;
  }
}

const record = (blocked: unknown, directive: unknown, document: unknown): CspViolationRecord => ({
  blocked: redactBlocked(blocked),
  directive: redactDirective(directive),
  documentPath: redactPath(document),
});

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Reduce a parsed report body to redacted records (unknown shapes yield none). */
export function redactCspReports(type: string, parsed: unknown): CspViolationRecord[] {
  if (type === 'application/csp-report') {
    const r = isObject(parsed) ? parsed['csp-report'] : null;
    if (!isObject(r)) return [];
    return [record(r['blocked-uri'], r['effective-directive'] ?? r['violated-directive'], r['document-uri'])];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((r): r is Record<string, unknown> => isObject(r) && r.type === 'csp-violation' && isObject(r.body))
    .slice(0, CSP_REPORTS_PER_REQUEST)
    .map((r) => {
      const b = r.body as Record<string, unknown>;
      return record(b.blockedURL, b.effectiveDirective ?? b.violatedDirective, b.documentURL ?? r.url);
    });
}

/**
 * Read a report POST (bounded), parse and redact it, and log each record. The caller
 * maps the outcome to a status; nothing here throws on a hostile body.
 */
export async function ingestCspReport(input: {
  contentType: string | null;
  contentLength: string | null;
  body: ReadableStream<Uint8Array> | null;
}): Promise<CspReportOutcome> {
  const type = mediaType(input.contentType);
  if (!(CSP_REPORT_CONTENT_TYPES as readonly string[]).includes(type)) return { outcome: 'unsupported_media_type' };
  const declared = Number(input.contentLength);
  if (input.contentLength !== null && Number.isFinite(declared) && declared > CSP_REPORT_MAX_BYTES) return { outcome: 'too_large' };
  if (!input.body) return { outcome: 'invalid' };
  const bytes = await readBounded(input.body, CSP_REPORT_MAX_BYTES);
  if (!bytes) return { outcome: 'too_large' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { outcome: 'invalid' };
  }
  const records = redactCspReports(type, parsed);
  for (const r of records) {
    console.warn(JSON.stringify({ event: 'runtime.csp.violation', ...r }));
  }
  return { outcome: 'accepted', records };
}
