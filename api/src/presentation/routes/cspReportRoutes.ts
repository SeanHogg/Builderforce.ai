/**
 * CSP violation reports — POST /api/runtime/csp-report (make.md §4 W10, control 6).
 *
 * The `report-uri` / `report-to` target of the preview origin's worker, service-worker
 * and relay CSPs. Unauthenticated (browsers send reports without credentials) and
 * rate-limited per client IP. Accepts `application/csp-report` and
 * `application/reports+json`, at most 16 KB. Reports are telemetry only; the parsing,
 * redaction and logging live in `application/runtime/cspReports`.
 *
 *   → 204   accepted (also for a well-formed body with no CSP violation in it)
 *   → 400   not JSON / no body
 *   → 413   over the size cap
 *   → 415   another content type
 *   → 429   over the per-IP window
 *
 * Mounted ABOVE the `/api/runtime` router so its authMiddleware never sees it.
 */
import { Hono } from 'hono';
import { CSP_REPORT_RPM, ingestCspReport } from '../../application/runtime/cspReports';
import type { HonoEnv } from '../../env';
import { slidingWindowLimited } from '../middleware/rateLimitResponse';
import { clientIp } from './voiceRateLimit';

export function createCspReportRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.post('/', async (c) => {
    const limited = await slidingWindowLimited(c, `csp-report:${clientIp(c)}`, CSP_REPORT_RPM);
    if (limited) return limited;
    const result = await ingestCspReport({
      contentType: c.req.header('content-type') ?? null,
      contentLength: c.req.header('content-length') ?? null,
      body: c.req.raw.body,
    });
    switch (result.outcome) {
      case 'accepted': return c.body(null, 204);
      case 'unsupported_media_type': return c.json({ error: 'Unsupported content type' }, 415);
      case 'too_large': return c.json({ error: 'Report too large' }, 413);
      case 'invalid': return c.json({ error: 'Invalid report' }, 400);
    }
  });

  return router;
}
